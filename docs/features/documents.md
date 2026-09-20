# Documents & Attachments

SAM manages physical files (PDFs, audio, images, etc.) separately from metadata.

## Upload

Files are uploaded to a **staging area** (unlinked pool) or directly to a sheet or instrumentation. Supported via drag-and-drop or file picker.

## Attachment types

| Type | Description |
|------|-------------|
| `FULL_SCORE` | Complete conductor's score |
| `PART` | Individual instrument part |
| `COVER` | Title page / decorative cover |
| `LYRICS` | Text-only lyrics document |
| `MIDI` | MIDI playback file |
| `AUDIO` | MP3 / WAV recording |
| `ANNOTATIONS` | Score with markings, fingerings |
| `IMAGE` | Scanned JPG / PNG |
| `ANALYSIS` | Harmonic or structural analysis |
| `TRANSCRIPTION` | Manually transcribed version |
| `EXTERNAL_LINK` | URL to an external resource |
| `MUSIC_XML` | MusicXML / MXL exchange format |
| `OTHER` / `UNSPECIFIED` | Catch-all |

## Document features

- **Content-addressed storage** — files are identified by SHA-256 checksum. Uploading the same file twice increments a reference count instead of duplicating storage (see [Storage & Deduplication](../architecture/concepts/storage-and-deduplication.md)).
- **Pluggable storage backend** — local filesystem or AWS S3.
- **ETag-based HTTP caching** on download.
- **Linking & relinking** — a document in the unlinked pool can be assigned to a sheet or instrumentation at any time. Existing links can be edited (target sheet, target instrumentation, attachment type).
- **Content replacement** (`POST /documents/{attachmentId}/content`) — swaps an attachment's underlying document while keeping the attachment's identity (id, displayName, type, position in its list). Used by the [PDF annotation editor](#pdf-annotation-editor) so re-saving a marked-up part updates the same row instead of creating a duplicate. The previous document is cleaned up via the same ref-count path as `DELETE` when nothing else references it.
- **Batch download** — select multiple documents for download as a ZIP archive or as a **merged PDF** (when all selected files are PDFs).
- **Unlinked pool** (`/uploads`) — staging area showing all documents not yet assigned, with classify and assign actions.

## PDF annotation editor

For PDF attachments, an "Edit annotations" button (instrumentation document list) opens the
file in an in-browser editor (`ngx-extended-pdf-viewer`, wrapping pdf.js's own ink-annotation
tool) where bowings/articulations can be drawn freehand directly onto the pages. Saving exports
the PDF with those strokes baked in as real, printable PDF Ink annotation objects — not a SAM-only
overlay — and uploads it via content replacement above. Annotations are shared: one agreed markup
per voice/instrumentation, not a private per-musician layer. Saving currently requires
`music_librarian`/`admin`, matching every other document-mutating endpoint; broadening this to any
ensemble member with access to that voice is a deliberate, not-yet-built follow-up.

## Related

- [AI Classification](ai-classification.md) — turning an uploaded document into archive entities
- [Event Log](event-log.md) — downloads are tracked as read events
