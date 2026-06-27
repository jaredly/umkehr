# Plan: Table Keyboard Navigation

## Decisions From Research

- Sparse target rows should create missing cells during vertical navigation.
- `ArrowLeft` from the first cell in a row should move to that row's header.
- `ArrowRight` from the last cell in a row should wrap to the next row header.
- Row headers participate in table navigation and should behave like another cell.
- Cells with nested child blocks should navigate through nested block contents before leaving the cell.
- `Alt`/`Meta` word/block arrow movement should stay generic.
- Table-aware navigation should live near the existing table commands unless the extraction becomes awkward.

## Phase 1: Add Table Navigation Primitives

Add command-level helpers in `examples/block-rich-text/src/blockCommands.ts`.

Create a table navigation model that can resolve an editable block into one of:

- table title
- row header
- cell
- nested block inside a cell
- non-table block

Use existing helpers where possible:

- `tableCellContext`
- `tableRowContext`
- `tableRows`
- `tableCells`
- `tableColumnCount`
- `createMissingTableCell`
- `createEmptyCellsForRow`

Expose focused commands such as:

```ts
export const moveTableSelectionByArrow = (
    state: CachedState<RichBlockMeta>,
    selection: EditorSelection,
    direction: 'left' | 'right' | 'up' | 'down',
    context: CommandContext,
): CommandResult | null;
```

Implementation details:

- Return `null` when the selection is not table-related or when modified/generic movement should handle it.
- For non-collapsed selections, collapse consistently with existing arrow behavior before resolving table movement.
- For vertical navigation from cells/row headers, preserve the source column:
    - row header is logical column `-1`
    - cells are columns `0..n`
- If a target cell column is missing, create missing cells up to that column and return ops plus selection in the newly-created/existing cell.
- For vertical navigation from nested cell children, first move through nested editable blocks in that cell. Only leave the cell after crossing the first/last nested block boundary.
- For left/right from cells, only handle cell-boundary cases:
    - left at cell start moves to previous cell end, or row header end when in first cell
    - right at cell end moves to next cell start, or next row header start when in last cell
- For left/right from row headers:
    - left at row header start may fall back to generic navigation
    - right at row header end moves to the first cell in that row, creating it if needed
- Keep table title movement generic unless later testing shows title-to-row navigation is needed.

## Phase 2: Wire Plain Arrow Keys In React

Update `EditableBlock` in `examples/block-rich-text/src/App.tsx`.

Add table-aware handling before the existing `previousBlockId` / `nextBlockId` boundary handlers:

- Plain `ArrowLeft` / `ArrowRight` with no `Shift`, `Alt`, `Meta`, or `Ctrl`
- Plain `ArrowUp` / `ArrowDown` with no `Shift`, `Alt`, `Meta`, or `Ctrl`

For left/right:

- Let native browser movement continue while the caret is inside block text.
- When caret is at the relevant boundary, call `moveTableSelectionByArrow`.
- If it returns a result, prevent default, schedule restore, and apply returned ops/selection.
- If it returns `null`, keep the existing generic block-boundary fallback.

For up/down:

- Preserve current visual-line checks so native movement within multi-line text still works.
- When crossing the first/last visual line, call table-aware movement first.
- Use the current `verticalCaretXRef` / DOM offset code for target offset when the command only identifies a target block.
- If creating a missing cell, restore to offset `0` in that cell unless a better x-based offset can be computed after render.

Keep `Alt`/`Meta` movement untouched.

## Phase 3: Align Shift-Arrow And Multi-Selection Movement

Update `examples/block-rich-text/src/multiSelectionCommands.ts` so command-driven movement does not use flat `editableBlockIds` inside tables.

Targets:

- `extendSelectionHorizontally`
- `extendSelectionVertically`
- `moveSelectionHorizontally`
- `moveSelectionVertically`

Approach:

- For modified word/block movement, keep existing behavior.
- For plain character/vertical movement, attempt table-aware movement before flat movement.
- Because sparse vertical navigation may create missing cells, either:
    - route shift/up/down table navigation through a command helper in `App.tsx`, or
    - split pure target resolution from mutating cell creation so multi-selection commands can compose ops.

Prefer keeping mutations in `blockCommands.ts` and adding a small multi-selection wrapper only if tests require it. Do not create a second divergent table-navigation implementation.

## Phase 4: Tests

Add command-level coverage first, likely in `examples/block-rich-text/src/blockCommands.test.ts`.

Required cases:

- `ArrowDown` from row 1, column 2 moves to row 2, column 2.
- `ArrowUp` from row 2, column 2 moves to row 1, column 2.
- Vertical navigation to a sparse row creates missing cells and selects the requested column.
- Vertical navigation from row header moves to previous/next row header.
- `ArrowLeft` from first cell moves to the row header end.
- `ArrowRight` from row header end moves to first cell start.
- `ArrowRight` from last cell wraps to next row header.
- Nested blocks inside a cell are traversed before leaving the cell.
- Non-table blocks still use existing movement.
- `Alt`/`Meta` movement remains generic.

Add UI tests in `examples/block-rich-text/src/App.test.tsx` for DOM behavior:

- Plain up/down from cells moves between rows in the same column.
- Left/right at cell boundaries crosses table targets without entering unexpected row/block content.
- Native arrow movement still works inside cell text before reaching a boundary.
- Missing-cell creation from vertical navigation updates both replicas through normal ops.
- Shift-arrow table behavior extends selection through the same table targets if implemented in Phase 3.

## Phase 5: Verification And Cleanup

Run focused tests:

```sh
pnpm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx
```

Then run the broader block-rich-text test set if the focused tests pass:

```sh
pnpm exec vitest -- run examples/block-rich-text/src
```

Manual checks in the demo:

- Create a 2x2 table and verify all four arrow keys from cell boundaries.
- Create a sparse row and verify vertical navigation creates/selects the missing cell.
- Add nested blocks inside a cell and verify arrows traverse nested content before leaving the cell.
- Verify row header navigation works as a grid position.
- Verify modified arrows still behave like normal text editor word/block navigation.

Cleanup:

- If table helper exports start to clutter `blockCommands.ts`, extract navigation-only helpers into `tableNavigation.ts`.
- Keep any new API narrowly scoped to the example; avoid changing core `block-crdt` unless a missing primitive is discovered.
