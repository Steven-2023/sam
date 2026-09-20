# ADR-0010: TLS-terminating nginx proxy in front of an embedded Keycloak for LAN/testing stacks

**Status:** accepted

## Context

`docker-compose.prod.yml` was written assuming an externally managed Keycloak
reachable over plain HTTP or a properly-certificated HTTPS URL
([ADR-0003](adr-0003-self-hosted-keycloak.md)). That assumption doesn't hold
for a self-hosted Keycloak reached over a LAN IP with no real domain or
CA-signed certificate — whether that's the self-contained, all-in-one stack
(`docker-compose.yml`, which folds in `docker-compose.keycloak.yml`'s dev
Keycloak alongside `sam-ui`/`sam-server`) or `docker-compose.prod.yml` run
against a Keycloak started separately via `docker-compose.keycloak.yml` on
the same LAN.

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
- This mechanism only matters for a self-hosted, LAN-reachable Keycloak
  without a real domain/CA cert — whether that's `docker-compose.yml`'s
  all-in-one topology or `docker-compose.prod.yml` pointed at a
  `docker-compose.keycloak.yml` instance on the same LAN. With a genuinely
  externally managed, properly-certificated Keycloak
  ([ADR-0003](adr-0003-self-hosted-keycloak.md)), none of this is needed —
  `OIDC_ISSUER_URL` stays unset and `quarkus.oidc.token.issuer` falls back to
  `quarkus.oidc.auth-server-url` (`docker-compose.prod.yml` now defaults
  `OIDC_ISSUER_URL` to `OIDC_SERVER_URL` when unset, rather than requiring
  it unconditionally).
- The Keycloak Admin Console becomes reachable at `https://<lan-ip>:8443/admin/`
  in addition to the direct `http://<lan-ip>:8180/admin/`.
- `keycloak/sam-realm.json` and `keycloak/configurator/sam/clients/sam-ui.json`
  need the deployment's LAN IP added to `redirectUris`/`webOrigins` in both
  files — deliberately not committed with a real IP (that's
  deployment-specific), see `keycloak/README.md`; another instance of the
  manual-sync burden tracked there.

See [Deployment](../deployment.md) and [Security concept](../concepts/security.md).
