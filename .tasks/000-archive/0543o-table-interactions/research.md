# Research: Table Interaction Feedback

## Goal

Improve the block rich-text table interactions in `examples/block-rich-text`:

- Backspace at the start of an empty cell should delete the row when every cell in that row is empty.
- Cell drag should feel more like Google Sheets: no per-cell drag handle, focused cell border highlight, drag from the cell border, and vertical drop indicators.
- The row gutter should show row numbers and allow row reordering.
- The table block drag handle should use the normal block-handle placement off to the left.
- The table block's own text should be rendered/editable as a table title, styled smallcaps/bold, instead of a static `Table` label.
- Splitting the table title should create a new paragraph block after the table.
- Enter in the last row should delete that row and create a paragraph after the table when every cell in the last row is empty and the table has another row.

## Current Structure

The active implementation is in `examples/block-rich-text`:

- `src/App.tsx` renders the editor, table UI, and shared rich-text editable surface.
- `src/blockCommands.ts` owns the table CRDT commands.
- `src/useBlockReorder.ts` owns generic block/row drag target detection.
- `src/style.css` owns the table grid, row gutter, drag handles, and drop indicators.
- `src/blockCommands.test.ts` and `src/App.test.tsx` already have meaningful table coverage.

Tables are represented as normal blocks with `meta.type === 'table'`; table rows are structural blocks with `meta.type === 'table_row'`; cells are ordinary editable blocks parented under rows. A table owns a virtual `rowParent`, and `annotationVirtualParents` / `tableVirtualParentsForBlock` make the row parent materialize beneath the table.

The table block itself already has text storage because it is a normal block. It is just not rendered today as an editable surface inside `TableBlock`.

## Rendering Findings

`TableBlock` currently renders:

- a `.tableToolbar` with a table-local drag handle, static `Table` label, `+ Row`, and `+ Col` buttons;
- a `.tableGrid` of `.tableRow`s;
- a `.tableRowControls` gutter with a `Move row` button;
- each cell via `renderTableCell`, which delegates to `renderEditableBlock({...node.block, depth: 0}, context)`.

Relevant code:

- `examples/block-rich-text/src/App.tsx:1478` routes table blocks to `TableBlock`.
- `examples/block-rich-text/src/App.tsx:1499` starts `TableBlock`.
- `examples/block-rich-text/src/App.tsx:1518` renders the current `.tableToolbar`.
- `examples/block-rich-text/src/App.tsx:1539` renders row controls.
- `examples/block-rich-text/src/App.tsx:1562` renders cells through `renderTableCell`.
- `examples/block-rich-text/src/App.tsx:1580` makes cell content use the normal `EditableBlock`.
- `examples/block-rich-text/src/App.tsx:2710` is the normal `EditableBlock` row layout and left-side block drag handle.

Implications:

- To make the title editable, `TableBlock` should render the table node's own text via the same `RichTextEditableSurface` path. The simplest local reuse is to call `renderEditableBlock(node.block, context)` or introduce a title-specific wrapper that renders the table's editable surface without the generic block affordance duplication.
- If `renderEditableBlock(node.block, context)` is used directly inside `TableBlock`, the table gets the normal left-side drag handle placement for free. The generic block row would need title-specific styling and probably no inline block controls.
- Cell drag handles currently come from normal cell `EditableBlock`s because cells render full `.blockRow`s. Removing the per-cell drag handle means `EditableBlock` needs either an `isTableCell` branch that suppresses `.dragHandle` or a more specialized `TableCellBlock` render path.
- The row gutter already exists as `.tableRowControls`; it currently shows a button with `⋮`. It can become a row-number drag affordance while keeping the `context.startDrag(row.block.id, event)` path.

## Keyboard/Command Findings

Current Backspace behavior:

- `EditableBlock` intercepts Backspace and calls `onDeleteBackward` unconditionally.
- `deleteBackward` deletes a character when offset > 0, otherwise calls `joinWithPrevious`.
- `joinWithPrevious` allows joining cells inside the same table row, and blocks joins across rows.

Relevant code:

- `examples/block-rich-text/src/App.tsx:2815` intercepts Backspace.
- `examples/block-rich-text/src/blockCommands.ts:91` implements `deleteBackward`.
- `examples/block-rich-text/src/blockCommands.ts:874` implements `joinWithPrevious`.
- `examples/block-rich-text/src/blockCommands.test.ts:298` explicitly tests joining same-row cells but blocking cross-row joins.

Needed change:

- Add a table-aware delete command before falling back to generic `deleteBackward`.
- It should only trigger for a collapsed caret at offset 0 in a table cell, where the cell is empty and every visible cell in the row is empty.
- It should delete the `table_row` block, not join cells, and move selection somewhere predictable, likely first cell of the previous row if present, otherwise first cell of the next row.
- The CRDT primitive `deleteBlockOps` is exported by `umkehr/block-crdt` and can be imported into `blockCommands.ts` for this.
- Preserve the existing same-row cell join behavior for non-empty rows unless the product decision changes.

Current Enter behavior:

- `EditableBlock` intercepts Enter.
- In table cells, Enter calls `advanceFromTableCellEnd` for non-Shift Enter.
- `advanceFromTableCellEnd` only moves/creates a cell to the right when the caret is at the cell end. If there is no next column, it returns `null`, and the caller falls back to `splitBlockEverywhere`.
- `splitBlock` uses `splitBlockOps` and inherits the current block's metadata. For a table title, this would split the table block into another table-type block unless special-cased.

Relevant code:

- `examples/block-rich-text/src/App.tsx:2791` handles Enter.
- `examples/block-rich-text/src/blockCommands.ts:139` implements `splitBlock`.
- `examples/block-rich-text/src/blockCommands.ts:560` implements `advanceFromTableCellEnd`.

Needed changes:

- Add a table-title split command. When the active block meta is `table`, Enter should insert a new paragraph sibling after the table and place the caret there, instead of using `splitBlockOps`.
- Add an "exit table from empty last row" command. When Enter is pressed in a cell in the last row, all cells in that row are empty, the row is not the only row, and the selection is collapsed, delete that row and insert a paragraph block immediately after the table.
- This should run before `advanceFromTableCellEnd`/generic split fallback.

## Drag/Drop Findings

Generic block/row drag is implemented by `useBlockReorder`:

- It registers rows by block id.
- It computes before/after/child targets based on pointer Y and X.
- It emits horizontal before/after indicators.
- It prevents invalid table row moves through `moveBlock` and `isValidTableRowMoveTarget`.

Relevant code:

- `examples/block-rich-text/src/useBlockReorder.ts:10` defines `DropTarget`.
- `examples/block-rich-text/src/useBlockReorder.ts:35` finds drop targets.
- `examples/block-rich-text/src/blockCommands.ts:648` implements `moveBlock`.
- `examples/block-rich-text/src/blockCommands.ts:686` restricts table rows to row siblings.
- `examples/block-rich-text/src/style.css:473` styles current row drop indicators as horizontal bars.

Rows:

- Row reordering can keep using `useBlockReorder` and `moveBlock`; changing the gutter to row numbers is mostly render/CSS.
- Since rows are grid rows, horizontal drop bars are currently reasonable for row moves. The task's "vertical bars instead of horizontal" appears to target cell drop locations, not row drop locations.

Cells:

- There is no dedicated cell reordering command today.
- Cell blocks can currently be dragged as generic blocks because cells render full `EditableBlock`s with normal drag handles.
- Generic block drag inside cells is not Google-Sheets-like: it uses block-row drop math and horizontal indicators inside the cell.

Needed cell work:

- Add a cell-specific drag model separate from `useBlockReorder`, likely local to `TableBlock`.
- Start drag from the focused cell border rather than from a button.
- Track focused/active cell by selection focus block id or DOM focus inside `.tableCell`.
- Compute drop targets by column boundaries within the row grid and show vertical indicators between cells.
- Add a command for moving a cell within a row, or more generally moving a block whose parent is a `table_row` before/after another cell in the same row. Existing `moveBlock` may already do the operation, but a cell-specific command should validate same-row or explicit cross-row behavior.

## CSS Findings

Current table CSS is concentrated around:

- `.tableBlock`, `.tableToolbar`, `.tableGrid`, `.tableRow`, `.tableRowControls`, `.tableCell`.
- `.tableCell .dragHandle` explicitly sizes per-cell drag handles.
- `.editableBlock:focus` applies a subtle focus background/inner border to all editable blocks.

Relevant code:

- `examples/block-rich-text/src/style.css:398` begins table block styling.
- `examples/block-rich-text/src/style.css:403` styles the table toolbar and static label.
- `examples/block-rich-text/src/style.css:466` defines rows.
- `examples/block-rich-text/src/style.css:505` defines row controls.
- `examples/block-rich-text/src/style.css:514` defines cells.
- `examples/block-rich-text/src/style.css:552` styles cell drag handles.
- `examples/block-rich-text/src/style.css:595` styles focused editable blocks.

Likely CSS changes:

- Replace `.tableToolbar span` label styling with `.tableTitle` applied to the table block text.
- Move `+ Row` and `+ Col` controls somewhere that does not compete with the title, or keep them in a compact toolbar after/below the title.
- Hide `.tableCell .dragHandle` or avoid rendering it.
- Add `.tableCell:focus-within` border highlight.
- Add a narrow pointer-sensitive border zone for dragging cells. This may need overlay elements so text selection inside the cell remains ergonomic.
- Add `.tableCellDropBefore` / `.tableCellDropAfter` or similar vertical indicators.

## Testing Surface

Existing command tests already cover table creation, row movement, Tab navigation, same-row joins, and Enter-to-next-cell behavior. New command-level tests should cover:

- Backspace in an empty first cell of an all-empty row deletes that row.
- Backspace in an empty cell in a row with non-empty sibling cell does not delete the row.
- Backspace in a non-empty cell keeps normal character deletion.
- Enter in an all-empty last row deletes the row and inserts a paragraph after the table when there is more than one row.
- Enter in the only row does not delete the row.
- Enter in a non-last row keeps existing cell advance behavior.
- Enter in the table title inserts a paragraph after the table, not another table.

UI tests in `App.test.tsx` should cover:

- The table title appears as an editable `Block text` surface and can sync between replicas.
- Row gutter renders row numbers and row drag still reorders rows.
- Cell drag starts from a focused cell border and shows vertical drop indicators.
- The old cell drag handles are not rendered.
- The table-level drag handle is in the same left placement as other block rows.

## Open Questions

- Should Backspace delete any all-empty row from any empty cell at offset 0, or only when the focused cell is the first cell in that row? The task says "in an empty cell at the start of a row", which likely means first cell, but it could mean caret at offset 0 in any empty cell.
    - if not at offset 0, it should act as a shift-tab, moving the caret to the previous cell in the row
- After deleting a row with Backspace, where should the caret land: previous row same column, previous row first cell, next row same column, or table title?
    - previous row last cell, focused at the end
- Should an empty row count cells with only whitespace as empty, or only zero-length CRDT text?
    - zero-length
- Should Backspace delete the only remaining row if all cells are empty? The Enter requirement explicitly says not if it is the only row; the Backspace requirement does not say.
    - if it's the only row, delete the row and convert the table block to a paragraph.
- For cell drag, should cells be reorderable only within a row, or can a cell move across rows/columns?
    - it can move across rows/columns
- If a table has sparse rows, should dragging cells preserve sparse structure, create missing cells, or normalize the row shape?
    - don't work too hard. dragging a cell to a spot splices it into the row at that position.
- Should row drag drop indicators stay horizontal while cell drop indicators become vertical, or should the task's vertical-bar request apply to row dragging too?
    - correct. row drag stays horizontal.
- Where should `+ Row` / `+ Col` controls live after removing the static table label and moving the table drag handle left?
    - on-hover buttons that show up on the dividers between rows/columns.
- Should splitting the table title split title text at the caret and move the trailing title text into the new paragraph, or should it always create an empty paragraph after the table?
    - yes, trailing title goes into the new paragraph

## Recommended Implementation Shape

1. Add table-aware command helpers in `blockCommands.ts`: `deleteEmptyTableRowBackward`, `exitEmptyLastTableRow`, and `splitTableTitleToParagraph`.
2. Wire those helpers in `EditableBlock` before generic Backspace/Enter fallbacks.
3. Refactor `TableBlock` so the table block text is rendered as a title and the table's drag handle comes from the same left-placement pattern as normal blocks.
4. Convert row gutter buttons to row numbers that start row drag.
5. Suppress per-cell block drag handles and add focus-within border styling.
6. Add dedicated cell drag/drop state and vertical indicators after keyboard/title/row behavior is covered by tests.
