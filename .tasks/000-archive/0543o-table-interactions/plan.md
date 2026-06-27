# Plan: Table Interaction Feedback

## Phase 1: Command Model

Add table-aware commands in `examples/block-rich-text/src/blockCommands.ts` before changing the UI.

1. Add reusable table helpers:
   - find the table/row/cell context for a block;
   - list visible rows for a table;
   - list visible cells for a row;
   - test whether a row is empty by checking every cell has zero-length CRDT text;
   - find the previous row's last cell and the same/simple insertion anchors for table siblings.

2. Add `deleteEmptyTableRowBackward`.
   - Trigger only for a collapsed caret in a table cell at offset `0`.
   - If the row is not all zero-length cells, fall back to current delete behavior.
   - If the cell is not the first cell in its row, move the caret to the previous cell in the row, at that cell's end, like Shift+Tab.
   - If the row is all empty and there is a previous row, delete the current `table_row` block and move the caret to the previous row's last cell at the end.
   - If the row is all empty and it is the only row, delete the row and convert the table block to a paragraph, with the caret in the converted paragraph.

3. Add `exitEmptyLastTableRow`.
   - Trigger only for a collapsed caret in a table cell.
   - Require the row to be the last row, all cells zero-length, and the table to have more than one row.
   - Delete the empty last row.
   - Insert a paragraph block immediately after the table.
   - Place the caret in the new paragraph.

4. Add `splitTableTitleToParagraph`.
   - Trigger when the focused block is a table block.
   - Split title text at the caret.
   - Keep text before the caret in the table title.
   - Move trailing title text into a new paragraph block immediately after the table.
   - Preserve inline marks for the moved trailing text if feasible with existing split/join primitives; otherwise add the narrowest command-level support needed so this does not flatten formatting silently.

5. Add cell move support.
   - Add a command such as `moveTableCell` that moves a cell block before/after another cell in a target row.
   - Allow cross-row moves.
   - For sparse rows, use simple splice semantics: remove from the source row and insert into the target row at the indicated position. Do not normalize row widths or create filler cells.
   - Keep structural validation tight: source must be a cell block, target row must be a `table_row`, and the move must not target the moving cell's own no-op position.

## Phase 2: Keyboard Wiring

Update `examples/block-rich-text/src/App.tsx` so table-specific behavior runs before generic block behavior.

1. Backspace:
   - In `EditableBlock`, use the live DOM selection when handling Backspace.
   - Try `deleteEmptyTableRowBackward` first.
   - If it returns no structural action, use existing `deleteBackwardEverywhere`.
   - Preserve current non-table behavior and same-row cell join behavior where the new command does not apply.

2. Enter in cells:
   - For non-Shift Enter in a table cell, try `exitEmptyLastTableRow` first.
   - If it does not apply, keep existing `advanceFromTableCellEnd` behavior.
   - If that does not apply, keep the existing split fallback.

3. Enter in table title:
   - Route table title Enter to `splitTableTitleToParagraph`.
   - Avoid generic `splitBlock` for table blocks so Enter never creates a second table block.

4. Selection restore:
   - Ensure every new table command returns a concrete caret target.
   - Verify `runEditCommand` schedules caret restoration correctly after row deletion, table-to-paragraph conversion, and title splitting.

## Phase 3: Table Title And Table-Level Layout

Refactor table rendering in `App.tsx` and `style.css`.

1. Render the table block's own text as an editable table title.
   - Use the existing rich-text editable surface and selection/decorations pipeline.
   - Style it smallcaps/bold.
   - Provide a sensible empty placeholder if the title has no text.

2. Move the table drag handle to the same left-side placement as normal block rows.
   - Remove the current table-local drag handle from `.tableToolbar`.
   - Prefer sharing the existing `.dragHandle` path instead of duplicating pointer behavior.

3. Remove the static `Table` label.
   - Replace label space with the editable title and compact controls.
   - Keep `+ Row` / `+ Col` out of the title line except as hover affordances added in Phase 5.

4. Make sure title editing syncs across replicas like any other block text.

## Phase 4: Row Gutter Reorder

Update row gutter behavior without changing row drag semantics.

1. Replace the row drag button glyph with row numbers.
   - Render `1`, `2`, `3`, etc. in the left gutter.
   - The row number itself starts row drag with `context.startDrag(row.block.id, event)`.

2. Keep row drop indicators horizontal.
   - The research decision says vertical bars apply to cell drag, not row drag.
   - Reuse existing `useBlockReorder` and `moveBlock` row validation.

3. Adjust styles for scannable row headers.
   - Use tabular numbers.
   - Keep pointer cursor on the draggable row number.
   - Preserve mobile table layout.

## Phase 5: Cell Focus, Cell Drag, And Add Controls

Implement Google-Sheets-like cell interaction separately from generic block drag.

1. Suppress cell block drag handles.
   - Do not render `.dragHandle` for table cells, or hide it via a deliberate table-cell branch.
   - Keep normal block drag handles for non-cell blocks and for the table title row.

2. Highlight the focused cell border.
   - Use `:focus-within` where possible.
   - Make the highlight visible around the full cell, not only the text surface.

3. Start cell drag from the focused cell border.
   - Track the active/focused cell from selection focus or DOM focus.
   - Add pointer zones/overlays on the focused cell border.
   - Avoid interfering with text selection inside the cell body.

4. Add cell drag state.
   - Track source cell id.
   - Track hovered target row and insertion index.
   - On pointer move, compute target insertion from cell/row bounding boxes.
   - On pointer up, call `moveTableCell`.

5. Render vertical cell drop indicators.
   - Show vertical bars between cells and at row edges.
   - Keep indicators scoped to the target row.
   - Do not use the generic horizontal block drop indicator for cell movement.

6. Add hover controls for rows and columns.
   - Add row insertion buttons on hover between row dividers.
   - Add column insertion buttons on hover between column dividers.
   - Wire row buttons to `addTableRow(tableId, context, afterRowId)`.
   - Extend `addTableColumn` or add a new command if column insertion must happen at a specific divider rather than always appending.

## Phase 6: Tests

Add focused tests before broad refactors where possible, then update UI tests as rendering changes land.

1. Command tests in `examples/block-rich-text/src/blockCommands.test.ts`:
   - Backspace in an empty first cell of an all-empty row deletes that row.
   - Backspace in a non-first empty cell moves to the previous cell end.
   - Backspace in an empty cell with non-empty row siblings does not delete the row.
   - Backspace in the only empty row converts the table block to a paragraph.
   - Enter in an all-empty last row deletes the row and inserts a paragraph after the table.
   - Enter in the only row does not delete the row.
   - Enter in a non-last row keeps existing cell advance behavior.
   - Enter in the table title creates a paragraph after the table and moves trailing title text into it.
   - Cell move can move within a row.
   - Cell move can move across rows with splice semantics.

2. UI tests in `examples/block-rich-text/src/App.test.tsx`:
   - The editable table title renders and syncs to the peer editor.
   - Pressing Enter in the title creates a paragraph after the table instead of another table.
   - Row gutter renders row numbers and row dragging still reorders rows.
   - Cell drag handles are absent.
   - Focused cells show the focused-cell class/state or visible border hook.
   - Dragging from the focused cell border moves a cell and shows vertical drop indicators.
   - Hover row/column insertion controls appear and create rows/columns at the intended divider.

3. Regression tests:
   - Existing table creation, Tab navigation, same-row join, and row reorder tests still pass.
   - Non-table Backspace/Enter behavior remains unchanged.
   - Code block Enter/Shift+Enter behavior remains unchanged, including inside table cells.

## Verification

Run:

1. `pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
2. `pnpm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
3. `pnpm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts`
4. If CSS/drag behavior is hard to trust in jsdom, start the Vite app and verify manually in the browser with a table containing at least three rows and uneven cell counts.

## Implementation Notes

- Keep the command layer deterministic and DOM-free; all row/cell/table decisions should be testable in `blockCommands.test.ts`.
- Keep generic block drag and cell drag separate. Sharing `useBlockReorder` for cells will likely preserve the exact horizontal drop behavior this task is trying to remove.
- Be careful with the table title: the table block is currently hidden by `TableBlock`, but it is still a normal text block. Most bugs here will come from accidentally rendering it twice or letting generic split create another table.
- Use zero-length CRDT text for "empty"; whitespace is content.
- Preserve sparse tables. Do not add filler cells during cell drag unless a later requirement asks for normalization.
