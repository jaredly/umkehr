# Research: Table Cell Drag Targets

## Goal

Update `examples/block-rich-text` table dragging so:

- Cell drags can leave the table and behave like normal block drags.
- Cell drags can target the spaces between table rows, inserting the dragged cells as a new row.
- Dragging blocks from outside a table can target cell insertion slots, shown as vertical lines between cells, not only row insertion slots.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`

There are currently two drag systems.

`useBlockReorder.ts` handles normal block dragging. It receives the visible block outline, registers row elements through `registerRow`, calculates `DropTarget`, and calls `onMove(blockIds, target)` with a `MoveTarget`:

```ts
export type MoveTarget =
    | {type: 'before'; targetBlockId: string}
    | {type: 'after'; targetBlockId: string}
    | {type: 'child'; parentBlockId: string; at: 'start' | 'end'};
```

`App.tsx` wires this to `moveBlock(...)`. Table row elements call `context.registerRow(row.block.id, element)`, so normal block drag can already target rows. Tests confirm:

- `moves table rows out of the table as normal blocks`
- `moves normal blocks into a table as rows`
- `keeps Tab navigation working after generic row drag reorder`

`TableBlock` in `App.tsx` separately handles cell dragging with local `cellDrag` state. The drag target is `{rowId, index}` and is discovered by `tableCellDropTargetFromPoint(clientX, clientY)`, which only scans `document.elementsFromPoint(...)` for `[data-row-id]`, then derives a column index from `.tableCell[data-cell-id]` children. That means cell drags are limited to row elements inside the current table.

The command layer already supports moving cell blocks within a table:

- `moveTableCell(state, cellId, {rowId, index}, context)` moves a cell block, preserving child subtree.
- `moveTableCellRectangleContents(...)` moves rectangular selection contents, not the cell blocks.
- Full-column drag in `App.tsx` loops over selected column cells and calls `moveTableCell(...)` per row.

Current CSS has row indicators for `.tableRow.dropBefore/dropAfter` and vertical cell indicators for `.tableCell.cellDropBefore/cellDropAfter`.

## Important Model Details

Tables are represented as normal blocks:

- Table block: `meta.type === 'table'`
- Rows: direct visible children of the table block, with non-table metadata
- Cells: direct visible children of row blocks

Because cells and rows are normal block nodes, `moveBlock(...)` can move a cell out of the table in principle. The current UI does not route cell drags to that path.

`moveBlock(...)` already has table-aware restrictions:

- It refuses to move a block as a child of a table row through generic child intent.
- It allows `before` / `after` targets whose visible parent is a row, which is how an outside block can become a cell if the target is a cell block.

That last point is the key implementation opportunity for outside-block-to-cell drops: if the normal block drag system can produce `{type: 'before' | 'after', targetBlockId: cellId}`, existing `moveBlock(...)` should insert the dragged block as a cell sibling in that row.

## Gaps

### 1. Cell Drag Cannot Leave The Table

`cellDrag` only asks `tableCellDropTargetFromPoint(...)` for `{rowId, index}`. If the pointer is outside a row, there is no target and pointer-up does nothing.

Likely implementation:

- Let cell drag target resolution return a union:
  - `{kind: 'cell-slot'; rowId: string; index: number}`
  - `{kind: 'row-slot'; tableId: string; beforeRowId: string | null; afterRowId: string | null; index: number}`
  - `{kind: 'block'; command: MoveTarget}`
- For `kind: 'block'`, dispatch selected cells through `moveBlock(...)`, ordered the same way as normal block drags.
- For single-cell drag this should move the cell block and its subtree out of the table.
- For selected full-column drag, dropping outside probably means move each selected cell block out as normal blocks, preserving document order.

### 2. Cell Drag Needs Between-Row Targets

The current row insert controls are buttons, not drag targets. Dropping cells in the space between rows should create a new row and move the cells into it.

Likely command helper:

- Add a command in `blockCommands.ts`, e.g. `moveTableCellsToNewRow(state, cellIds, target, context)`.
- Insert a new row under the table using `insertBlockOps(...)` with anchors derived from the row slot.
- Move each dragged cell into the new row in order with `moveBlockOps(...)`.
- Do not auto-fill missing columns unless product wants rectangular normalization. The task explicitly allows “possibly with missing columns,” and current rendering already supports missing cells.

UI target discovery can use row geometry:

- If pointer is in a `tableRowInsertControl`, return row slot after that row.
- Or calculate row gaps from the registered row/table DOM rects and treat a narrow vertical band around each row boundary as a row slot.
- Add a row-level indicator style distinct from normal row block reorder if needed; existing `.tableRow.dropBefore/dropAfter` may be reusable.

### 3. Outside Blocks Need Cell Drop Targets

Normal block dragging currently registers rows, and `resolveDropTarget(...)` only returns row before/after or child targets based on a hovered registered element. Cell elements are not registered with `useBlockReorder`, so the generic drag system cannot target vertical lines between cells.

Likely implementation options:

1. Extend `useBlockReorder` to accept optional cell-slot geometry and return `MoveTarget` with `targetBlockId` set to the adjacent cell. This reuses `moveBlock(...)`.
2. Keep `useBlockReorder` generic for block rows and add table-cell drop target discovery in `App.tsx`, then merge its visual state with `dropTarget`.

Option 1 looks cleaner if `BlockOutlineItem` grows enough metadata to know whether a hovered block is a table cell. Option 2 may be less invasive because table DOM and cell rendering already live in `App.tsx`.

For an outside block dropped into an empty/missing cell slot, a direct adjacent cell may not exist. The code may need a helper that creates a missing cell or inserts relative to the row's current cell list. For slots between existing cells, `moveBlock(..., {type: 'before' | 'after', targetBlockId: cellId})` should be enough.

## Suggested Implementation Plan

1. Add table-structure helpers that are exported or colocated where UI/commands need them:
   - identify whether a block id is a table row or table cell
   - get table rows and row cells
   - build row-slot anchors

2. Generalize table drag targets in `App.tsx`:
   - replace `{rowId, index}` cell drag targets with a union target type
   - keep existing cell-slot behavior for intra-table drops
   - add row-slot behavior to create a new row and move selected cells into it
   - add block-target behavior to move dragged cells out of the table through `moveBlock(...)`

3. Add cell-slot discovery for generic block dragging:
   - detect pointer over `.tableCell[data-cell-id]` or a table row cell gap
   - return a vertical-line indicator and a `MoveTarget` targeting the adjacent cell
   - prevent no-op and descendant drops using the same logic as `useBlockReorder`

4. Update visuals:
   - reuse `.tableCell.cellDropBefore/cellDropAfter` for vertical cell targets
   - add row-gap indicator classes if `.tableRow.dropBefore/dropAfter` are not enough
   - make sure table cell and row indicators do not both show for the same pointer position

5. Add tests:
   - cell drag outside table inserts the cell as a normal block before/after a non-table block
   - cell drag into the gap between rows creates a new row containing the moved cell
   - multiple selected cells dragged into a row gap create one new row with those cells, preserving order
   - outside normal block drag over a cell boundary inserts the block as a cell in that row
   - outside normal block drag over an empty/missing column slot has the chosen behavior

## Open Questions

1. When dragging a rectangular multi-cell selection outside the table, should it move the selected cell blocks as normal blocks, or keep the current “move cell contents” behavior?
    - it should create a "parent table" and row parents for them
2. When dragging multiple cells into a row gap, should the new row contain exactly the dragged cells, or should it pad missing columns to the table's current column count?
    - exactly the dragged cells
3. Should dragging an outside block to a missing cell slot create a cell at that column, or only support vertical boundaries adjacent to existing cells?
    - sure
4. If dragging cells out leaves a row empty, should the empty row remain, be deleted, or only be deleted when all cells are gone and the row header is empty?
    - remain. only dragging the whole row out (including the header) would remove the row
5. Should dropping a table cell outside preserve its identity as a plain block with its current metadata, or normalize it to a paragraph if it originated structurally as a cell?
    - preserve block type and meta
