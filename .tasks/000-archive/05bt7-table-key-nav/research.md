# Research: Table Keyboard Navigation

## Goal

Improve keyboard arrow navigation in `examples/block-rich-text` tables:

- `ArrowUp` / `ArrowDown` from a table cell should move to the same column in the previous/next row, not to the adjacent editable block in document order.
- `ArrowLeft` / `ArrowRight` should continue moving between cells, but should not get trapped in row header/block contents when the user is navigating table cells.

## Current Structure

The active implementation is in the block rich text example:

- `examples/block-rich-text/src/App.tsx` renders tables and handles DOM keyboard events.
- `examples/block-rich-text/src/multiSelectionCommands.ts` owns command-level selection movement for multi-selection and modified movement.
- `examples/block-rich-text/src/blockCommands.ts` owns table structure helpers and commands.
- `examples/block-rich-text/src/domSelection.ts` reads/restores DOM selections and computes visual-line caret intent.
- `examples/block-rich-text/src/App.test.tsx` and `examples/block-rich-text/src/blockCommands.test.ts` are the most relevant test surfaces.

Tables are rendered as nested editable blocks:

- The table title is rendered through `renderEditableBlock(node.block, context)`.
- Each table row renders `TableRowHeader`, which is also an editable surface for the row block text.
- Each cell renders `renderEditableBlock({...node.block, depth: 0}, context)`.
- Cell children, if any, render as nested block content inside `.tableCellChildren`.

Relevant code:

- `examples/block-rich-text/src/App.tsx:1976` renders the table grid.
- `examples/block-rich-text/src/App.tsx:1979` renders the editable table title.
- `examples/block-rich-text/src/App.tsx:2035` renders the row header.
- `examples/block-rich-text/src/App.tsx:2036` renders cells in column order.
- `examples/block-rich-text/src/App.tsx:2120` renders a table cell via the normal editable block path.
- `examples/block-rich-text/src/App.tsx:2358` derives `previousBlockId` / `nextBlockId` from `context.blocks`, the materialized block order.

## Current Arrow Behavior

Plain single-caret arrow navigation mostly lets the browser handle movement inside a block. The app intercepts only boundary cases:

- `ArrowLeft` at offset `0` moves to `previousBlockId`.
- `ArrowRight` at block end moves to `nextBlockId`.
- `ArrowUp` on the first visual line moves to `previousBlockId` with x-position preservation.
- `ArrowDown` on the last visual line moves to `nextBlockId` with x-position preservation.

Relevant code:

- `examples/block-rich-text/src/App.tsx:3929` handles left at block start.
- `examples/block-rich-text/src/App.tsx:3944` handles right at block end.
- `examples/block-rich-text/src/App.tsx:3959` handles up from the first visual line.
- `examples/block-rich-text/src/App.tsx:3974` handles down from the last visual line.
- `examples/block-rich-text/src/App.tsx:1485` restores vertical movement to a target block using caret x intent.

This explains both reported problems:

- Up/down uses materialized editable block order, so moving down from a cell can go to the next cell in the same row or to nested cell content, not to the same column in the next row.
- Left/right boundary movement also uses materialized editable block order, which includes row header block text and nested child blocks. That makes table cell navigation enter row header contents or child block contents when the expected table-grid target is another cell.

Modified/multi-selection movement has the same flat-order assumption:

- `movePointVertically` uses `editableBlockIds(state)` and moves to the previous/next editable block.
- `movePointHorizontally` crosses block boundaries using the same flat list.

Relevant code:

- `examples/block-rich-text/src/multiSelectionCommands.ts:606` implements flat vertical movement.
- `examples/block-rich-text/src/multiSelectionCommands.ts:618` implements flat horizontal movement.
- `examples/block-rich-text/src/App.tsx:1342` wires command-level horizontal movement.
- `examples/block-rich-text/src/App.tsx:1352` wires command-level vertical movement.
- `examples/block-rich-text/src/App.tsx:1382` extends a single selection vertically with visual x intent, also via `editableBlockIds`.

## Existing Table Helpers

`blockCommands.ts` already has the table context machinery needed for grid-aware navigation:

- `tableCellContext(state, blockId)` resolves table id, row id, row index, and column index for a cell block.
- `tableRowContext(state, rowId)` resolves table id and row index for a row block.
- `tableRows(state, tableId)` returns visible row ids.
- `tableCells(state, rowId)` returns visible cell ids for a row.
- `tableColumnCount(state, tableId)` returns the current maximum column count.

Relevant code:

- `examples/block-rich-text/src/blockCommands.ts:1526` defines `tableCellContext`.
- `examples/block-rich-text/src/blockCommands.ts:1553` defines `tableRowContext`.
- `examples/block-rich-text/src/blockCommands.ts:1567` defines `tableRows`.
- `examples/block-rich-text/src/blockCommands.ts:1573` defines `tableCells`.
- `examples/block-rich-text/src/blockCommands.ts:1579` defines `tableColumnCount`.

These helpers are currently local to `blockCommands.ts`, so a navigation implementation either needs to export focused helper functions or define table-navigation commands in `blockCommands.ts`.

## Recommended Implementation Shape

Add table-aware selection navigation helpers rather than special-casing only the React key handler.

Suggested API shape:

```ts
export const moveTableSelectionByArrow = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'left' | 'right' | 'up' | 'down',
    options?: {verticalOffset?: 'preserve' | 'start' | 'end'},
): EditorSelection | null;
```

The helper should return `null` when the focus is not in a table cell or no table-grid target exists, allowing existing generic behavior to continue.

Behavior:

- `ArrowUp`: from a cell, target the cell at the same column index in the previous row.
- `ArrowDown`: from a cell, target the cell at the same column index in the next row.
- If the target row is sparse and lacks that column, either choose the nearest existing cell in that row or return `null` to fall back. This needs a product decision.
- Preserve horizontal caret intent for up/down when possible, using the current DOM machinery to choose the closest offset inside the target cell.
- `ArrowLeft`: at the start of a cell, target the previous cell in the same row, or optionally the previous row's last cell.
- `ArrowRight`: at the end of a cell, target the next cell in the same row, or optionally the next row's first cell.
- Do not navigate into row header text unless the selection starts in a row header or the user explicitly leaves the cell grid.
- For cells with nested child blocks, decide whether arrow movement should stay within the cell's internal block outline until the edge of the cell, or jump between top-level cells only.

React integration:

- In `EditableBlock`'s plain arrow handling, check table-aware movement before the existing `previousBlockId` / `nextBlockId` fallback.
- For up/down, keep the existing `verticalCaretXRef` flow but resolve the target block through the table helper instead of `previousBlockId` / `nextBlockId`.
- For left/right, only intercept at cell boundaries so normal intra-cell text movement remains native.
- Reset vertical caret intent when horizontal movement or non-up/down keys occur, preserving current behavior.

Command integration:

- Update `movePointVertically` / `movePointHorizontally` in `multiSelectionCommands.ts` or route through shared table navigation helpers so multi-selection and shift-arrow behavior do not diverge from single-caret behavior.
- Consider adding table-specific unit tests around the pure helper first, then UI tests for DOM/visual intent behavior.

## Testing Targets

Command/helper tests should cover:

- Up from row 2, column 2 moves to row 1, column 2.
- Down from row 1, column 2 moves to row 2, column 2.
- Up/down preserve offset when target text is long enough and clamp when shorter.
- Up/down from first/last row returns `null` or leaves selection unchanged according to the chosen edge behavior.
- Left at start of column 2 moves to column 1, end of text.
- Right at end of column 1 moves to column 2, start of text.
- Left/right do not move into row header text when starting from a cell.
- Sparse rows follow the chosen nearest-cell or fallback behavior.

UI tests should cover:

- Browser-native movement still works within a cell when not at a boundary.
- `ArrowUp` / `ArrowDown` from a table cell moves between rows in the same column.
- `ArrowLeft` / `ArrowRight` from cell boundaries crosses cells without entering row header contents.
- Shift-arrow behavior matches non-shift navigation shape while extending the selection.
- Multi-selection arrow movement, if supported in tables, follows the same grid semantics.

## Open Questions

- For sparse rows, should vertical navigation choose the nearest existing cell, create missing cells, or fall back to generic block navigation?
    - create missing cells
- Should `ArrowLeft` from the first cell in a row wrap to the previous row's last cell, move to the row header, move to the table title, or stay in place?
    - move to row header
- Should `ArrowRight` from the last cell in a row wrap to the next row's first cell, create/move to a missing cell, or stay in place?
    - wrap to next row header
- When a cell contains nested child blocks, should arrows navigate through the nested blocks before leaving the cell, or should table-cell navigation treat the whole cell as one grid target?
    - navigate through nexted blocks
- Should row header editable text participate in arrow navigation at all, or only be reachable by mouse/tab/explicit focus?
    - yes it should behave basically like another cell
- Should `Alt`/`Meta` word/block movement stay generic inside tables, or should table-grid behavior apply to modified arrow keys at cell boundaries too?
    - stay generic
- Should table-aware navigation live in `blockCommands.ts` with existing table helpers exported indirectly, or should table context helpers move to a shared `tableNavigation.ts` module?
    - use your judgement
