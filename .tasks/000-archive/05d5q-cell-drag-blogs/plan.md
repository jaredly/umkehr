# Plan: Table Cell Drag Targets

## Phase 1: Extract Table Drag Model

Define explicit target and payload types so the UI no longer treats all table cell drags as `{rowId, index}`.

- Add local or exported types for table drag targets:
  - `cell-slot`: existing intra-row/intra-table cell insertion target.
  - `row-slot`: gap between rows in a table.
  - `block-slot`: normal block drop target outside the table.
- Add helper functions for table structure:
  - identify table rows and table cells by block id.
  - list rows for a table and cells for a row.
  - identify dragged cell groups from the current selection.
  - keep source rows even if all cells are moved out.
- Reuse existing command-layer table semantics where possible:
  - `moveBlock(...)` for block-level movement.
  - `moveTableCell(...)` for existing same-table cell-slot movement.
  - `insertBlockOps(...)` and `moveBlockOps(...)` for new table/row construction.

## Phase 2: Add Command Helpers

Add focused helpers in `blockCommands.ts` with unit coverage before wiring UI.

- Add `moveTableCellsToNewRow(...)`:
  - insert one new row under the target table at the row gap.
  - move exactly the dragged cell blocks into that row, preserving order.
  - do not pad missing columns.
  - preserve each moved block's metadata and subtree.
  - leave source rows in place, even if empty.
- Add `moveTableCellsOutAsBlocks(...)` for single cells and full-column style selections:
  - move each selected cell block to a normal `MoveTarget`.
  - preserve block type, metadata, text, and children.
  - order moves to match visible document order and target placement.
- Add `moveCellRectangleOutToNewTable(...)`:
  - when dragging a rectangular multi-cell selection outside the table, create a new table block at the normal block target.
  - create row parents matching the selected rectangle's row grouping.
  - move the selected cell blocks into those new row parents.
  - preserve cell block metadata and children.
  - leave the original rows in place.
- Add a helper for dropping a normal block into a missing cell slot:
  - create or target a cell position at the requested column.
  - support vertical boundaries adjacent to existing cells and missing slots.

## Phase 3: Generalize Cell Drag UI

Update `TableBlock` in `App.tsx` so cell drags can resolve all target kinds.

- Replace `cellDrag.target: {rowId, index} | null` with the new target union.
- Update pointer move/up logic:
  - resolve cell-slot first when pointer is over a cell boundary.
  - resolve row-slot when pointer is in the space between rows.
  - resolve block-slot through the normal block drag target resolver when pointer leaves the table.
- Dispatch by target kind:
  - cell-slot: keep current `moveTableCell(...)` / column movement behavior.
  - row-slot: call `moveTableCellsToNewRow(...)`.
  - block-slot with one cell or full-column cells: call `moveTableCellsOutAsBlocks(...)`.
  - block-slot with rectangular selection: call `moveCellRectangleOutToNewTable(...)`.
- Ensure drag cancellation and pointer capture behavior stays consistent with current cell drag behavior.

## Phase 4: Add Cell Targets To Normal Block Drag

Let outside blocks target vertical cell insertion slots.

- Extend the generic drag target discovery path so it can detect table cell slots.
- Return a `MoveTarget` that targets adjacent cells when possible:
  - before first cell: `{type: 'before', targetBlockId: firstCellId}`.
  - between cells: before/after the adjacent cell, matching existing splice semantics.
  - after last cell: `{type: 'after', targetBlockId: lastCellId}`.
- For missing cell slots, call the helper from Phase 2 rather than relying only on adjacent existing cells.
- Keep existing row drop targets for outside blocks:
  - row gaps still insert blocks as rows.
  - cell boundaries insert blocks as cells.
- Preserve no-op and subtree safety checks from `useBlockReorder`.

## Phase 5: Visual Indicators

Make target feedback unambiguous.

- Reuse `.tableCell.cellDropBefore` and `.tableCell.cellDropAfter` for vertical cell-slot targets.
- Add or reuse row-gap indicator classes for row-slot targets.
- Show only one target indicator at a time:
  - cell-slot wins over row-slot when over a vertical cell boundary.
  - row-slot wins over normal block row before/after when inside the table gap.
  - block-slot uses the existing normal block drop indicator outside the table.
- Verify indicators still work in nested tables and horizontally scrolled table grids.

## Phase 6: Tests

Add command tests first, then UI tests.

- Command tests in `blockCommands.test.ts`:
  - moves selected cells into a new row with exactly those cells.
  - moving all cells out of a row leaves the row.
  - preserves moved cell metadata and child subtree.
  - rectangular outside drag creates a new table with row parents.
  - outside block dropped into a missing cell slot creates/uses that slot.
- UI tests in `App.test.tsx`:
  - single cell drag outside table becomes a normal block.
  - full-column cell drag outside table moves those cells as normal blocks.
  - rectangular selection drag outside creates a new table.
  - cell drag into a row gap creates a row with exactly the dragged cells.
  - outside block drag over a cell boundary shows a vertical indicator and inserts as a cell.
  - outside block drag over row gap still inserts as a row.

## Phase 7: Verification

Run focused tests first, then broader example tests.

- `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
- If the focused suites pass, run the package's normal test command for this example if available.

Manual checks:

- Drag cells out before, after, and between normal blocks.
- Drag a rectangular selected region out and confirm it becomes a table.
- Drag into row gaps at the top, middle, and bottom of a table.
- Drag outside blocks into first, middle, last, and missing cell positions.
- Confirm empty source rows remain visible/editable.
