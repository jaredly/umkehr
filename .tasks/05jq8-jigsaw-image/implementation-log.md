# Implementation Log: Jigsaw Image Upload Artifact

## 2026-06-29

- Started implementation from `plan.md`.
- Confirmed the existing document initializer API is synchronous; using the planned approach of processing uploads into serializable init params before document creation rather than changing shared app initialization.
- Implemented the artifact/model foundation:
  - widened jigsaw board image refs to include `artifact:image`,
  - added a fixed `image` artifact type/store path,
  - updated initial artifact creation to emit board plus image when an uploaded image exists,
  - kept board artifact version `1`.
- Issue found: the module-level artifact store could retain a stale uploaded image after loading another board. Workaround/fix: clear `loadedImage` on board load, then let a following `image` artifact repopulate it for uploaded-image documents.
- Implemented board generation for custom image sizes. Rectangular and Voronoi boards now derive piece geometry from the processed upload dimensions while stock boards keep the existing `720x540` size.
- Implemented optional image upload in the jigsaw new-document form:
  - rejects files larger than 20 MB before decoding,
  - decodes the selected image in the browser,
  - preserves aspect ratio while bounding the longest processed edge to 720 px,
  - stores WebP when supported and JPEG otherwise,
  - disables creation while processing or after an upload error.
- Issue found: the async file processing callback could overwrite changed piece-count/type values if the user changed fields mid-processing. Workaround/fix: disable those selects while an image is processing.
- Implemented uploaded-image rendering in `JigsawPanel` by resolving `artifact:image` to a decoded canvas and reusing the existing solved-image/piece canvas drawing path. Missing or failed image decoding falls back to the stock hue canvas so the board stays usable.
- Issue found: an `artifact:image` board loaded without a valid image artifact could reuse a previous document's image. Workaround/fix: clear `loadedImage` on every board load; normal serialized artifact order is board first and image second, so valid image documents repopulate it immediately afterward.
- Added jigsaw tests for custom image-size generation, image artifact serialization/loading, invalid image artifacts, and document initializer validation.
- Verification:
  - `pnpm exec vitest run src/apps/jigsaw/jigsaw.test.ts` passed with 32 tests.
  - `pnpm run build` passed.
  - Both commands print `Error connecting to agent: Operation not permitted` before running, but the commands complete successfully.
  - Started the Vite dev server at `http://127.0.0.1:5174/`; port `5173` was already in use.

## Preview Toggle Follow-up

- Changed the solved preview image to be hidden by default.
- Added a local-only `showPreviewImage` state in `JigsawPanel`; the UI button toggles the preview without writing to CRDT state, artifacts, or persisted document data.
- Verification after the change:
  - `pnpm exec vitest run src/apps/jigsaw/jigsaw.test.ts` passed with 32 tests.
  - `pnpm run build` passed.
  - Both commands still print `Error connecting to agent: Operation not permitted` before running, but complete successfully.
