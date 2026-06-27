# Plan: More Normal Table Blocks

## Decisions From Research

- No migration or backwards compatibility work is required.
- Tables no longer support non-row direct children rendered below the grid.
- New rows should be paragraph blocks.
- A direct child table of a table is an interstitial table row: it fills the whole row, and its own children are rows of that nested table.
- Cell child blocks are normal nested blocks. Tab in a cell child should indent/outdent, not move to the next table cell.
- Moving a cell moves its whole subtree.
- A row with non-empty cell child subtrees is not empty.

## Phase 1: Normalize Table Metadata

Files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/virtualParents.ts`
- call sites importing table meta helpers

Tasks:

1. Remove `rowParent` from table metadata.
2. Remove the `table_row` metadata variant.
3. Update `sameTypeWithTs()` for `{type: 'table', ts}`.
4. Remove `isTableRow()` or replace it with structural row helpers where needed.
5. Remove table virtual parent behavior from `tableVirtualParentsForBlock()`. Keep the function only if the virtual-parent config shape is easier to preserve.
6. Fix compile errors from `rowParent` and `table_row` references before moving deeper into behavior.

Expected result:

- A table is just a block with `meta.type === 'table'`.
- Rows and cells are normal blocks distinguished by position in the block tree.

## Phase 2: Centralize Structural Table Helpers

File:

- `examples/block-rich-text/src/blockCommands.ts`

Tasks:

1. Add or refactor helper functions around direct parentage:
   - `tableRows(state, tableId)` returns direct visible children of the table.
   - `tableCells(state, rowId)` returns direct visible children of the row.
   - `tableRowContext(state, rowId)` validates that `rowId` is a direct child of a table.
   - `tableCellContext(state, blockId)` validates that `blockId` is a direct child of a row, where that row is a direct child of a table.
2. Ensure descendants of cells are not treated as cells.
3. Add a helper for resolving the containing cell from any descendant block, for UI highlighting and command decisions.
4. Add subtree-aware emptiness helpers:
   - empty row means row text is empty and every direct cell subtree is empty
   - non-empty cell children make the row non-empty
5. Keep the helper API small and use it everywhere table code needs row/cell semantics.

Expected result:

- There is one source of truth for table structure.
- Child blocks under cells cannot accidentally become cells.

## Phase 3: Update Table Commands

File:

- `examples/block-rich-text/src/blockCommands.ts`

Tasks:

1. Update `createTable()` and `convertBlockToTable()`:
   - create table blocks with `{type: 'table', ts}`
   - create row blocks as paragraph children of the table
   - create cell blocks as paragraph children of each row
2. Update row commands to parent rows directly under the table:
   - `addTableRow`
   - `moveTableRow`
   - `splitTableRowHeader`
   - `deleteTableRowHeaderBackward`
   - `deleteEmptyTableRowBackward`
   - `exitEmptyLastTableRow`
3. Update cell commands to use direct row children only:
   - `createMissingTableCell`
   - `addTableColumn`
   - `moveTableCell`
   - `moveTableCellByTab`
   - `advanceFromTableCellEnd`
   - previous/next cell helpers
4. Preserve subtree movement for cells by moving the cell block itself.
5. Ensure Tab navigation only treats a selection as table-cell navigation when the focused block is the cell block itself. If the focus is in a child block under a cell, normal indent/outdent behavior should apply.
6. Update boundary/deletion logic so nested cell content prevents row deletion as empty.

Expected result:

- All table editing behavior works from the normal block tree.
- Existing row/cell operations still operate on direct rows and cells.
- Cell descendants behave like normal nested blocks.

## Phase 4: Update Rendering And Interaction

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`

Tasks:

1. Update `TableBlock` so all direct children of a table are rows.
2. Render an interstitial nested table row when a row block is itself a table:
   - it spans the full grid width
   - it renders as a nested `TableBlock`
   - its children are rows for that nested table, not cells in the outer table
3. Render normal row blocks with:
   - row header editable content from the row block
   - direct row children as cells
4. Update `renderTableCell()` to render:
   - the cell block at effective depth `0`
   - direct and nested child blocks below the cell content
5. Add a wrapper such as `.tableCellChildren` if needed to make first-level cell children unindented while preserving compact table-cell spacing.
6. Update selection highlighting:
   - selection on a cell block highlights that cell
   - selection in a descendant block highlights the containing cell if desired for visual context
   - commands still distinguish cell block focus from descendant focus for Tab behavior
7. Update drag/drop hit testing so only direct cells are draggable/reorderable as cells.

Expected result:

- Cell children are visible and editable below the main cell block.
- Direct child tables render as full-width interstitial table rows.
- The old below-grid normal child rendering path is gone.

## Phase 5: Update Tests

Files:

- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`
- possibly `examples/block-rich-text/src/multiSelectionCommands.test.ts`

Tasks:

1. Update table test helpers:
   - `tableShape()` should read rows from `visibleBlockChildren(state, tableId, ...)`
   - cells should come from `visibleBlockChildren(state, rowId, ...)`
2. Rewrite old model assertions:
   - no `rowParent`
   - no `table_row`
   - rows are paragraph children of tables
3. Remove or replace the test for normal children under a table outside the row grid.
4. Add command tests for:
   - creating tables with normal row children
   - adding/moving rows using direct table children
   - adding/moving columns and sparse cells using direct row children
   - moving a cell with child blocks moves the whole subtree
   - row emptiness considers nested cell children
   - Tab from a cell block still moves between cells
   - Tab from a child block under a cell uses normal indent/outdent behavior
5. Add rendering tests for:
   - cell child blocks render below cell content
   - first-level cell children are not indented
   - nested table row spans the full row
   - cell descendants are not counted/rendered as extra cells
6. Update any multi-selection or block-type tests that still construct `table_row`.

Expected result:

- Tests describe the new normal-tree table model directly.
- No tests preserve old document compatibility.

## Phase 6: Verification

Commands:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
npm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts
```

Also run the app and manually check:

1. Create a table.
2. Add rows and columns.
3. Add child blocks inside a cell and verify they render below the cell content.
4. Press Tab from a cell block and from a child block under a cell.
5. Move a cell with children and verify the children move with it.
6. Create a table as a direct table child and verify it renders as a full-width interstitial row.

## Risks

- Row/cell detection must stay strictly direct-child based, or cell descendants will be misclassified as cells.
- Deletion/backspace behavior is likely to need the most iteration because it currently relies on `table_row` boundaries.
- Nested table rows can recurse badly if rendering does not clearly separate "row that is a table" from "cell that is a table."
- UI highlighting and keyboard behavior need separate concepts for "containing cell" and "focused cell block."
