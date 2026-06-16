# Implementation Log: Comment Sidebar

## Phase 1: Generic Block CRDT Helpers

- Added public exports for `virtualParentOwner` and `virtualParentOwners`.
- Added `formattedMarkValues(run, type)` to read both stacking and LWW formatted mark values.
- Added `visibleRangesForMark(state, mark, config)` to expose visible block-local coverage ranges for a mark.
- Added `insertBlockOpsWithId` as a convenience wrapper around `insertBlockOps`.
- Added block-crdt formatting tests for formatted mark values and visible mark ranges, including a mark split across visible blocks.

Issues/workarounds:

- Split range expectations need to follow existing mark behavior: a mark created before a later split follows the split, so the test expects separate `bc` and `de` ranges rather than a naive original-block range.

## Phase 2: Annotation Command IDs

- Changed `createAnnotation` to return `annotationId` and `bodyBlockId` alongside its existing command result fields.
- Used `insertBlockOpsWithId` so new annotation body ids are captured directly from the block insert operation.
- Switched annotation formatted-run value collection to `formattedMarkValues`.
- Added annotation tests for returned ids on new annotations, exact-overlap body creation, and non-actionable caret selections.

Issues/workarounds:

- Found that `createAnnotation` could try to create a zero-length mark for a caret selection because `bodySelectionRange` returns a clamped zero-length range. Fixed by filtering out zero-length segments before calling `markRangeOp`.

## Phases 3-7: Sidebar State, Layout, Gutter, Focus, Styling

- Added per-panel local comment sidebar state, defaulting collapsed.
- Added token-based comment body focus requests so clicking the same gutter dot repeatedly can refocus the same body.
- Added local tracking of the most recently edited body block per annotation.
- Moved sidebar comments from above `.blockList` into a right-hand editor content column beside the document.
- Kept footnotes in the document column below `.blockList`.
- Added collapsed gutter rendering with one dot per sidebar annotation.
- Added best-effort dot positioning:
  - primary anchor: rendered spans with `data-sidebar-annotation-ids`.
  - fallback anchor: `visibleRangesForMark` plus the referenced block element.
  - overlap prevention: sorted positions with a minimum vertical gap.
- Wired local sidebar comment creation to open the sidebar and focus the returned body block.
- Left remote-created comments collapsed in the receiving editor.
- Updated sidebar CSS for open cards, collapsed rail, stable dot dimensions, focus rings, and narrower responsive behavior.

Issues/workarounds:

- Gutter alignment is intentionally best-effort. Exact text-range geometry is not available for every run/overlap shape, so the implementation measures the rendered annotation span when possible and otherwise falls back to block-level positioning.
- The position measurement effect avoids repeated equivalent state writes because rendered annotation arrays are re-created during normal renders.

## Phase 8: Tests

- Added UI coverage for remote comments staying collapsed until a gutter dot is clicked.
- Added UI coverage for local comment creation opening the sidebar and focusing the new body.
- Added UI coverage for one gutter dot per annotation, exact-overlap body creation, and most-recently-edited body focus.

Verification:

- `pnpm exec vitest -- run src/block-crdt/formatting.test.ts` passed.
- `pnpm exec vitest -- run examples/block-rich-text/src/annotations.test.ts` passed.
- `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed.
- `pnpm exec vitest -- run src/block-crdt/formatting.test.ts examples/block-rich-text/src/annotations.test.ts examples/block-rich-text/src/App.test.tsx` passed.
- `npm run typecheck:examples` passed.
