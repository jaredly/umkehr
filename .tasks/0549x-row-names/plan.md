# Plan: Table Row Headers

## Phase 1: Command Model And Selection Semantics

Files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`

Tasks:

1. Make `table_row` blocks editable by updating `isEditableBlock`.
2. Confirm `editableBlockIds` now orders table content as:
   - table title/header block
   - row header
   - row cells left to right
   - next row header
3. Add table-row context helpers in `blockCommands.ts` if needed:
   - find table id and row parent for a row id
   - list row cells
   - compute table column count
   - find previous row
4. Update emptiness logic so a row is empty only when:
   - row header text length is `0`
   - all row cells have text length `0`
5. Guard generic joins around row boundaries:
   - avoid row header joining with cells through generic Backspace/Delete
   - avoid row header joining with unrelated previous/next editable blocks
   - preserve existing same-row cell joins

Notes:

- Row headers should support inline marks and links through the same command path as ordinary blocks.
- Range deletion across row headers and cells needs explicit tests because making rows editable changes normalization and join behavior.

## Phase 2: Row Header Commands

Files:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`

Tasks:

1. Add `splitTableRowHeader`.
   - Applies only when the active selection resolves into a `table_row`.
   - Deletes selected row-header text first when the selection is a range.
   - Splits at the caret.
   - Creates the new row immediately after the current row.
   - Moves trailing row-header text into the new row.
   - Creates empty cells in the new row matching the table's current column count.
   - Returns selection at the start of the new row header.
2. Prefer implementing row-header split with `splitBlockOps` plus cell creation.
   - If `splitBlockOps` does not place the new row under the table row parent correctly, manually insert the row under `table.meta.rowParent`.
3. Add `deleteTableRowHeaderBackward`.
   - Applies only for a collapsed caret at offset `0` in an empty row header.
   - If all cells in the row are empty, delete the row.
   - If this deletes the only row, convert the table to a paragraph, matching current first-cell behavior.
   - If any cell in the row has content, keep the row and move selection to the end of the previous row header.
   - If there is no previous row, move selection to the end of the table header/title block.
4. Wire row-aware wrappers before generic commands.
   - `splitBlockEverywhere` should try `splitTableRowHeader` before generic `splitBlock`.
   - `deleteBackwardEverywhere` should try `deleteTableRowHeaderBackward` before generic `deleteBackward`.
   - Existing first-cell empty-row Backspace behavior should remain supported and should respect non-empty row headers.

## Phase 3: Rendering And Interaction

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`

Tasks:

1. Replace the row-controls-only first column with a row header cell.
2. Keep a row drag handle in the row header cell.
3. Render the row block's own text in the row header using `RichTextEditableSurface` or a compact row-header component.
4. Use the row index as visible placeholder text when the row header is empty.
5. Preserve standard editing behavior in row headers:
   - typing
   - selection updates
   - Backspace/Delete
   - Enter split
   - paste
   - arrow/Home/End movement
   - undo/redo and keystroke recording
   - inline mark/link commands
6. Do not route row-header Enter through `advanceFromTableCellEnd`; that remains cell-only behavior.
7. Update CSS grid sizing for the first column from a controls-width column to a usable header column.
8. Add row-header-specific placeholder styling using `data-placeholder`.
9. Use a stable accessible label such as `Row header ${rowIndex + 1}`. Keep the visible placeholder visual-only unless later requirements say otherwise.

## Phase 4: Tests

Files:

- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx` if existing render helpers make UI coverage practical

Command tests:

1. Inserting text into a `table_row` stores visible row-header content.
2. Splitting `AlphaBeta` at offset `5` leaves `Alpha` in the original row, creates the next row with `Beta`, creates empty cells matching the table column count, and selects the new row header at offset `0`.
3. Splitting a marked row header preserves marks on trailing text.
4. Backspace at offset `0` in an empty row header deletes the row when all cells are empty.
5. Backspace at offset `0` in an empty only-row header converts the table to a paragraph.
6. Backspace at offset `0` in an empty row header with non-empty cells keeps the row and moves to the previous row header end.
7. Backspace at offset `0` in the first row header with non-empty cells moves to the table header/title end.
8. Existing first-cell Backspace deletion still works.
9. First-cell Backspace does not delete a row whose row header has content.
10. Generic joins do not merge row headers into cells or unrelated blocks.

Selection and movement tests:

1. Replace the old "skips structural table rows" expectation with row-header traversal.
2. Verify horizontal movement order: table title -> row header -> row cells -> next row header.
3. Verify range normalization can include row headers.
4. Verify multi-selection mark/link commands work on row headers.

Render tests:

1. Empty row header shows the current 1-based row index placeholder.
2. Reordering rows updates empty row-header placeholders.
3. Typing into a row header updates the row block's content.
4. Pressing Enter in a row header splits the row rather than advancing through cells.

## Phase 5: Verification

Run focused tests first:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/multiSelectionCommands.test.ts
```

Then run the broader example suite:

```sh
npm exec vitest -- run examples/block-rich-text/src
```

For UI verification:

1. Start the block-rich-text dev server.
2. Create a table.
3. Type row headers.
4. Verify empty row placeholders show row indexes.
5. Split a row header and confirm the new row appears immediately after with empty cells.
6. Test Backspace cases:
   - empty row with empty cells deletes
   - empty row with contentful cells moves to previous row header or table header
   - only empty row converts to paragraph
7. Verify row drag/reorder still works and placeholders renumber.

## Implementation Order

1. Add failing command tests for row-header split and Backspace decisions.
2. Implement command helpers and row-aware multi-command wrappers.
3. Make `table_row` editable and update traversal tests.
4. Add rendering and CSS for row headers.
5. Add UI tests or manual verification for placeholders and keyboard routing.
6. Run focused tests and then broader example tests.
