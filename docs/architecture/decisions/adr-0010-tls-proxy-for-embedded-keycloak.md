# ADR-0010: TLS-terminating nginx proxy in front of an embedded Keycloak for LAN/testing stacks

**Status:** accepted

## Context

`docker-compose.prod.yml` assumes an externally managed Keycloak reachable
over plain HTTP or a properly-certificated HTTPS URL ([ADR-0003](adr-0003-self-hosted-keycloak.md)).
For a self-contained, all-in-one stack (`docker-compose.yml`, which folds in
`docker-compose.keycloak.yml`'s dev Keycloak alongside `sam-ui`/`sam-server`),
that assumption doesn't hold: there is no real domain or CA-signed
certificate, and the stack is reached over plain HTTP on a LAN IP.

That breaks the Angular login flow outright: `angular-auth-oidc-client` uses
`crypto.subtle` (PKCE `S256` code challenge), which browsers only expose in a
*secure context* — HTTPS, or `http://localhost`. A LAN IP over plain HTTP
never qualifies, so PKCE fails before any request reaches the backend.

## Decision

- **nginx (`sam-ui`) terminates TLS** with a self-signed certificate
  (`.certs/`, gitignored, SAN = the deployment's LAN IP), listening on
  `81:80` and `8443:443`.
- **nginx reverse-proxies Keycloak itself** (`/realms/`, `/resources/`,
  `/js/`, `/admin/`) through the same HTTPS origin — not just the SAM API —
  so the browser's discovery fetch, login page, and session-check iframe all
  stay same-origin HTTPS (avoiding both mixed-content blocks and
  cross-origin `frame-src` CSP failures).
- **Keycloak gets a fixed public identity** via `KC_HOSTNAME=https://<lan-ip>:8443`,
  so tokens' `iss` claim and all browser-facing URLs point at the TLS front
  door instead of Keycloak's own plain-HTTP port.
- **`KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true` + `KC_PROXY_HEADERS=xforwarded`**
  split *backend-facing* endpoints (`token_endpoint`, `jwks_uri`) from
  *browser-facing* ones (`authorization_endpoint`, `issuer`): sam-server
  reaches Keycloak directly over plain HTTP (`OIDC_SERVER_URL`, port
  `8180`), while the browser only ever sees the HTTPS `8443` origin. Without
  this split, sam-server would have to trust the self-signed cert just to
  validate tokens.
- **`OIDC_ISSUER_URL` / `quarkus.oidc.token.issuer`** is a new, separate
  config value from `OIDC_SERVER_URL` / `quarkus.oidc.auth-server-url`:
  the former is what `OidcConfigResource` returns to the browser and what
  Quarkus checks the token `iss` claim against; the latter is only used for
  sam-server's own outbound calls to Keycloak. They coincide (and
  `OIDC_ISSUER_URL` can be omitted) whenever Keycloak is reachable at the
  same URL internally and externally — the common case documented in
  [Deployment](../deployment.md) for `docker-compose.prod.yml`.
- nginx forwards `$http_host` (not `$host`, which drops the port) plus
  `X-Forwarded-Proto`/`X-Forwarded-Host` on the Keycloak-proxying locations,
  since Keycloak's dynamic backchannel derivation depends on them.

## Consequences

- Browsers show a one-time certificate-trust warning for the self-signed
  cert; there is no way around that without a real CA-issued certificate.
- This setup is specific to `docker-compose.yml`'s all-in-one/LAN-testing
  topology. `docker-compose.prod.yml` (external, properly-certificated
  Keycloak) doesn't need any of it — `OIDC_ISSUER_URL` stays unset there and
  `quarkus.oidc.token.issuer` falls back to `quarkus.oidc.auth-server-url`.
- The Keycloak Admin Console becomes reachable at `https://<lan-ip>:8443/admin/`
  in addition to the direct `http://<lan-ip>:8180/admin/`.
- `keycloak/sam-realm.json` and `keycloak/configurator/sam/clients/sam-ui.json`
  both needed the LAN IP's HTTP and HTTPS origins added to `redirectUris`/
  `webOrigins` — another instance of the manual-sync burden tracked in
  `keycloak/README.md`.

See [Deployment](../deployment.md) and [Security concept](../concepts/security.md).
