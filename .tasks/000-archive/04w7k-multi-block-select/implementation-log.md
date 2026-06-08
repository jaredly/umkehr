# Implementation Log

## Phase 1: Focused Tests

- Added command-level coverage for cross-block Backspace/Delete, including boundary-only selections, reversed ranges, and multi-block ranges.
- Added selection-set command coverage for single retained cross-block ranges and merged overlapping cross-block ranges.
- Added UI-level coverage for single-selection Shift+Arrow across block boundaries and visual vertical intent.

## Phase 2: Cross-Block Range Deletion

- Added `deleteSelectionAndJoinBoundaries` in `blockCommands.ts`.
- Non-collapsed `deleteBackward` and `deleteForward` now delete selected chars, then join all visible blocks covered by the normalized range into the first block.
- Boundary-only cross-block selections are treated as boundary selections even when no characters are selected.
- Also routed `insertText` and `splitBlock` through the same helper so replacing a cross-block selection joins the selected boundary before inserting/splitting.

## Phase 3: Single-Selection Shift+Arrow

- Removed the `hasMultipleSelections` gate for Shift+ArrowLeft/Right, so single-selection mode uses the retained selection-set extension path.
- Added a DOM-aware single-selection Shift+ArrowUp/Down path that measures the focus-side caret x-coordinate and preserves it across repeated vertical extensions.
- Added `readSelectionFocusHorizontalIntent` to `domSelection.ts` so range focus geometry can be measured without collapsing the live selection.

## Issues And Fixes

- `mergeOverlappingRanges` originally ignored boundary-only cross-block ranges because `normalizeSelectionSegments` returns no character segments for them. Fixed `selectionSet.ts` to derive a span from anchor/focus when a non-collapsed range has no selected character segments.
- Initial UI replacement tests exposed that `insertText` still used the old char-only delete helper. Fixed by routing replacement through the new boundary-joining helper.
- Updated the old Shift+ArrowDown UI expectation because single-selection vertical Shift+Arrow is now intentionally custom-handled.
- Follow-up: boundary-adjacent range endpoints had no visible affordance when no highlight pixels appeared in the endpoint block. Added range edge caret decorations for cross-block range endpoints at offset `0` or block end. Boundary-only selections now render carets on both sides; partial selections that end just over a boundary render a caret at that endpoint.

## Verification

- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts` passed: 21 tests.
- `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts` passed: 15 tests.
- `npm exec vitest -- examples/block-rich-text/src/App.test.tsx` passed: 43 tests.
- `npm exec vitest -- examples/block-rich-text/src/selectionSet.test.ts` passed: 6 tests.
- `npm exec vitest -- examples/block-rich-text/src` passed: 6 files, 97 tests.
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit` passed.
