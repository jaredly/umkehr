# Plan 1.7: Table Renderer Extraction

## Goal

Move table rendering execution out of `BlockRichTextEditor.tsx` and into the table plugin, while
preserving current behavior for:

- table title editing;
- row and column insertion controls;
- missing-cell creation;
- nested tables inside table cells and interstitial rows;
- table-cell selection by border drag;
- selected cell, selected rectangle, and full-column visuals;
- table cell, rectangle, and column drag/drop;
- row drag affordances;
- table keyboard and clipboard event routing;
- relative-depth rendering inside table cells;
- block drop indicators that interact with table-cell slots.

This plan continues `plan-1.md` phase 7 after simple blocks, media/code, polls, columns, and slides
have been extracted. It assumes plugin block renderers already receive formatted render-tree nodes
and can consume children with `children: 'renderer'`.

## Current Table Ownership

`tablePlugin` still declares a placeholder structural renderer in
`src/block-editor/plugins/table.ts`:

- `render:table`

The actual table renderer and helpers still live in `BlockRichTextEditor.tsx`:

- `TableBlock`
- `TableRowHeader`
- `renderTableCell`
- `tableCellIdForSelection`
- `tableCellSelectionForCell`
- `isTableCellBlock`
- `fullColumnSelectionCellIds`
- `selectedTableRectangleSelection`
- `tableCellRectangleSelectionForTextSelection`
- `isFocusedCellBorderDrag`
- `isCellBorderPointer`
- `tableCellDragTargetFromPoint`
- `tableCellSlotTargetFromPoint`
- `tableRowSlotTargetFromPoint`
- `tableCellElementFromPoint`
- `TableCellDragTarget`

The current `BlockEditorTableRenderServices` type is still effectively untyped. The
`pluginBlockRenderContext` bridge exposes only:

- `createMissingCell`
- `addRow`
- `addColumn`
- `moveSelectionByArrowKey`
- `extendSelectionByArrowKey`

That is not enough for plugin-owned table rendering.

## Design Targets

- `tablePlugin` owns actual table rendering through a plugin-owned `tableRenderer.tsx`.
- The table renderer declares `children: 'renderer'`.
- Core still owns generic row chrome and non-table editable block rendering.
- Table-specific grid chrome, row/cell DOM structure, cell selection visuals, and table drag
  affordances belong to the table plugin.
- Command ownership can remain centrally bridged for this pass. The table renderer should call
  typed table render services that execute existing command helpers.
- DOM hit-testing helpers can initially live in the table plugin renderer module because they are
  table-specific and already depend on table DOM attributes.
- Shared selection helpers should move out of `BlockRichTextEditor.tsx` into reusable table modules
  instead of remaining central component-local functions.

## Phase A: Define Table Render Service Types

Replace `BlockEditorTableRenderServices = Record<string, unknown>` in
`src/block-editor/plugins/types.ts` with a typed public service.

Add table renderer data types:

- `BlockEditorTableCellSlotTarget`
  - equivalent to `TableCellSlotTarget` from `blockCommands.ts`, or re-export/import the existing
    type if that is acceptable for plugin APIs.
- `BlockEditorTableRowSlotTarget`
  - `{kind: 'row-slot'; tableId; beforeRowId; afterRowId; indicatorRowId; indicatorPlacement}`
- `BlockEditorTableBlockSlotTarget`
  - `{kind: 'block-slot'; dropTarget}`
- `BlockEditorTableCellDragTarget`
  - union of cell slot, row slot, and block slot targets.
- `BlockEditorTableCellDragState`
  - source cell id;
  - optional full-column cell ids;
  - optional rectangle selection;
  - current target.
- `BlockEditorTableCellSelectionDragState`
  - table id;
  - anchor cell id;
  - focus cell id.

Add read/selection services:

- `cellIdForSelection(selection): string | null`
- `cellSelectionForCell(cellId): EditorSelection | null`
- `isCellBlock(blockId): boolean`
- `fullColumnSelectionCellIds(selection, tableId): string[] | null`
- `selectedRectangleSelection(selection, tableId): EditorSelection | null`
- `rectangleSelectionForTextSelection(selection, tableId): EditorSelection | null`
- `rectangleForSelection(selection): TableCellRectangle | null`
- `rowsForTable(tableId): string[]`
- `cellsForRow(rowId): string[]`
- `blockLevelDecoration(blockId): BlockLevelSelectionDecorations | null`

Add mutation/command services:

- `createMissingCell(tableId, rowId, columnIndex)`
- `addRow(tableId, afterRowId?)`
- `addColumn(tableId, columnIndex?)`
- `selectCells(selection)`
- `moveCellsToNewRow(cellIds, target)`
- `moveCellsOutAsBlocks(cellIds, dropCommand)`
- `moveRectangleOutToNewTable(selection, dropCommand)`
- `moveCellRectangleContents(selection, target)`
- `moveCell(cellId, target)`
- `moveColumnCells(cellIds, targetColumnIndex)`
- `setCellDragBlockDropTarget(dropTarget | null)`

Add DOM/hit-test services or helpers:

- `cellElementFromPoint(clientX, clientY): HTMLElement | null`
- `cellSlotTargetFromPoint(clientX, clientY, tableId): BlockEditorTableCellSlotTarget | null`
- `rowSlotTargetFromPoint(clientX, clientY, tableId): BlockEditorTableCellDragTarget | null`
- `dragTargetFromPoint(clientX, clientY, tableId): BlockEditorTableCellDragTarget | null`
- `isCellBorderPointer(event): boolean`

Add event routing services:

- `onCopy(event)`
- `onCut(event)`
- `onPaste(event)`
- `onKeystroke(blockId, event)`
- `onUndo()`
- `onRedo()`

Notes:

- Keep `dropTarget` types narrow but sufficient. Table rendering currently checks
  `dropTarget.command.type === 'table-cell-slot'` and uses `dropTarget.command.target`.
  If the existing public drag/drop service only exposes placement, widen it for table use.
- Do not expose the entire internal `DropTarget` type unless it is already a suitable public API.
  Prefer a table-specific projection that includes only the fields used by the renderer.

Verification:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`

## Phase B: Move Reusable Table Selection Helpers

Move renderer-needed table selection helpers out of `BlockRichTextEditor.tsx`.

Preferred module:

- `src/block-editor/tableRenderHelpers.ts`

Move or expose:

- `tableCellIdForSelection`
- `tableCellSelectionForCell`
- `isTableCellBlock`
- `fullColumnSelectionCellIds`
- `selectedTableRectangleSelection`
- `tableCellRectangleSelectionForTextSelection`

Use existing helpers from `tableSelectionPlugin.ts` where possible:

- `tableCellRectangleForSelection`
- `tableCellsForSelection`
- `tableRowsForSelection`
- `tableCellPosition`
- `isTableCellSelection`

Important:

- Preserve virtual parent behavior. Current helpers use `annotationVirtualParents(state)` and
  materialized parent/path lookups. The moved helper must either accept virtual parent config or use
  the same rich text/table virtual parent behavior.
- Avoid a dependency cycle between plugin modules and `BlockRichTextEditor.tsx`.

Verification:

- Existing table selection and multi-selection tests.
- `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`

## Phase C: Move Table DOM Hit-Testing Helpers

Move table-specific DOM helpers to the table renderer module or a helper module:

- `isCellBorderPointer`
- `tableCellDragTargetFromPoint`
- `tableCellSlotTargetFromPoint`
- `tableRowSlotTargetFromPoint`
- `tableCellElementFromPoint`

Suggested module:

- `src/block-editor/plugins/tableRenderer.tsx` for renderer-local helpers, or
- `src/block-editor/tableDomTargets.ts` if tests or future clipboard/drag code need them.

Preserve DOM contracts:

- table root uses `[data-table-id]`;
- rows use `[data-row-id]`;
- cells use `.tableCell[data-cell-id]`;
- row insertion controls use `.tableRowInsertControl[data-table-id]`;
- table cell slot target chooses before/after based on horizontal midpoint;
- row slot target uses the same `edgeBand = 8` behavior;
- cell border drag uses the same `edge = 7` behavior.

Verification:

- If practical, add unit tests with lightweight DOM fixtures for cell slot and row slot target
  detection.
- Otherwise rely on table interaction integration tests and document the coverage gap.

## Phase D: Add Table Command Bridge Services

Wire `pluginBlockRenderContext(context).table` to existing central command helpers.

Bridge existing behavior:

- missing-cell creation calls `createMissingTableCell(...)`;
- row insertion calls `addTableRow(...)`;
- column insertion calls `addTableColumn(...)`;
- cell drag to row slot calls `moveTableCellsToNewRow(...)`;
- cell drag to block slot calls:
  - `moveCellRectangleOutToNewTable(...)` for rectangle selections;
  - `moveTableCellsOutAsBlocks(...)` otherwise;
- cell drag to cell slot calls:
  - `moveTableCellRectangleContents(...)` for rectangle selections;
  - `moveTableCell(...)` for a single cell;
  - repeated `moveTableCell(...)` for full-column movement;
- cell selection drag calls `replaceSelectionSet(...)` with a `table-cells` selection.

Keep central command ownership for now:

- the table renderer should call services such as `context.table.moveCell(...)`;
- services should call existing command helpers and `runBlockControlCommand(...)`;
- log this bridge as temporary until command extraction.

Verification:

- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts`
- table-specific cases should still pass for create table, add rows/columns, move cell, move
  rectangle, move out, and nested table cases.

## Phase E: Implement Plugin-Owned `TableBlock`

Create:

- `src/block-editor/plugins/tableRenderer.tsx`

Add:

- `tableBlockRenderer`
  - `id: 'render:table'`
  - `blockType: 'table'`
  - `children: 'renderer'`
  - returns `null` unless `node.block.block.meta.type === 'table'`

Move component behavior from central `TableBlock`:

- local `cellDrag` state;
- local `cellSelectionDrag` state;
- row node and column count derivation;
- selected cell id derivation;
- pointermove/pointerup/pointercancel listeners for cell drag;
- pointermove/pointerup/pointercancel listeners for cell selection drag;
- table root and table grid DOM;
- title row;
- column insert controls;
- row rendering;
- interstitial nested table rows;
- row insertion controls.

Renderer services needed:

- `context.blocks.renderEditableBlock(node)` for the table title;
- `context.table.addColumn(...)`;
- `context.table.addRow(...)`;
- `context.table.cellIdForSelection(...)`;
- `context.table.dragTargetFromPoint(...)`;
- `context.table.setCellDragBlockDropTarget(...)`;
- command bridge movement services from Phase D;
- `context.dragDrop.registerRow(...)`;
- `context.dragDrop.isDragging(...)`;
- `context.dragDrop.isDraggingRoot(...)`;
- a widened drop-target projection for block and table-cell slot classes.

Important:

- The table renderer consumes children. It must render every row and cell itself.
- Nested table rendering should recurse through the table plugin renderer, not call central
  `TableBlock`.
- Keep `contentEditable={false}` and event prevention behavior unchanged on controls.

Verification:

- Typecheck.
- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`

## Phase F: Move Row Header And Cell Rendering

Move into `tableRenderer.tsx`:

- `TableRowHeader`
- `renderTableCell`

Preserve row header behavior:

- role `rowheader`;
- aria label `Row header ${rowIndex + 1}`;
- drag button class `tableRowDrag`;
- drag starts via core drag/drop service;
- row header editable surface:
  - relative depth `0`;
  - variant `table-row-header`;
  - placeholder row number;
  - `surfaceClassName: 'tableRowHeaderText'`;
  - hide affordance and inline controls;
  - `registerBlockRow: false`.

Preserve cell rendering:

- nested table cells render table renderer recursively;
- normal cells render editable surface at relative depth `0`;
- cell children render in `.tableCellChildren`;
- child blocks render relative to `cell.block.depth + 1`.

Likely API addition:

- `BlockEditorEditableBlockOptions.variant?: 'block' | 'table-row-header'`

This variant currently exists in central `EditableBlockRenderOptions` but is not part of the public
plugin render options. Add it before moving `TableRowHeader`.

Verification:

- Typecheck.
- Existing tests for table row header split/delete should pass.

## Phase G: Move Cell Selection Drag UI

Move border-drag behavior into the plugin renderer.

Preserve behavior:

- only primary left-button pointer on cell border starts selection/drag;
- if border-dragging a cell that is not the currently active table cell:
  - capture pointer;
  - initialize `cellSelectionDrag`;
  - focus table-cell selection target;
  - update retained editor selection to a single-cell table selection;
- pointer move extends selection only inside the same table;
- pointer up commits the last focus cell;
- pointer cancel clears drag state.

Services needed:

- `context.table.cellSelectionForCell(cellId)`;
- `context.table.selectCells(selection)`;
- `context.selection.focus(selection)`;
- `context.table.cellElementFromPoint(...)`;

Verification:

- `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`
- add focused DOM/interaction tests if available.

## Phase H: Move Cell Drag/Drop UI

Move active-cell drag behavior into the plugin renderer.

Preserve behavior:

- active cell gets `cellDragCandidate` and left/right drag-edge spans;
- pointer down on selected cell border starts cell movement drag;
- full-column selection drags the selected column cells;
- rectangle selection drags rectangle contents;
- text selection across cells is converted to a table rectangle selection when applicable;
- pointer move computes table drag target and updates block drop target for block-slot targets;
- pointer up applies the correct movement command based on target kind;
- pointer cancel clears state and block drop target.

Services needed:

- `context.table.fullColumnSelectionCellIds(...)`;
- `context.table.selectedRectangleSelection(...)`;
- `context.table.rectangleSelectionForTextSelection(...)`;
- `context.table.rectangleForSelection(...)`;
- `context.table.moveCellsToNewRow(...)`;
- `context.table.moveCellsOutAsBlocks(...)`;
- `context.table.moveRectangleOutToNewTable(...)`;
- `context.table.moveCellRectangleContents(...)`;
- `context.table.moveCell(...)`;
- `context.table.moveColumnCells(...)`;
- `context.table.setCellDragBlockDropTarget(...)`;

Verification:

- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`
- manual smoke for dragging one cell, selected rectangle, full column, and dragging out of table.

## Phase I: Wire `tablePlugin`

Update `src/block-editor/plugins/table.ts`:

- remove `structuralRenderers(...)` usage for tables;
- import `tableBlockRenderer` from `tableRenderer.tsx`;
- set `blockRenderers: [tableBlockRenderer]`.

Keep:

- `requires: ['table-selection']`;
- block type spec;
- toolbar item;
- slash command;
- command placeholder ids;
- CRDT virtual parent hook;
- styles.

Verification:

- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts`
- confirm renderer id remains `render:table`.

## Phase J: Remove Central Table Branches

After the plugin renderer returns real output:

- remove central `renderBlockNode` branch:
  - `meta.type === 'table' && context.blockRenderFeatures.has('table')`
- delete migrated central components/helpers:
  - `TableBlock`
  - `TableRowHeader`
  - `renderTableCell`
  - table selection helper functions moved in Phase B;
  - DOM hit-testing helper functions moved in Phase C;
  - `TableCellDragTarget` if no longer needed centrally.
- remove table-only imports from `BlockRichTextEditor.tsx` when no longer used directly:
  - table movement command helpers used only by render bridge can stay if services remain there;
  - otherwise move bridge helpers to a separate table service factory module.

Keep central editor responsibilities:

- state and command dispatch;
- generic block drop target calculation;
- bridge services until command extraction;
- keyboard navigation from editable surfaces until command extraction moves it.

Verification:

- `npm exec tsc -- --noEmit`
- `rg -n "function TableBlock|function TableRowHeader|renderTableCell|tableCellDragTargetFromPoint|tableCellElementFromPoint" src/block-editor/BlockRichTextEditor.tsx`
  should return no central table renderer definitions.

## Phase K: Focused Tests

Use existing tests first:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/documentFormat.test.ts`
- `npm exec vitest -- src/block-editor/clipboard.test.ts`

Add focused tests if a DOM render harness exists:

- table renderer registers real renderer and consumes children;
- table title renders;
- column insert controls render `columnCount + 1` buttons;
- missing cell button calls `createMissingCell`;
- row insert button calls `addRow`;
- nested table renders recursively;
- active table cell receives `activeTableCell`;
- selected rectangle receives selected/focus classes;
- cell drag target classes render for before/after slots.

If no DOM harness exists, document that visual/DOM interactions rely on existing integration tests
plus manual browser smoke.

## Risks And Workarounds

- Table rendering currently interleaves rendering, DOM hit-testing, and command execution. Keep the
  first extraction behavior-preserving; do not also redesign commands.
- Existing block drop targets include table-cell slot commands. The plugin service must expose
  enough of those targets for CSS classes and drag behavior without leaking unnecessary internals.
- Nested tables are easy to regress. Ensure recursion goes through plugin renderer dispatch and does
  not reintroduce central `TableBlock` usage.
- The table renderer uses global pointer listeners. Keep cleanup behavior exactly equivalent.
- Clipboard and keyboard handling still route through central editable surfaces. Preserve event
  props on table cells until those areas are extracted.
- Full-column drag behavior depends on selected rectangle semantics. Verify it before removing
  central helpers.

## Completion Criteria

Table extraction is complete when:

- `tablePlugin` uses a real plugin-owned renderer for `table`.
- `BlockRichTextEditor.tsx` no longer has a hard-coded table render branch.
- Central table renderer components and DOM helpers are removed or moved to table-owned modules.
- Table title, rows, cells, nested tables, missing cells, row/column insert controls, and drag/drop
  visuals match current behavior.
- Table cell selection and cell drag/drop behavior match current behavior.
- Existing table command, multi-selection, clipboard, default preset, and document format tests pass.
- Any temporary central command bridge is documented in `implementation-log-1.md`.

