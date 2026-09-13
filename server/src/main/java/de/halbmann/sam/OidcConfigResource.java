package de.halbmann.sam;

import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
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
    public OidcConfigDto config() {
        return new OidcConfigDto(issuerUrl.orElse("http://localhost:8180/realms/sam"), clientId);
    }

    public record OidcConfigDto(String issuerUrl, String clientId) {}
}
