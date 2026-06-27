# Plan: Rename `kanban` to `columns`

## Decisions From Research

- Canonical block type is `columns`.
- Metadata is `{type: 'columns'; display: 'cards' | 'blocks'; ts: HLC}`.
- `display: 'blocks'` is the default.
- Add two creation commands:
  - `Columns` creates `display: 'blocks'`.
  - `Card columns` creates `display: 'cards'` and preserves current kanban behavior.
- Add a display switch in the existing three-dots block options menu.
- Do not support backwards compatibility for old `kanban` documents, clipboard payloads, histories, tests, fixtures, or serialized metadata.
- Rename CSS classes, data attributes, helper names, and tests from `kanban*` to `columns*`.
- In block display mode, render column blocks like normal blocks inside a horizontal columns layout.
- In block display mode, columns should be horizontally reorderable, and arbitrary dragged blocks should be droppable as new columns.

## Phase 1: Metadata, Types, And Commands

1. Update block metadata types in `examples/block-rich-text/src/blockMeta.ts`.
   - Add `export type ColumnsDisplayMode = 'cards' | 'blocks'`.
   - Replace `{type: 'kanban'; ts: HLC}` with `{type: 'columns'; display: ColumnsDisplayMode; ts: HLC}`.
   - Update `RichBlockType`.
   - Update `sameTypeWithTs` to preserve `display`.
   - Add a small helper if useful, such as `columnsMeta(display, ts)` or `columnsDisplay(meta)`.

2. Update block type menu values.
   - In `blockEditorTypes.ts`, replace `kanban` with `columns` and add `card-columns`.
   - In `blockTypeHelpers.ts`, map:
     - `columns` -> `{type: 'columns', display: 'blocks', ts}`
     - `card-columns` -> `{type: 'columns', display: 'cards', ts}`
   - `blockTypeMenuValue(meta)` can return `card-columns` for `columns/cards` and `columns` for `columns/blocks`, unless the toolbar should always show `Columns`.

3. Rename and extend conversion command logic in `blockCommands.ts`.
   - Rename `convertBlockToKanban` to `convertBlockToColumns`.
   - Accept a `display: ColumnsDisplayMode = 'blocks'` option.
   - Set selected block metadata to `{type: 'columns', display, ts}`.
   - Preserve current default child-column creation.
   - Rename `DEFAULT_KANBAN_COLUMNS` to `DEFAULT_COLUMNS`.
   - Rename helper functions/types:
     - `kanbanColumns` -> `columnsColumns`
     - `kanbanCards` -> `columnsCards`
     - `KanbanColumnContext` -> `ColumnsColumnContext`
     - `KanbanCardContext` -> `ColumnsCardContext`
     - `kanbanColumnContext` -> `columnsColumnContext`
     - `kanbanCardContext` -> `columnsCardContext`
     - `isKanbanColumn` -> `isColumnsColumn`
     - `isKanbanCard` -> `isColumnsCard`
   - Ensure card-context helpers only return results for `display: 'cards'`.

4. Update command dispatch.
   - In `EditorApp.tsx`, replace toolbar/slash dispatch for `kanban`.
   - `columns` calls `convertBlockToColumns(..., 'blocks')`.
   - `card-columns` calls `convertBlockToColumns(..., 'cards')`.
   - Update imports and function names.

## Phase 2: Document, Clipboard, History, And Fixtures

1. Update document import/export in `documentFormat.ts`.
   - Replace `kanban` with `columns` in `DocumentBlockType` and `BLOCK_TYPES`.
   - Add `display?: ColumnsDisplayMode` to `DocumentBlockMeta`.
   - Parse `columns` metadata:
     - missing `display` defaults to `blocks`
     - only `blocks` and `cards` are accepted
   - Import to `{type: 'columns', display, ts}`.
   - Export:
     - omit `meta.display` for `blocks`
     - include `meta: {display: 'cards'}` for card columns.

2. Update raw history validation in `history.ts`.
   - Replace `kanban` validation with `columns`.
   - Require `display === 'blocks' || display === 'cards'`.
   - Remove old `kanban` acceptance.

3. Update clipboard tests and any clipboard type assumptions.
   - The clipboard parser probably does not need bespoke logic if it uses raw metadata validation, but tests should use `columns`.
   - Rename test names and payload variable names away from `kanban`.

4. Update fixtures in `documentFixtures.ts`.
   - Rename the fixture id/label if desired, for example:
     - `columns-board`
     - `Card columns`
   - Convert the old kanban fixture to `type: 'columns', meta: {display: 'cards'}`.
   - Add or update a fixture for default block columns if useful for visual coverage.
   - Update the "everything" fixture text and block type collection expectations.

## Phase 3: Rendering And Block Options UI

1. Rename card-mode rendering components in `EditorApp.tsx`.
   - `KanbanBlock` -> `ColumnsBlock`.
   - `KanbanColumn` -> `ColumnsCardModeColumn` or similar.
   - `KanbanCard` -> `ColumnsCard`.
   - `renderBlockNode` routes `meta.type === 'columns'` to `ColumnsBlock`.

2. Implement display branching.
   - `ColumnsBlock` renders the title block and a columns container for both modes.
   - For `display: 'cards'`, preserve current behavior:
     - direct children are columns
     - grandchildren are card wrappers
     - card descendants render normally
   - For `display: 'blocks'`:
     - direct children are laid out as horizontal columns
     - each direct child renders through normal block rendering semantics
     - descendants render normally, without card wrappers
   - Avoid recursive routing loops by rendering the columns parent specially and rendering child nodes with the existing relative-depth path.

3. Add the display control to the existing block options menu.
   - Extend `BlockOptions` props with `onSetColumnsDisplay(display: ColumnsDisplayMode)`.
   - Add a `meta.type === 'columns'` branch with a select:
     - `Blocks`
     - `Cards`
   - Wire the handler near the existing `onSetPollDisplayMode`, `onSetSlideDeckFooter`, etc.
   - Handler should call `setBlockMeta(current.state, block.id, {...currentBlock.meta, display, ts: nextReplicaTs(current)})`.

4. Rename CSS and DOM attributes.
   - Rename `.kanbanBlock`, `.kanbanTitle`, `.kanbanColumns`, `.kanbanColumn`, `.kanbanCard`, etc. to `.columnsBlock`, `.columnsTitle`, `.columnsColumns`, `.columnsColumn`, `.columnsCard`, etc.
   - Rename `data-kanban-*` attributes to `data-columns-*`.
   - Update slide-specific CSS from `.slideBody > .kanbanBlock` to `.slideBody > .columnsBlock`.
   - Add block-mode styles:
     - horizontal grid/flex container
     - stable column widths
     - normal block rendering inside each column
     - drop indicators for before/after column placement.

## Phase 4: Drag And Drop

1. Rename the existing card-mode drag/drop path in `useBlockReorder.ts`.
   - `resolveKanbanDropTarget` -> `resolveColumnsDropTarget`.
   - Update DOM selectors to `data-columns-*` and `.columnsColumns`.
   - Update helper names and local variables.

2. Preserve card-mode behavior.
   - Card display should keep current semantics:
     - drag columns horizontally
     - drag cards within and across columns
     - preserve existing no-op and child-zone behavior.

3. Add block-mode column drag/drop.
   - The columns container should accept a dragged root block as a new direct child column.
   - Dropping over the left/right half of an existing block-mode column should place before/after that column.
   - Dropping in empty/end space should append as the last column.
   - Dragging an existing column should reorder horizontally.
   - Normal nested block drag/drop should still work inside a column body.

4. Keep drop-target normalization centralized.
   - Reuse existing `normalizeDropTarget`, `targetChildIndicator`, and before/after commands where possible.
   - Add DOM markers/classes only where geometry needs to distinguish column placement from normal child placement.

## Phase 5: Tests

1. Unit tests for metadata and document format.
   - `documentFormat.test.ts`:
     - imports `columns` without metadata as `display: 'blocks'`
     - imports `columns/cards`
     - exports default `blocks` without `meta.display`
     - exports `cards` with `meta.display`
     - rejects invalid `display`
   - `history.test.ts`:
     - raw history with `columns/blocks`
     - raw history with `columns/cards`
     - no remaining `kanban` expectations.

2. Command tests.
   - Existing conversion test becomes "converts a block to columns from the block type menu".
   - Add a card-columns conversion test that verifies `display: 'cards'` and starter columns.
   - Add option-menu test that switches between `blocks` and `cards`.

3. Rendering tests in `App.test.tsx`.
   - Card-mode fixture renders the renamed `.columns*` structure and preserves card counts.
   - Block mode renders columns with normal block rows, not `.columnsCard`.
   - Switching display updates rendering on both replicas.

4. Drag/drop tests.
   - Rename existing kanban drag tests to columns/card-mode tests and update selectors.
   - Add block-mode tests:
     - drag an existing column before/after another column
     - drop an arbitrary top-level block into a columns container as a new column
     - normal block moves inside a column still work.

5. Fixture and clipboard tests.
   - Update `documentFixtures.test.ts` expected block types and fixture labels.
   - Update `clipboard.test.ts` metadata payloads from `kanban` to `columns`.

## Phase 6: Cleanup And Verification

1. Search cleanup.
   - Run `rg -n "kanban|Kanban|data-kanban|\\.kanban" examples/block-rich-text/src .tasks/05guk-columns`.
   - Any remaining occurrences should be intentional historical notes in task/research files only.

2. Typecheck and tests.
   - Run the example test suite, likely `npm exec vitest -- --run` from `examples/block-rich-text` or the repo's established command.
   - If the full suite is too slow, run focused tests first:
     - `documentFormat.test.ts`
     - `documentFixtures.test.ts`
     - `clipboard.test.ts`
     - `history.test.ts`
     - `blockCommands.test.ts`
     - `App.test.tsx`

3. Browser verification.
   - Start the Vite dev server.
   - Verify manually or with Playwright screenshots:
     - creating `Columns`
     - creating `Card columns`
     - switching display in block options
     - dragging/reordering block-mode columns
     - dropping a normal block into a columns container as a new column
     - card-mode columns/cards still behave like the current kanban board.

