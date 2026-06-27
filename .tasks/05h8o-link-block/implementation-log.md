# Implementation Log: Block Links via Copy/Paste

## Phase 1: Clipboard Source Metadata

- Started by inspecting `clipboard.ts`, `clipboard.test.ts`, and the existing rich copy/paste pipeline.
- Existing whole-block and table-cell serialization tests can be extended for source metadata instead of introducing large new fixtures.
- Added optional `sourceBlockId` to clipboard fragments and optional `sourceSelectionType` to rich payloads.
- Kept ordinary text selections free of source metadata to avoid changing unrelated copy payloads.
- Added parser validation for invalid source selection types and empty/non-string source block ids.

## Phase 2: Block-Link Detection Helper

- Added `blockLinkHrefForClipboardPayload`, `blockLinkHrefForBlockId`, and `blockIdFromBlockLinkHref`.
- The helper only returns hrefs for rich block/table-cell payloads and returns `null` for missing/deleted source blocks.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/clipboard.test.ts` passed with 28 tests.

## Phase 3: Rich Paste Special Case

- Updated `pasteRichPayload` in `EditorApp.tsx` to detect rich block/table-cell payloads pasted over non-collapsed text ranges.
- The special case applies `setLinkMarkEverywhere` with `#block-<id>` and skips text replacement.
- Corrected the missing/deleted target path to no-op instead of falling through to normal rich paste.
- Added an app-level regression test for the real paste event path.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 249 tests and 1 skipped test.

## Phase 4: DOM Ids for Block Targets

- Added `blockDomIdForBlockId` and now render editable block roots with `id="block-<id>"`.
- Issue: the demo renders two synced editors, so the same CRDT block can appear twice. This means duplicate DOM ids can exist in the side-by-side demo. I kept the agreed `#block-<id>` href shape and logged this as a demo constraint rather than changing href semantics.
- Added app-test coverage that the copied source block exposes the matching DOM id.

## Phase 5: Dead Link Styling

- Added `blockIdFromBlockLinkHref` and `markLinkDead` rendering for `#block-...` links whose target block is not visible in the current state.
- Threaded a visible block id set through the rich text rendering path, including annotation body editors.
- Added CSS for `.markLinkDead`.
- Bugs encountered:
  - The first render-threading pass accidentally referenced `visibleBlockIdSet` in a reusable surface without declaring it as a prop. `App.test.tsx` immediately failed broadly; fixed by adding an explicit optional prop.
  - A positional `serializeRuns` call missed the new visible-id argument, causing `selection` to be treated as an iterable. Fixed by updating the missed call.
  - Annotation body visibility initially referenced an unavailable `richTextVirtualParents` helper. Fixed by using the existing `annotationVirtualParents` import.
- Verification after fixes: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 250 tests and 1 skipped test.

## Phase 6: Verification

- `npm exec vitest -- run examples/block-rich-text/src/clipboard.test.ts`: passed with 28 tests.
- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`: passed with 251 tests and 1 skipped test after adding the missing-target no-op regression.
- `npm run build` from `examples/block-rich-text`: passed. The command prints `Error connecting to agent: Operation not permitted` before running, but `tsc` and Vite completed successfully.
- `npm exec vitest -- run examples/block-rich-text/src/typingPerf.test.ts`: passed with 7 tests and 1 skipped test.
- `npm exec vitest -- run examples/block-rich-text/src`: functionally passed 20 of 21 files but failed the timing threshold test `typingPerf.test.ts > keeps a moderate sequential typing workload responsive` twice under full-suite load (`138.5ms` and `142.1ms` vs `<120ms`). The same file passed in isolation, so this looks like full-suite performance noise rather than a block-link behavior failure.

## Follow-up: Block Link Popover Target

- Updated `LinkHoverPopover` so `#block-...` links render without `target="_blank"` or `rel="noreferrer"`.
- External links still render with `target="_blank"` and `rel="noreferrer"`.
- Added app-test coverage in the copied-block paste workflow.
