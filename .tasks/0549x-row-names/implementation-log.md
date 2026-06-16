# Implementation Log

## Phase 1: Core Block CRDT Helper APIs

- Added `visibleSiblingAnchorsForBlock(state, blockId, config)` and exported `VisibleSiblingAnchors`.
- Added `nextBlockIdForActor(state, actor)` and used it in `insertBlockOps`.
- Extended `deleteBlockOps(..., {mode: 'subtree'})` with `virtualParents` support.
- Extended `markSelectionOps` with optional `virtualParents` for virtual-parent-aware block ordering.
- Exported the new helpers from `src/block-crdt/index.ts`.
- Added core tests covering virtual-parent subtree deletion, block-id sibling anchors, next block id prediction, and selection marking across virtual-parent-visible blocks.

Issues/workarounds:

- Virtual parent Lamports in block order paths advance `maxSeenCount`. Initial tests assumed row ids like `[2, actor]`; fixed tests to read ids from generated ops instead.
- Root insertion in a non-empty root requires explicit sibling anchors; fixed the test to insert after the existing root block.

Verification:

- `npm exec vitest -- run src/block-crdt/index.test.ts` passed.

## Phases 2-3: Row Header Command Semantics

- Made `table_row` blocks editable via `isEditableBlock`.
- Added `splitTableRowHeader` and wired it before generic split handling in `splitBlockEverywhere`.
- Added `deleteTableRowHeaderBackward` and wired it before generic Backspace handling in `deleteBackwardEverywhere`.
- Updated row emptiness so row header text counts; the old first-cell empty-row delete no longer deletes rows with non-empty headers.
- Added join guards so generic Backspace/Delete does not merge row headers into cells or unrelated blocks.
- Replaced the example-local subtree delete implementation with virtual-parent-aware `deleteBlockOps(..., {mode: 'subtree', virtualParents})`.
- Added tests for row-header split, offset-0 split, empty-row deletion, only-row table conversion, non-empty-cell cursor movement, and first-cell compatibility.
- Updated the multi-selection traversal test to expect row headers in horizontal movement.

Issues/workarounds:

- Generic `splitBlockOps` at offset `0` creates an empty block before the current block. Row headers need the new row after the current row with all trailing text moved, so `splitTableRowHeader` handles offset `0` manually by inserting a row after the current row and moving the first visible character subtree.
- Converting a one-row table to a paragraph after deleting the row must rehome the visible subtree first. Without that, deleted cell blocks can retain order paths through the table's virtual row parent after the table meta changes, causing block order validation failures.

Verification:

- `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts` passed.

## Phase 4: Row Header Rendering

- Added a compact `TableRowHeader` renderer inside the first table column.
- Row headers use `RichTextEditableSurface`, so they render formatted text, retained selection decorations, links, popover triggers, and footnotes consistently with other editable text.
- Empty row headers expose the current row index through `data-placeholder`; CSS renders it visibly.
- Kept row drag as a compact handle in the row header cell.
- Updated table grid CSS and responsive overrides from a narrow controls column to a usable row-header column.
- Updated the existing App test that previously expected row numbers inside drag buttons; row numbers now live in row header placeholders.

Issues/workarounds:

- The main editor already captures selection changes at the root, so the row header component does not need separate selection state plumbing.
- The local test environment does not use jest-dom matchers; placeholder assertions use `getAttribute`.

Verification:

- `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/App.test.tsx` passed.

## Phase 5-6: Broad Verification

- Ran the broader automated suites for the core CRDT and the block-rich-text example.
- Ran the block-rich-text production build.
- Started the Vite dev server on `http://127.0.0.1:5174/` for UI verification setup, then stopped it after checks.

Issues/workarounds:

- The in-app Browser connector reported `Browser is not available: iab`, so I could not complete an interactive browser check through the Browser plugin.
- `npm run build` printed `Error connecting to agent: Operation not permitted` before the npm script output, but TypeScript and Vite completed successfully.

Verification:

- `npm exec vitest -- run src/block-crdt/index.test.ts examples/block-rich-text/src` passed.
- `npm run build` in `examples/block-rich-text` passed.
- Confirmed the local dev server no longer responds on port `5174` after stopping it.

## Follow-up: Content-Sized Row Header Column

- Kept empty row headers rendered as editable surfaces with visible row-index placeholders from `data-placeholder`.
- Replaced the explicit compact/wide mode with a content-sized row-header grid track using `fit-content(...)`, so empty headers naturally keep the column small and contentful headers can grow up to the track limit.
- Moved row drag handles into a left table gutter and made them visible on row hover/focus instead of occupying row-header column width.
- Updated App coverage for row-index placeholders and gutter row drag handles.
- Fixed a CSS cascade bug where the generic `.editableBlock[data-empty="true"]::before` rule overrode row-header placeholder content; row headers now use the more specific `.editableBlock.tableRowHeaderText[data-empty="true"]::before`.

Verification:

- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed.
- `npm exec vitest -- run src/block-crdt/index.test.ts examples/block-rich-text/src` passed.
- `npm run build` in `examples/block-rich-text` passed. The build still prints the non-fatal `Error connecting to agent: Operation not permitted` before TypeScript/Vite complete successfully.
