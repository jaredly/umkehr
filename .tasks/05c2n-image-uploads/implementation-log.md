# Implementation Log: Image Upload Blocks

## 2026-06-23

- Started implementation from `plan.md`.
- Phase 1 in progress: adding image block metadata and validation.
- Added `RichBlockMeta` image variant and attachment helper module.
- Updated history and clipboard metadata validators for image block metadata.
- Added `insertImageBlock(...)` command and special-cased Enter in image captions to create a paragraph after the image.
- Added shared App-level attachment store, toolbar image upload, image-file paste detection, image block preview/placeholder rendering, caption reuse of `RichTextEditableSurface`, and image size control.
- Added separate attachment bundle support for history export/import. CRDT ops still carry only image block metadata; attachment bytes/metadata are serialized alongside history.
- Added rich clipboard attachment payload support. Copy includes attachment records for copied image fragments, and paste merges those records into the App attachment store.
- Added clipboard handling for selected image blocks with empty captions so their image metadata and attachment can still be copied.
- Added command-level tests for empty-block image conversion, non-empty insertion after the current block, peer metadata sync, and Enter creating a paragraph after an image.
- Workaround/known issue: multi-image upload/paste currently inserts only the first image to keep selection behavior deterministic while the core path lands.
- Issue encountered: an initial refactor patch left a stale copy of the old editable block body in `App.tsx`; removed the generated range immediately before continuing.
- Issue found by tests: image caption Enter was initially preempted by the generic empty non-paragraph split behavior; moved the image split branch before that fallback.
- Verification: `npm exec vitest -- run src/blockCommands.test.ts` passed with 136 tests.
- Verification: `npm exec vitest -- run` passed with 421 tests and 1 skipped test.
- Verification: `npm run build` passed. It prints `Error connecting to agent: Operation not permitted` before npm output in this environment, but TypeScript and Vite completed successfully.
- Verification limitation: attempted Browser plugin smoke check, but the in-app browser reported `Browser is not available: iab`. Started Vite on `127.0.0.1`; it selected port `5175` because `5174` was in use, then stopped the dev server.

## 2026-06-23 Follow-up

- Bug: toolbar image upload opened the native file picker, but after choosing a file the DOM selection had been lost/collapsed, so the command used the wrong insertion point and appeared to do nothing except jump selection to the start of the block.
- Fix: capture a retained selection snapshot before opening the file picker and use that retained selection after async attachment creation completes. Image paste still captures selection at paste time.
- Bug persisted: the toolbar `onChange` kept a live `FileList` reference, then cleared the file input before handing files to the upload handler. In browsers this can empty the same `FileList`, so no image block was inserted.
- Fix: copy `event.currentTarget.files` into a `File[]` before clearing the input value. Also relaxed image detection to accept common image extensions when MIME type is missing.
- Verification: `npm exec vitest -- run src/blockCommands.test.ts` passed with 136 tests.
- Verification: `npm run build` passed. The environment still prints `Error connecting to agent: Operation not permitted` before npm output, but TypeScript and Vite completed successfully.
