# ADR-0011: Keep nginx; document its reverse-proxy pattern as the template for future co-located apps

**Status:** accepted

## Context

The longer-term goal is to run SAM alongside other self-hosted apps (a DMS,
a CRM, NextCloud) on the same host/stack, rather than as a standalone
deployment. That raises the question of what reverse-proxy/TLS pattern to
standardize on across all of them, and whether SAM should switch first.

We evaluated adopting Caddy (which upstream fhm84/sam has since done,
replacing nginx — see the now-reverted `feat(deploy): add Caddy edge proxy`
commit) as that shared pattern, since Caddy's whole design is built around
low-config, automatic HTTPS for exactly this kind of "several apps behind
one edge" setup. Verified directly against `caddy:2`:

- `.mjs` assets (`ngx-extended-pdf-viewer`'s pdf.js bundle) are served with
  the correct `text/javascript` type out of the box — no equivalent of
  `docker/nginx.conf`'s explicit `.mjs` fix is needed.
- For a real public domain, Caddy issues genuine Let's Encrypt certificates
  automatically; for a non-public address (a bare LAN IP, no DNS), it falls
  back to its own internal CA automatically — no extra config needed to
  pick between the two.
- **However**, browsers and TLS clients don't send an SNI value at all when
  connecting to a literal IP address (SNI is defined for hostnames only,
  not IP literals — RFC 6066). Caddy's automatic-HTTPS model routes and
  selects a certificate by matching the inbound SNI, so a connection with
  no SNI at all fails the TLS handshake outright ("internal error"), before
  any HTTP request is even processed. Reproduced with both a
  `{$SAM_DOMAIN}`-keyed site block and a catch-all `:443 { tls internal }`
  block — same failure either way. This affects exactly the scenario
  `docs/architecture/decisions/adr-0010-tls-proxy-for-embedded-keycloak.md`
  was written for: reaching a self-hosted instance over a bare LAN IP with
  no real hostname.

A hostname (even a local/private one, e.g. via `/etc/hosts` or a LAN DNS
resolver — not necessarily a real public domain) would restore SNI and
resolve this. That also happens to be the natural shape of a multi-app
stack anyway: DMS/CRM/NextCloud/SAM would each want their own hostname
rather than sharing one IP with path-based routing.

## Decision

Stay on nginx for now, rather than adopting Caddy immediately:

- SAM's current deployment has no real hostname yet (LAN-IP testing per
  ADR-0010), so Caddy's core benefit (automatic HTTPS) doesn't apply today,
  and the SNI issue above would need solving first regardless.
- **`docker-compose.prod.yml` and `docker/nginx.conf` are the reference
  pattern to replicate when a new app joins the stack**: one edge container
  terminates TLS and reverse-proxies path (or, once real hostnames exist,
  host-based) routes to that app's own backend container(s), the same way
  `sam-ui` fronts `sam-server`. A new app gets its own service block plus
  its own `location`/`server` entry in the edge config — it does not need
  its own separate reverse proxy or TLS termination.
- Revisit Caddy specifically once the stack has real hostnames (even
  internal-only ones) for each app — at that point the SNI blocker no
  longer applies, and Caddy's per-domain automatic certificate management
  is a genuine simplification over hand-maintaining one nginx config for
  every app.

## Consequences

- The nginx/Caddy choice is contained to a small, well-defined surface, so
  switching later stays low-risk: functionally coupled are only
  `Dockerfile` (`FROM nginx:alpine` + `COPY docker/nginx.conf`),
  `docker/nginx.conf` itself, and the `.certs` volume + related comments in
  `docker-compose.yml`/`docker-compose.prod.yml`. Everything else that
  mentions nginx (`Dockerfile.sam`, `application.properties`,
  `monitoring/prometheus.yml`, `monitoring/CLAUDE.md`, the various
  `docs/architecture/*.md` pages) is a comment or doc reference for
  context, not a functional dependency — no Java or Angular code assumes
  nginx specifically.
- Adding a new co-located app later means: its own service in the compose
  file, its own `location`/`server` block in the edge proxy config
  (whichever proxy is in use at that point), and — if it needs its own
  OIDC client — a new Keycloak client, following the same shape as
  `sam-ui`'s.
- This ADR does not commit to a specific DMS/CRM choice, or to a timeline
  for the multi-app stack — it only fixes the *pattern* future apps should
  follow, and records why Caddy was tried and set aside for now.
