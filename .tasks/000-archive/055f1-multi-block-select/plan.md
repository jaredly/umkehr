# Plan: Multi-Block And Block-Level Selection

## Goals

Implement the expanded selection story in `examples/block-rich-text`:

- Plain drag-to-select works across multiple blocks as a normal text selection.
- Dragging a handle inside a multi-block text selection moves every touched block, preserving the original text selection after drop.
- Block-level selection becomes first-class, including table-cell rectangular selections.
- Table Tab/Shift+Tab navigates cells by switching into cell block-selection mode.
- Block/cell selection supports typing, Enter, Backspace/Delete, copy/paste, and drag reorder with the semantics answered in `research.md`.

## Phase 1: Selection Model Foundation

1. Extend resolved selection types.

   Add block-level variants to `EditorSelection` in `selectionModel.ts`:

   ```ts
   | {type: 'block'; anchorBlockId: string; focusBlockId: string}
   | {type: 'table-cells'; tableId: string; anchorCellId: string; focusCellId: string}
   ```

   Keep text selections as the only shapes accepted by text-only helpers.

2. Extend retained selection types.

   Add retained block and table-cell variants in `retainedSelection.ts`. Block and cell selections can retain block ids directly because block ids are stable.

3. Split text-only and general helpers.

   Add helpers such as:

   - `isTextSelection(selection)`
   - `isBlockLevelSelection(selection)`
   - `textFocusPoint(selection)`
   - `selectedBlockIdsForSelection(state, selection)`
   - `selectedTopLevelBlockIdsForSelection(state, selection)`
   - `selectedCellIdsForSelection(state, selection)`
   - `tableCellRectangleForSelection(state, selection)`

   Audit existing `focusPoint(...)`, `firstPointForSelection(...)`, `normalizeSelectionSegments(...)`, toolbar, annotation, link, and inline mark callers so block selections do not accidentally flow into text-only paths.

4. Update selection-set helpers.

   Update `selectionSet.ts` to resolve, retain, sort, dedupe, and decorate mixed text/block selections. Dedupe should remain conservative:

   - text carets dedupe by visible point as today;
   - block selections dedupe only when they select the same block/cell set;
   - table-cell rectangle selections dedupe only when table id and resolved rectangle match.

5. Add model tests.

   Cover retaining/resolving block selections across moves, clamping deleted selected blocks, resolving table rectangles, sparse-cell ignoring, and selected top-level block derivation with nested descendants.

## Phase 2: Block And Cell Selection Decorations

1. Add decoration data for block-level selection.

   Keep inline text decorations for text ranges/carets. Add a separate decoration map for wrapper-level states:

   - selected block rows;
   - selected table cells;
   - anchor/focus cells;
   - rectangular table-cell range;
   - primary selection styling.

2. Render block selection styling.

   Apply classes to wrappers instead of text run spans:

   - `.blockRow.blockSelected`
   - `.blockRow.blockSelectionFocus`
   - `.tableCell.cellSelected`
   - `.tableCell.cellSelectionAnchor`
   - `.tableCell.cellSelectionFocus`

3. Preserve active text selection behavior.

   Native DOM selection remains the display mechanism for the primary active text selection where possible. Manual decorations should show block/cell selections and non-primary retained text selections while focused.

4. Add styling tests or app tests.

   Verify clicking/selecting a block handle highlights the full visible subtree, and table-cell selection highlights the expected rectangle.

## Phase 3: Plain Drag-To-Select Across Blocks

1. Add root-level pointer text selection.

   In `App.tsx`, add pointer gesture state for plain drag selection:

   - pointer down on editable text captures the anchor point with `readPointFromMouseEvent`;
   - pointer move resolves a focus point and stores a transient primary text range;
   - pointer up commits the range with `replaceSelectionSet`;
   - movement below the drag threshold can continue to behave as a click/caret.

2. Keep Cmd/Ctrl multi-selection behavior.

   Preserve current Cmd/Ctrl click/drag append behavior. Plain drag replaces the selection set; Cmd/Ctrl drag appends to it.

3. Render feedback during drag.

   Use existing selection decorations for cross-block ranges during the pointer gesture, since native cross-contenteditable DOM selection is not reliable.

4. Add app tests.

   Cover:

   - drag from one block into another creates a text range;
   - typing replaces the dragged cross-block selection;
   - plain click clears the selection to a caret;
   - Cmd/Ctrl drag still appends a range.

## Phase 4: Linear Block Selection Interactions

1. Block handle pointer down selects the visible subtree.

   Change block handle and row handle pointer-down behavior so clicking a handle creates a block selection covering the whole visible subtree rooted at that block.

2. Drag threshold starts reorder.

   If the handle pointer gesture crosses the drag threshold, start reorder after setting the block selection.

3. Typing while block-selected enters text mode.

   For linear block selection, typing should switch to a text caret at the end of the last selected block in document order, then insert text normally.

4. Enter creates a block after the last selected block.

   For linear block selection, Enter should create a new block after the furthest-down selected block and place the caret there.

5. Backspace/Delete deletes selected blocks.

   Delete the selected top-level blocks, implicitly including descendants when an ancestor is selected.

6. Block type commands apply to selected blocks.

   Block-level formatting and block type changes should apply to the selected top-level blocks. Inline marks and link commands should be disabled or no-op for block selections unless explicitly converted to text selection.

7. Add tests.

   Cover selecting a subtree from a handle, typing into block selection, Enter after selection, Delete removing selected blocks and descendants, and block type changes on selected blocks.

## Phase 5: Multi-Block Drag Reorder

1. Derive dragged block group.

   If the active selection is a text range, the drag group includes every touched block, including partially selected first/last blocks.

   If the active selection is a block selection, the drag group includes selected top-level blocks, with descendants implicit.

   If the handle is outside the selected group, select and drag that handle's visible subtree only.

2. Extend `useBlockReorder`.

   Replace the single dragged id API with a source plus group API, for example:

   ```ts
   startDrag({sourceBlockId, draggedBlockIds}, event)
   onMove(draggedBlockIds, target)
   ```

   Keep a source id for styling the drag root, but use the full selected group for suppressed drop targets and dragged styling.

3. Add group move command helper.

   Add a command helper that moves selected top-level blocks as a contiguous group:

   - preserve relative order;
   - reject drops into any selected subtree;
   - interpret `MoveTarget` as the insertion point for the group;
   - preserve the original retained selection after drop.

4. Add tests.

   Cover dragging all touched blocks from a text range, preserving text selection after drop, dragging nested selected blocks with descendants, moving a selected group before/after/into targets, and dragging outside the selected group moving only that block's subtree.

## Phase 6: Table Cell Block Selection And Tab Navigation

1. Add table-cell selection helpers.

   Build helpers for:

   - finding a cell's table, row, and column;
   - resolving a rectangle from anchor/focus cells;
   - detecting full row selections;
   - detecting full column selections;
   - listing selected existing cells while ignoring missing sparse cells.

   Missing sparse cells should not be anchor or focus targets. Tabbing into a sparse destination should create the missing cell.

2. Change table Tab/Shift+Tab navigation.

   Update `moveTableCellByTab` or its app wrapper so Tab from a cell block moves to the adjacent cell and stores a single-cell `table-cells` selection, not a text caret.

   Keep current child-block behavior: Tab/Shift+Tab inside a child block of a cell still indents/dedents.

3. Cell border click selects one cell.

   Clicking a cell border should create a single-cell `table-cells` selection.

4. Dragging across cells creates a rectangle.

   Mouse-drag selection inside a table should produce a rectangular `table-cells` selection. Generic linear block selection may include rows/cells, but table mouse-drag UI should prefer rectangular cell selection.

5. Typing uses the focus cell.

   Typing while in a multi-cell table selection should switch to a text caret at the end of the focus cell, then insert text.

6. Add tests.

   Cover Tab forward/backward into single-cell selection, sparse destination cell creation on Tab, child block Tab indent/dedent, border click selection, drag rectangular selection, and typing into the focus cell.

## Phase 7: Block And Cell Delete Semantics

1. Linear block selection delete.

   Backspace/Delete deletes selected top-level blocks and descendants.

2. Table rectangle delete.

   For `table-cells` selection:

   - if selection is a clean full column, delete the column;
   - if selection is a clean full row, delete the row;
   - otherwise clear selected cells' contents.

3. Add table commands as needed.

   Existing row/column add and cell movement helpers may need companion helpers:

   - `deleteTableRow`
   - `deleteTableRows`
   - `deleteTableColumn`
   - `deleteTableColumns`
   - `clearTableCells`

   Ensure clearing a cell removes its child blocks/content according to the table content model.

4. Add tests.

   Cover full-row delete, full-column delete, partial-rectangle clear, sparse-cell behavior, and remote replica convergence.

## Phase 8: Clipboard Support

1. Define structured clipboard payload.

   Add an app-specific JSON MIME type such as:

   ```text
   application/x-umkehr-block-rich-text+json
   ```

   Include selected block/cell subtree data and enough table shape metadata to paste safely.

2. Add plain text fallbacks.

   - Linear block selections copy newline-separated visible text.
   - Table-cell rectangles copy `text/plain` and `text/tab-separated-values` as TSV-shaped text.

3. Implement paste rules.

   Based on the answered behavior:

   - if the selection is a full column, structured paste adds an adjacent column;
   - if the selection is a full row, structured paste adds a row below;
   - if the selection is a text selection within a cell, structured block paste adds blocks as children of the cell;
   - otherwise block structured paste is blocked for now.

   Plain text paste can continue using existing text paste paths after converting block selection to the appropriate text caret.

4. Add tests.

   Cover copying selected blocks, copying table rectangles as TSV, pasting a column beside a full-column selection, pasting a row below a full-row selection, pasting blocks into a cell text selection, and blocked unsupported structured paste.

## Phase 9: Table Rectangle Drag Reorder

1. Support arbitrary rectangular cell drags.

   Multi-cell drag should support arbitrary rectangular selections, not only same-row runs.

2. Add column reorder drop targets.

   If the table-cell selection is a clean full column, expose column-reorder drop targets and move the selected column as a column.

3. Define non-column rectangle move behavior.

   Move arbitrary rectangular selections as cell content blocks while preserving rectangle shape. If a rectangle move needs target cells that do not exist, create missing cells only as needed at drop time.

4. Preserve selection after drop.

   After moving cells/columns, keep a table-cell selection over the moved rectangle/column.

5. Add tests.

   Cover full-column drag reorder, arbitrary rectangle drag, missing target cell creation as needed, invalid drop rejection, and selection preservation.

## Phase 10: Polish And Regression Pass

1. Audit command routing.

   Ensure text commands, inline marks, links, annotations, block type changes, undo/redo, and history export/import handle the widened selection type.

2. Audit focus and DOM restoration.

   Block/cell selections should not attempt to restore native DOM text ranges. When a block selection converts to text mode, restore the resulting caret/range normally.

3. Verify visual states.

   Check active editor, inactive retained selections, multi-selection overlays, drag previews, table cells, nested blocks, and offline replica behavior.

4. Run focused tests.

   Suggested commands:

   ```sh
   pnpm exec vitest -- run examples/block-rich-text/src/selectionSet.test.ts
   pnpm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts
   pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
   pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx
   ```

5. Run the broader relevant suite.

   Run the full block-rich-text test target or full repo test command used locally once focused tests pass.

## Implementation Notes

- Keep the native browser DOM selection as an optimization for active text selections only. Treat app state as authoritative.
- Prefer command/model helpers for block and table behavior so React handlers stay thin.
- Preserve retained selections after moves wherever possible; convert selection type only when an explicit editing command requires it.
- Be strict about text-only helpers. A type error is better than block selection accidentally becoming a caret at offset `0`.
- Implement phases 1-6 before clipboard and table rectangle drag. Clipboard and arbitrary rectangle movement depend on the model and decoration work being stable.
