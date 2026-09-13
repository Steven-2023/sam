package de.halbmann.sam;

import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.CacheControl;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@Path("/oidc-config.json")
@PermitAll
public class OidcConfigResource {

    // Not auth-server-url: that's where *we* reach Keycloak (may be an
    // internal/plain-HTTP address); this is what the *browser* must use,
    // e.g. a TLS-terminating reverse proxy in front of Keycloak.
    @ConfigProperty(name = "quarkus.oidc.token.issuer")
    Optional<String> issuerUrl;

    @ConfigProperty(name = "quarkus.oidc.client-id", defaultValue = "sam-ui")
    String clientId;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response config() {
        OidcConfigDto dto = new OidcConfigDto(issuerUrl.orElse("http://localhost:8180/realms/sam"), clientId);
        // Must never be cached by the browser (or any intermediary) — the correct value depends
        // on the deployment's OIDC_ISSUER_URL, which can change without the JS bundle changing.
        CacheControl noStore = new CacheControl();
        noStore.setNoStore(true);
        noStore.setNoCache(true);
        return Response.ok(dto).cacheControl(noStore).build();
    }

    public record OidcConfigDto(String issuerUrl, String clientId) {}
}
