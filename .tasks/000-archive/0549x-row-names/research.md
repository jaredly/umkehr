# Research: Table Row Headers

## Goal

Update `examples/block-rich-text` so `table_row` blocks expose their own text content as an editable row header.

Expected behavior from the task:

- The row header displays the row block's main text content.
- If the row header is empty, show the 1-based row index as placeholder text.
- Splitting a row header splits at the caret and creates a new row immediately after the current row, with trailing row-header text moved into the new row.
- Backspace in an empty row header deletes the row if all cells are empty.
- Backspace in an empty row header moves the cursor to the end of the previous row if any cell in the row is non-empty.

## Current State

Row blocks already exist as first-class CRDT blocks. They are created with `meta: {type: 'table_row', ts: ...}` and are ordered under a virtual row parent owned by the table block.

Relevant files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `examples/block-rich-text/src/style.css`

The current blocker is explicit:

```ts
export const isEditableBlock = (meta: RichBlockMeta): boolean => !isTableRow(meta);
```

That means `editableBlockIds`, range normalization, selection clamping, horizontal/vertical movement, join/split helpers, and retained selection resolution all skip `table_row` blocks today.

Rendering also hides rows as normal blocks:

```tsx
if (meta.type === 'table_row') {
    return <></>;
}
```

Inside `TableBlock`, the first grid column is currently only row controls:

```tsx
<div className="tableRowControls" role="cell" aria-label={`Row ${rowIndex + 1} controls`}>
    <button ... aria-label="Move row">⋮</button>
</div>
```

So there is no editable surface for the row block's text.

## Existing Table Behavior To Preserve

Tables are rendered from `materializeFormattedBlocks(..., richTextVirtualParents(...))`. `tableVirtualParentsForBlock` makes table rows appear as children of a table-owned virtual parent rather than ordinary children of the table block.

Important existing commands:

- `createTable` creates a table, row blocks, and paragraph cell blocks.
- `addTableRow` inserts a row immediately after a provided row or at the end of the table.
- `createMissingTableCell` fills sparse cells.
- `moveTableRow` and generic `moveBlock` can reorder rows.
- `moveTableCellByTab` navigates cells and creates a row after the last cell.
- `deleteEmptyTableRowBackward` currently handles Backspace from the first cell of an empty row.
- `exitEmptyLastTableRow` currently handles Enter from an empty last cell by creating a paragraph after the table.
- `splitTableTitleToParagraph` is a table-title special case, but it is not currently wired into `App.tsx`.

Backspace/delete joins are constrained by `sameTableRowBoundary`, so cell blocks only join within the same row. This guard should be revisited when row headers become part of the editable order, because generic joins may otherwise try to join a row header with a cell or adjacent outside block.

## Recommended Implementation Shape

### 1. Make Row Blocks Editable, But Add Row-Specific Command Guards

Change `isEditableBlock` so `table_row` blocks are included in edit traversal.

This unlocks:

- DOM selection clamping to row headers.
- Retained selections in row headers.
- caret movement to/from row headers.
- normal insert/delete text editing in row headers.
- range selection including row headers.

This also changes old behavior tested by `multiSelectionCommands.test.ts` in "skips structural table rows during horizontal caret movement". That test should be replaced or updated to assert the new row-header traversal behavior.

Because this change affects shared traversal, add row-specific guards in command logic rather than relying on row blocks being non-editable.

### 2. Render The Header In The Row Controls Column

In `TableBlock`, render the row block itself in the first grid column alongside the drag handle.

Likely approach:

- Replace the row-controls-only cell with a row header cell.
- Keep the drag handle.
- Add a `RichTextEditableSurface` or a specialized `EditableBlock` variant bound to `row.block`.
- Use `placeholder={`${rowIndex + 1}`}` when the row block has no visible text.
- Keep `role="rowheader"` or `role="cell"` depending on desired ARIA behavior. `role="rowheader"` is semantically stronger.

Avoid reusing full `EditableBlock` as-is unless its drag handle, block affordance, inline controls, margins, and grid layout are acceptable in the compact first column. A small row-header component using `RichTextEditableSurface` directly is likely cleaner.

The row header still needs the same editing callbacks as `EditableBlock`:

- `onInsertText`
- `onDeleteBackward`
- `onDeleteForward`
- `onSplit`
- selection updates through the existing selection machinery
- navigation callbacks for arrows/Home/End
- paste handling
- keystroke recording

There is duplication risk here because `RichTextEditableSurface` does not own keyboard behavior; `EditableBlock` wires it. A practical implementation can extract a small shared keydown helper if needed, but keep the first pass scoped.

### 3. Add `splitTableRowHeader`

Generic `splitBlock` on a `table_row` would create a new `table_row` block after the current one, but it will not create matching cells. It may also accidentally treat the row like a normal block in places where table-specific shape needs to be preserved.

Add a dedicated command, probably in `blockCommands.ts`:

```ts
export const splitTableRowHeader = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    context: CommandContext,
): OptionalCommandResult
```

Behavior:

1. Accept only selections whose resolved caret or range starts in a `table_row`.
2. If the selection is a range, delete it first with existing selection deletion semantics.
3. Split the row block's text at the caret.
4. Insert a new `table_row` immediately after the current row under the same table row parent.
5. Move trailing row-header text into the new row.
6. Create empty cells in the new row matching the table's current column count.
7. Return selection at the start of the new row header.

Implementation options:

- Option A: call `splitBlockOps` on the row block, then add missing cells to the new row. This should naturally move trailing row text into the new row and preserve marks. Verify it respects the table row virtual parent and produces a row sibling under the row parent.
- Option B: manually insert a new row after the current row, delete trailing text from the old row, and insert that text into the new row. This is more code and may lose inline marks unless marks are copied carefully.

Option A is preferable if tests confirm `splitBlockOps` handles virtual parents correctly for `table_row`.

Do not route row-header Enter through `advanceFromTableCellEnd`; that helper is specifically for table cells.

### 4. Add `deleteTableRowHeaderBackward`

Add a dedicated command for Backspace at the start of an empty row header.

Expected behavior:

- Only apply for collapsed selection in a `table_row`.
- Only apply at offset `0`.
- Only apply when row header text length is `0`.
- If every cell in the row is empty, delete the row subtree.
- If any cell in the row has text, keep the row and move the cursor to the end of the previous row header.

This differs from current `deleteEmptyTableRowBackward`, which acts from the first cell and moves to the previous row's last cell. The task says "previous row" for row-header Backspace, so the best interpretation is previous row header.

Deletion can reuse `deleteVisibleSubtreeOps`, but `isEmptyTableRow` must be updated to include the row header text:

```ts
row header length === 0 && all cell lengths === 0
```

Currently `isEmptyTableRow` only checks cells:

```ts
return cells.length > 0 && cells.every((cellId) => pointTextLength(state, cellId) === 0);
```

After row headers are visible, this should not consider a row empty if its header has content.

For non-empty rows:

- Find the previous row by `tableRows(state, tableId)`.
- If it exists, return `caret(previousRowId, pointTextLength(state, previousRowId))`.
- If there is no previous row, probably return no command so generic Backspace does nothing at document boundary.

### 5. Wire Row-Specific Commands Before Generic Commands

The command order matters. In `App.tsx`, row-specific handlers should run before generic `splitBlockEverywhere` and `deleteBackwardEverywhere`.

Since current edit callbacks already route through `multiSelectionCommands`, there are two possible wiring strategies:

- Add row-aware wrappers in `multiSelectionCommands.ts`, for example `splitBlockEverywhere` calls `splitTableRowHeader` first and falls back to `splitBlock`.
- Or add explicit row-header callbacks in the row-header component that call a new multi-selection wrapper.

The first option is more robust because keyboard, beforeinput, paste/newline, and multi-selection behaviors all pass through the same commands.

For optional commands, use the existing `OptionalCommandResult`, `noCommand`, and `commandApplied` pattern.

## Tests To Add Or Update

Add command tests in `blockCommands.test.ts`:

- Row header text can be inserted into a `table_row` block and read with `blockContents`.
- Splitting `AlphaBeta` in a row header at offset `5` creates a new row immediately after with header `Beta`, leaves `Alpha` in the original row, creates the expected number of empty cells, and selects the new row header at offset `0`.
- Splitting a row header preserves inline marks on trailing text if this is expected from `splitBlockOps`.
- Backspace at offset `0` in an empty row header deletes the row when all cells are empty.
- Backspace at offset `0` in an empty row header does not delete the row when any cell has content and moves selection to the end of the previous row header.
- Backspace at offset `0` in a non-empty row header should fall back/no-op according to generic delete semantics; document expected behavior in the test.
- Existing first-cell Backspace deletion still works, but now respects non-empty row headers.
- Single-row behavior: decide whether deleting the only empty row converts the table to a paragraph, as current first-cell behavior does, or whether row-header Backspace should no-op.

Update `multiSelectionCommands.test.ts`:

- Replace "skips structural table rows during horizontal caret movement" with row-header traversal expectations.
- Add movement across row header -> first cell -> next cell -> next row header if that is the intended order.

Add render/App-level tests if existing test utilities make this cheap:

- Empty row header displays row index as placeholder.
- Typing into the row header updates row block content.
- Pressing Enter in a row header triggers row split rather than table-cell advance.

## Styling Notes

Current grid:

```css
grid-template-columns: 42px repeat(var(--table-columns, 1), minmax(150px, 1fr));
```

The row header will need more than 42px. Consider:

```css
grid-template-columns: minmax(120px, 180px) repeat(var(--table-columns, 1), minmax(150px, 1fr));
```

Suggested classes:

- `.tableRowHeader`
- `.tableRowHeaderDrag`
- `.tableRowHeaderText`

Use the existing placeholder mechanism on `.editableBlock[data-empty="true"]::before`, but it currently emits an invisible 1px placeholder. Row headers need a visible placeholder based on `data-placeholder`.

There is already a later CSS rule near `content: attr(data-placeholder);`; check for whether it is scoped to a different surface before adding a row-header-specific rule.

## Risks And Edge Cases

- Making `table_row` editable changes global selection order. This may affect multi-selection deletion, mark application, word movement, retained selections, and vertical movement.
- Generic `joinWithPrevious`/`joinWithNext` may try to join row headers with adjacent editable blocks unless guarded.
- Range deletion spanning row headers and cells may join blocks in undesirable ways. `sameTableRowBoundary` should likely treat row header and cells in the same row as a boundary case rather than allowing arbitrary joins.
- A row with zero cells currently is not considered empty because `isEmptyTableRow` requires `cells.length > 0`. Sparse or malformed rows may need a clearer rule.
- If `splitBlockOps` on a `table_row` does not preserve virtual-row-parent placement, the split command must manually insert the new row under `table.meta.rowParent`.
- Row placeholders based on row index will change when rows are reordered. That is expected, but tests should assert placeholder is derived from current row order, not persisted text.
- Existing `deleteEmptyTableRowBackward` may now need to consider row header text to avoid deleting a row whose visible header is non-empty.

## Open Questions

1. Should row headers participate in normal caret traversal between table cells?
   - Recommended: yes. Once row headers are editable text, arrow/Home/End/range behavior should include them.

2. What is the exact traversal order inside a table row?
   - Recommended: row header first, then cells left to right, then next row header.

3. For Backspace in an empty non-empty row header with no previous row, should the command no-op or move outside the table?
   - Recommended: no-op at the first row header to avoid surprising table deletion or movement outside the table.
   - Decision: move to the table header

4. For Backspace in an empty all-empty only row header, should it convert the table to a paragraph like current first-cell Backspace does?
   - Existing cell behavior does convert the table. The task only says "delete the row"; for consistency, either keep the conversion for the only-row case or confirm whether an empty table shell should remain.
   - Yes, convert to paragraph

5. When splitting a row header, should existing cell contents be copied, moved, or should the new row get empty cells?
   - Recommended: create empty cells matching the current column count. The task only says trailing row-header text moves.
   - Decision: new row gets empty cells

6. Should row headers support inline marks and links?
   - Recommended: yes by using the same `RichTextEditableSurface` rendering and command path.
   - Yes

7. Should the row header placeholder be purely visual or included in ARIA labeling?
   - Recommended: keep it visual placeholder text and use a stable `aria-label` such as `Row header ${rowIndex + 1}`.
