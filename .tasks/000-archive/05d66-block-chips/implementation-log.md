# Implementation Log: Preview Card Blocks

## Phase 1: Block Metadata Model

- Started implementation from `plan.md`.
- Added `PreviewMetadata` and the `preview` block meta variant.
- Updated `sameTypeWithTs` so preview URL and cached metadata survive timestamp refreshes.

## Phase 2: Commands And CRDT Updates

- Added `insertPreviewBlock` for preview block creation.
- Adjusted preview insertion to convert the active block in place, including non-empty blocks, so existing block text remains the preview subtitle. This differs from image insertion and matches the answered open question.
- Added `setPreviewBlockData` for URL and cached metadata writes through block meta ops.
- Updated `splitBlock` so preview blocks behave like image blocks and split into a following paragraph.

## Phase 3: Preview Metadata Fetching

- Added `previewMetadata.ts` with absolute HTTP(S) URL validation, direct fetch, Open Graph parsing, title fallback, relative URL resolution, and typed loaded/failed/invalid results.
- Deferred CORS proxy support and site-specific resolvers per the answered scope.
- Follow-up: added optional CORS proxy support via Vite env variable `VITE_PREVIEW_CORS_PROXY`.
- Proxy values may be a URL prefix, such as `https://proxy.example/raw?url=`, or a template containing `{url}`. The target URL is URL-encoded before insertion/appending.
- Follow-up: routed absolute Open Graph image URLs through the same proxy at render time while keeping canonical image URLs stored in block meta.
- Added `.env` and `.env.*` to `.gitignore`, with `!.env.example`, so local `.env.local` settings are not checked in.

## Phase 4: App UI Integration

- Added `Preview` to slash commands and toolbar block-type choices.
- Added preview insertion from slash and toolbar using `insertPreviewBlock`.
- Added preview card rendering with URL empty state, URL editing, top-right options menu, fetched metadata display, and subtitle editing through the existing rich text surface.
- Added guarded metadata writes so stale fetches only update a block if it still exists, is still a preview block, and still has the fetched URL.

## Phase 5: Clipboard And Import/Export

- Updated rich clipboard metadata validation to accept preview block metadata and cached preview fields.
- Added external HTML fallback rendering for preview blocks as a normal link plus subtitle text.

## Phase 6: Styling

- Added compact preview card, URL editor, menu, fallback image, loading/failure, subtitle, and table-cell responsive styles.

## Phase 7: Tests

- Added command tests for preview conversion, URL/metadata updates, peer sync, and split behavior.
- Added preview metadata parser tests for URL validation, Open Graph extraction, title fallback, relative URL resolution, and fetch failure handling.
- Added preview metadata proxy tests for prefix/template proxy URL construction and proxied fetch behavior.
- Added preview metadata asset URL tests for proxied image rendering.
- Added clipboard parser/serialization tests for preview metadata and HTML fallback.
- Added app tests for slash creation, toolbar conversion, invalid URL handling, URL replication, fetched metadata replication, and menu-based URL editing.

## Verification Notes

- Initial example typecheck failed because the code referenced `PreviewUrlValidation['reason']` on a union where only the invalid branch has `reason`. Fixed by introducing `PreviewUrlInvalidReason`.
- The first implementation mirrored image insertion for non-empty blocks, which created a new empty preview block after existing text. Corrected to convert the active block in place so the existing text is the subtitle.
- Metadata parser tests initially failed because `DOMParser` was not a Node global. Added a parser fallback to `window.DOMParser`, which is also better for browser-like test environments.
- App tests exposed that the peer editor could stay in URL edit mode after receiving a URL for a synced empty preview block. Added local draft dirty tracking so remote URL updates close edit mode unless the user has actually edited the draft.
- `npm exec -- tsc -p examples/block-rich-text/tsconfig.json --noEmit` passes.
- `npm exec -- vitest run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/previewMetadata.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/App.test.tsx` passes: 4 files, 364 tests.
- `npm run build` from `examples/block-rich-text` passes. It printed a non-fatal `Error connecting to agent: Operation not permitted` before the npm script output, then Vite completed successfully.
