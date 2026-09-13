# Deployment

## Container Images

SAM ships as two Docker images:

```
                        :80
  Browser ──── nginx (sam-ui) ──┬── /api/*           ──► sam-server:8080
                                ├── /q/*              ──► sam-server:9000 (management)
                                ├── /oidc-config.json ──► sam-server:8080
                                └── /*                ──► Angular SPA (static)
```

| Image | Built by | Contents |
|-------|----------|----------|
| `de.halbmann/sam:latest` | Jib (`./mvnw package -Dquarkus.container-image.build=true -pl server -am`), or `docker build -f Dockerfile.sam .` for a Docker-only build with no host Maven/JDK | Quarkus server JAR — REST API, Flyway, Hibernate, LangChain4j |
| `de.halbmann/sam-ui:latest` | `docker build .` (multi-stage Dockerfile) | Built Angular SPA served by nginx |

The nginx reverse proxy is the single public entry point (port 80). All Angular API calls use relative `/api/*` paths, which nginx forwards to the backend — no CORS configuration required.

`sam-server` also listens on a separate, unpublished management port (`9000`, [ADR-0007](decisions/adr-0007-management-interface.md)) for `/q/*` ops endpoints (`/q/info` for version/build-id, `/q/metrics` for Prometheus) — kept off the main port so they don't fall under the public API's `@Authenticated` default. nginx proxies `/q/*` to it internally.

## OIDC Config Endpoint

`GET /oidc-config.json` is handled by `OidcConfigResource` (a `@PermitAll` JAX-RS endpoint in the `server` module, mounted under `@ApplicationPath("/api")` like every other backend endpoint — nginx's `/oidc-config.json` location rewrites to `/api/oidc-config.json` to hide that). It returns `{issuerUrl, clientId}` — `clientId` from `quarkus.oidc.client-id` (`OIDC_CLIENT_ID`), and `issuerUrl` from `quarkus.oidc.token.issuer`, which normally just falls back to `quarkus.oidc.auth-server-url` (`OIDC_SERVER_URL`) when the two coincide. nginx proxies this path to the backend, so the Angular app always gets the deployment-correct Keycloak URL without requiring an image rebuild.

`quarkus.oidc.auth-server-url` (`OIDC_SERVER_URL`) and `quarkus.oidc.token.issuer` (`OIDC_ISSUER_URL`) can be set to *different* URLs when sam-server can't reach Keycloak at the same address the browser uses — e.g. a TLS-terminating reverse proxy in front of a plain-HTTP Keycloak (see [ADR-0010](decisions/adr-0010-tls-proxy-for-embedded-keycloak.md)). `OIDC_SERVER_URL` is then the backend-reachable address (used for discovery/JWKS), and `OIDC_ISSUER_URL` is the externally-visible one returned to the browser and checked against tokens' `iss` claim. Leave `OIDC_ISSUER_URL` unset when the two are the same, which is the default `docker-compose.prod.yml` setup below.

## Required Environment Variables

Copy `.env.example` → `.env` and fill in before running `docker compose -f docker-compose.prod.yml up`.

| Variable | Used by | Default | Description |
|----------|---------|---------|-------------|
| `DB_PASS` | sam-server | — | PostgreSQL password |
| `OIDC_SERVER_URL` | sam-server | — | Full Keycloak realm URL (e.g. `https://kc.example.com/realms/sam`) |
| `OIDC_ISSUER_URL` | sam-server | `OIDC_SERVER_URL` | Only needed when the browser can't reach Keycloak at `OIDC_SERVER_URL` (see [ADR-0010](decisions/adr-0010-tls-proxy-for-embedded-keycloak.md)) |
| `OIDC_CLIENT_ID` | sam-server | `sam-ui` | OIDC client ID |
| `KEYCLOAK_ADMIN_URL` | sam-server | — | Keycloak base URL for admin REST client |
| `KEYCLOAK_BACKEND_CLIENT_SECRET` | sam-server | — | Service account secret for user search |
| `OPENAI_API_KEY` | sam-server | — | OpenAI key for document classification |
| `DB_USER` | sam-server, database | `sam` | PostgreSQL user |
| `KEYCLOAK_REALM` | sam-server | `sam` | Keycloak realm name |
| `KEYCLOAK_BACKEND_CLIENT_ID` | sam-server | `sam-backend` | Service account client ID |
| `SAM_FILESYSTEM_BASE_PATH` | sam-server | `/data/sam` | Mount point for sheet music file storage |

## Storage Volume

Sheet music files are stored in a named Docker volume (`sam-data`) mounted at `/data/sam` inside the container. The path is configurable via `SAM_FILESYSTEM_BASE_PATH`. Keycloak is expected as an external service and is not part of the production compose file.

## All-in-one variant (`docker-compose.yml`)

`docker-compose.yml` additionally bundles the Keycloak service from
`docker-compose.keycloak.yml` alongside `sam-ui`/`sam-server`/`database`, for
a single-command stack with no external Keycloak dependency — useful for LAN
demos or testing without a real domain. It adds nginx TLS termination
(self-signed cert, `.certs/`, gitignored) and reverse-proxies Keycloak's own
endpoints through the same HTTPS origin; see
[ADR-0010](decisions/adr-0010-tls-proxy-for-embedded-keycloak.md) for why
that's necessary (browsers require a secure context for the PKCE
`crypto.subtle` call) and how it's wired (`KC_HOSTNAME`,
`KC_HOSTNAME_BACKCHANNEL_DYNAMIC`, `OIDC_ISSUER_URL`).

## Related

- [Security](concepts/security.md) — OIDC / Keycloak setup
- [Storage & Deduplication](concepts/storage-and-deduplication.md) — local vs S3 backend selection
