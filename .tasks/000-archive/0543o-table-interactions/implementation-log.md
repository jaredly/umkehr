# Implementation Log: Table Interaction Feedback

## Phase 1: Command Model

- Added table-aware command helpers in `examples/block-rich-text/src/blockCommands.ts`:
  - `deleteEmptyTableRowBackward`
  - `exitEmptyLastTableRow`
  - `splitTableTitleToParagraph`
  - `moveTableCell`
  - `commandApplied` / `noCommand` optional-command helpers
- Added command tests covering:
  - Backspace moving from a non-first empty cell to the previous cell end.
  - Backspace deleting an all-empty row.
  - Backspace not deleting rows with non-empty cells.
  - Backspace converting a one-row empty table to a paragraph.
  - Enter exiting an empty last row into a paragraph after the table.
  - Enter not exiting the only table row.
  - Table-title split moving trailing title text into a following paragraph.
  - Cell moves within a row and across rows using simple splice semantics.
- Verification: `pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts` passes.

### Issues / Workarounds

- Converting a table to a paragraph exposed a CRDT path issue: once table metadata stops exposing the virtual row parent, deleted rows still had order paths through that now-missing virtual parent. The workaround is to rehome the row subtree onto real block parents before deleting it and changing the table meta.
- `splitBlockOps` preserves trailing text and marks for normal middle/end title splits, but offset-zero table-title splits need a manual insert/delete/insert path because the primitive creates a block before the table at offset zero. That path preserves plain text but can flatten inline marks in the moved title text.

## Phase 2: Keyboard Wiring

- Wired `deleteEmptyTableRowBackward` into Backspace handling before generic deletion.
- Wired `exitEmptyLastTableRow` into non-Shift Enter handling for table cells before cell-advance/split fallback.
- Wired `splitTableTitleToParagraph` into generic split handling so Enter in a table title creates a paragraph after the table instead of another table.
- Hardened block-type changes so focusing the editable table title does not let the generic block-type dropdown convert the table block metadata.

## Phase 3: Table Title And Table-Level Layout

- Rendered the table block's own text as an editable title above the grid.
- Removed the static `Table` label and the table-local drag handle.
- The table now uses the normal left-side block drag handle through the title row.
- Styled the title as compact smallcaps/bold text.

## Phase 4: Row Gutter Reorder

- Replaced row drag glyphs with row-number buttons.
- Kept row reordering on the existing `useBlockReorder` / `moveBlock` path.
- Kept row drop indicators horizontal as decided in research.

## Phase 5: Cell Focus, Cell Drag, And Add Controls

- Removed per-cell block drag handles from rendered table cells.
- Added focused-cell border highlighting.
- Added focused-cell border drag:
  - drag starts only from the active cell border zone;
  - drop targets are calculated from row/cell geometry;
  - drop indicators are vertical bars;
  - cross-row moves call `moveTableCell` and use splice semantics.
- Added hover/focus divider controls:
  - row insertion buttons between rows;
  - column insertion buttons between columns;
  - `addTableColumn` now accepts an optional insertion index while preserving append behavior for existing callers.

## Phase 6: Tests / Verification

- Added UI tests covering:
  - editable/synced/splittable table titles;
  - row-number gutter controls;
  - absence of cell drag handles;
  - active cell highlighting;
  - geometry-mocked focused-cell border drag with vertical drop indicators.
- Updated existing table UI tests to query cells within the table grid instead of relying on global textbox indexes, since the title is now also editable.
- Verification passed:
  - `pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
  - `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
  - `pnpm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts`

## Follow-Up: Enter At Row End

- Updated `advanceFromTableCellEnd` so Enter at the last visible cell in a row creates a new row after the current row instead of creating a missing/new column.
- Kept the existing behavior where Enter can still advance to an already-existing empty cell to the right.
- Updated the command test that previously expected a missing right-side cell to expect a newly inserted row.
- Verification passed:
  - `pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
  - `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx`

## Follow-Up: Row Insert Hover Scope

- Changed row insert button visibility so hovering the table no longer reveals every row insert button at once.
- Row insert buttons now reveal only when hovering/focusing the individual row divider control.
- Verification passed:
  - `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx`

## Follow-Up: Column Insert Visibility

- The column insert controls existed in the DOM, but their zero-height overlay plus negative transform made them easy to miss and potentially clipped by the grid.
- Changed the column insert overlay to a small top divider band and moved the buttons into that band.
- Column buttons are partially visible when hovering the column-control band and fully visible on the specific button hover/focus.
- Verification passed:
  - `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx`

## Follow-Up: Table Conversion Flow

- Removed the standalone toolbar table button.
- Added `Table` to the block type dropdown.
- Added `convertBlockToTable`, which converts the focused block into a table and preserves the block's existing rich text as the editable table title.
- Updated UI tests to create tables via the block type menu and assert that converted text becomes the table title.
- Verification passed:
  - `pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
  - `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx`

### Remaining Caveats

- Offset-zero table-title splits can flatten inline marks in the moved title text, as noted above.
- The cell border drag test uses mocked DOM geometry and `document.elementsFromPoint`; real-browser manual verification is still useful for pointer feel and hover-control placement.
