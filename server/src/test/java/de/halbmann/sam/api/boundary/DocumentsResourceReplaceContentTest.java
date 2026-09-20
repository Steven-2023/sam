package de.halbmann.sam.api.boundary;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.*;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.restassured.http.ContentType;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Regression/contract test for {@code POST /documents/{attachmentId}/content}, added to let a
 * PDF part be re-uploaded (e.g. after adding bowing/articulation annotations) without losing the
 * attachment's identity — same id and display name, just pointing at new file content.
 */
@QuarkusTest
@TestSecurity(
        user = "librarian1",
        roles = {"music_librarian"})
class DocumentsResourceReplaceContentTest {

    @Test
    void replaceContent_keepsAttachmentIdentity_butServesNewBytes() {
        String suffix = UUID.randomUUID().toString();
        String instrumentId = "TEST_REPLACE_CONTENT_" + suffix.toUpperCase().replace("-", "_");

        given().contentType(ContentType.JSON)
                .body("""
                        {"id": "%s", "name": "Test Instrument"}
                        """.formatted(instrumentId))
                .post("/api/instruments")
                .then()
                .statusCode(200);

        String sheetId = given().contentType(ContentType.JSON)
                .body("""
                        {"title": "Replace Content Test %s"}
                        """.formatted(suffix))
                .post("/api/sheets")
                .then()
                .statusCode(200)
                .extract()
                .path("id");

        given().contentType(ContentType.JSON)
                .body("""
                        {"instrumentId": "%s", "partLabel": "1"}
                        """.formatted(instrumentId))
                .post("/api/sheets/{sheetId}/instrumentations", sheetId)
                .then()
                .statusCode(204);

        String instrumentationId = given().get("/api/sheets/{sheetId}/instrumentations", sheetId)
                .then()
                .statusCode(200)
                .extract()
                .path("[0].id");

        String docsPath = "/api/sheets/{sheetId}/instrumentations/{instrumentationId}/documents";

        String attachmentId = given().multiPart(
                        "file", "original.pdf", "original content".getBytes(), "application/pdf")
                .multiPart("type", "PART")
                .post(docsPath, sheetId, instrumentationId)
                .then()
                .statusCode(200)
                .extract()
                .path("attachment.id");

        byte[] originalBytes = given().get(docsPath + "/{attachmentId}", sheetId, instrumentationId, attachmentId)
                .then()
                .statusCode(200)
                .extract()
                .asByteArray();
        assertArrayEquals("original content".getBytes(), originalBytes);

        String newAttachmentId = given().multiPart(
                        "file", "original-annotated.pdf", "annotated content".getBytes(), "application/pdf")
                .post("/api/documents/{attachmentId}/content", attachmentId)
                .then()
                .statusCode(200)
                .body("displayName", equalTo("original.pdf"))
                .extract()
                .path("id");

        assertEquals(attachmentId, newAttachmentId, "replacing content must keep the same attachment id");

        byte[] updatedBytes = given().get(docsPath + "/{attachmentId}", sheetId, instrumentationId, attachmentId)
                .then()
                .statusCode(200)
                .extract()
                .asByteArray();
        assertArrayEquals("annotated content".getBytes(), updatedBytes);
    }
}
