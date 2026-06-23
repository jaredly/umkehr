# Research: More Normal Table Blocks

## Goal

Simplify the `examples/block-rich-text` table representation so tables use the same block tree rules as the rest of the editor:

- Table rows are normal block children of the table.
- Rows are not a dedicated `table_row` block type; they can use any normal block type.
- Cells can have child blocks, and those children render under the cell's own editable content without first-level indentation.

## Current State

Relevant files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/virtualParents.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

`RichBlockMeta` has two table-specific meta variants:

```ts
| {type: 'table'; rowParent: Lamport; ts: HLC}
| {type: 'table_row'; ts: HLC}
```

`table.rowParent` is a virtual parent id. `tableVirtualParentsForBlock()` exposes this id as an extra parent for table rows, so rows are not real children of the table. Commands query rows with:

```ts
visibleBlockChildren(state, lamportToString(table.meta.rowParent), annotationVirtualParents(state))
```

Cells are currently just normal blocks under a `table_row`. A "cell" is inferred structurally as any non-`table_row` block whose materialized path contains a `table_row` ancestor.

Rendering follows the same split:

- `TableBlock` filters `node.children` into `rowNodes` where `meta.type === 'table_row'` and `normalChildren` for everything else.
- Each row has a row-header editable surface using the row block content.
- Each cell is currently rendered by `renderTableCell(cell, context)`.
- `renderTableCell()` renders only the cell block itself, or a nested `TableBlock` when the cell block is a table.
- Cell children exist in the underlying tree but are not rendered inside the cell. This is the direct reason "cells can technically have children, but they aren't rendered."

Tests currently lock in the quirky model. Examples:

- `creates a table block with a virtual row parent, rows, and cells`
- `orders table rows by normal block order under the row virtual parent`
- `keeps normal children under a table block outside the row grid`
- `allows a cell block to become a nested table`

## Important Consequences

Removing `rowParent` is not just deleting a field. It changes the structural meaning of `visibleBlockChildren(tableId)`:

- Today, real children of a table are "normal children outside the row grid."
- After the change, children of a table are rows.
- If tables should still support blocks below/after the grid, those blocks need a different representation or a different command behavior.

Removing `table_row` is also not just renaming metadata. The current code relies on it to distinguish three levels:

1. table block
2. row block
3. cell block

If rows can have any block type, row/cell detection must become structural:

- A row is a direct visible child of a table.
- A cell is a direct visible child of a row.
- Blocks below a cell are ordinary cell content children, not additional cells.

That implies table helpers should stop using "path contains a `table_row`" and instead use parent relationships:

- `tableRows(state, tableId)` should return direct children of the table.
- `tableCells(state, rowId)` should return direct children of the row.
- `tableRowContext(state, rowId)` should validate that `rowId` is a direct child of a table.
- `tableCellContext(state, blockId)` should validate that `blockId` is a direct child of a row that is a direct child of a table.

This direct-child rule is the key to rendering cell children safely. Without it, any child of a cell would be misclassified as another cell.

## Likely Implementation Shape

1. Update metadata.

Remove `rowParent` from table metadata and remove the `table_row` variant:

```ts
| {type: 'table'; ts: HLC}
```

`sameTypeWithTs()` should preserve only `{type: 'table', ts}`. `tableVirtualParentsForBlock()` can disappear, or become empty if the surrounding virtual parent wiring still expects a function.

2. Update table creation commands.

`createTable()` and `convertBlockToTable()` should insert row blocks as real children of the table:

```ts
parent: tableBlock.id
```

Rows can probably be created as paragraphs initially via `paragraphMeta(context.nextTs())`. Cells can also remain paragraphs initially. This preserves editability and avoids inventing a new row type.

3. Replace table helper semantics.

Refactor these helpers around direct children:

- `tableRows`
- `tableColumnCount`
- `tableCellContext`
- `tableRowContext`
- `areTableRowCellsEmpty`
- `isEmptyTableRow`
- `createEmptyCellsForRow`
- `nextTableCellId`
- `previousTableCellId`
- `sameTableRowBoundary`

The helpers should probably centralize predicates like `isTableRowBlock(state, id)` and `isTableCellBlock(state, id)` so rendering, commands, selection highlighting, and tests agree.

4. Update row and cell commands.

Commands that currently use `table.meta.rowParent` should use `table.id` as the parent:

- `addTableRow`
- `moveTableRow`
- row insertion from `splitTableRowHeader`
- row deletion/backspace paths

Commands that currently assume every child of a row is a cell need to keep using direct children only. This includes:

- `addTableColumn`
- `createMissingTableCell`
- `moveTableCell`
- tab/advance navigation
- sparse cell handling

5. Render row children as cells, and cell children as content.

`TableBlock` should treat all direct children of the table as rows. It should no longer filter row nodes by `meta.type === 'table_row'`.

For each row, the grid cells should be direct children of the row. `renderTableCell()` should render:

- the cell block itself, with `depth: 0`
- the cell's child blocks below it

The first level of cell children should also render with effective depth `0` or equivalent CSS so they are not indented under the main cell content. Deeper descendants can either regain normal indentation or continue using compact table-cell styling.

6. Update selection and cell highlight logic.

`tableCellIdForSelection()` currently returns the focused block when the path contains a `table_row`. With rendered cell children, that would highlight the child block rather than the containing cell. It should return the nearest ancestor that is a direct child of a row.

Similarly, keyboard and deletion commands should decide whether a selection inside a cell child participates in table-cell navigation, or only selections on the cell's main block do.

7. Update CSS.

Existing CSS already has useful table-cell overrides:

- `.tableCell .blockRow`
- `.tableCell .blockAffordance`
- `.tableCell .editableBlock`

It will likely need an explicit wrapper for cell child content, for example `.tableCellChildren`, so first-level child blocks can be rendered without margin/indent while still preserving compact spacing inside cells.

8. Update tests.

Expected test changes:

- `tableShape()` should read rows with `visibleBlockChildren(state, tableId, ...)`.
- Tests should stop expecting `table_row` metadata.
- The old "normal children under a table block outside the row grid" test should be replaced or deleted depending on the product decision.
- Add coverage that a child block under a cell renders and is not counted as a sibling cell.
- Add coverage that selection inside a cell child still highlights/selects the owning cell if that is desired.
- No migration or backwards-compatibility coverage is needed.

## Migration And Compatibility

No migration or backwards compatibility work is needed for this task. The implementation can hard-break old example table states that contain:

- `meta.type === 'table'` plus `rowParent`
- row blocks under the virtual parent
- `meta.type === 'table_row'`

Tests and fixtures should be updated to the new shape rather than preserving support for the old shape.

## Open Questions

1. What is the intended representation for non-row children of a table after rows become normal table children?

Today those render below the grid. If all direct table children are rows, "caption/footer/content below table" needs another mechanism, or that behavior should be removed.

That behavior is no longer wanted.

2. What block type should newly-created rows use?

Paragraph is the simplest answer, but row content currently acts like a compact row header. If rows can be headings, todos, etc., the renderer needs to decide how much of each block type's normal UI appears in the row header.

Paragraph.

3. Are table rows allowed to be tables in practice?

The task notes this needs careful rendering. A direct child table would be a row, but `TableBlock` also needs to render table-type row content without recursively treating it as a nested table occupying the row header in a broken way.

Yes, it behaves like an 'interstitial table'. It fills up the whole row, and the "children" of that row are rows unto themselves in that table.

4. Are cell children part of table navigation?

When the caret is inside a child block under a cell, should Tab move to the next cell, or should it indent/outdent/move through normal blocks? The implementation needs one consistent rule.

in a sub-block of a cell, tab should indent/outdent. in future we'll have "whole block selection" as a first class concept, which will be the behavior when 'tabbing through a table'.

5. Should a cell be allowed to contain child blocks and still be moved as a single cell?

Probably yes. `moveTableCell()` moves the cell block, so its subtree should follow automatically. Tests should confirm this once cell children render.

Yes.

6. Does deleting an "empty row" include checking cell child subtrees?

Current emptiness checks only look at row text and direct cell text. With cell children, a row with empty cells but non-empty cell children must not be deleted as empty.

non-empty cell children must not be deleted as empty.

## Suggested First Pass

Implement this in one focused pass inside the example:

1. Change table metadata and remove table virtual row parents.
2. Convert table helpers to direct-child row/cell detection.
3. Update creation, row, column, navigation, and deletion commands.
4. Update rendering so table direct children are rows and cell direct children render below the cell block.
5. Update tests around the new structural rules.

The highest-risk areas are deletion/Backspace behavior and selection/navigation from nested cell content, because they currently use `table_row` as a cheap boundary marker.
