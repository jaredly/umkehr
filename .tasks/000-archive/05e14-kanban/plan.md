# Plan: Kanban Block Type

## Decisions From Research

- Add a first-class `kanban` block type.
- A kanban board's direct children are columns.
- A column's direct children are cards.
- Columns and cards are ordinary blocks; their role comes from ancestry, not special row/card metadata.
- No restrictions are placed on the block types used for columns or cards.
- New boards should create three default columns: `todo`, `in progress`, and `done`.
- The board title is editable as the kanban block's own text, matching table title behavior.
- Column drag/reorder should ship in the first version.
- Dragging a column out of a board is allowed as a normal block move.
- Dropping a card into a card's blank body should make it a child of that card.
- Cards should expose a dedicated card drag handle.
- Enter should keep the existing generic split behavior.
- Empty columns should remain when their last card is moved out.
- Outside blocks should be draggable into columns in the first pass.
- Kanban-specific keyboard movement is out of scope for now.

## Phase 1: Metadata, Serialization, And Creation Surfaces

Add `kanban` everywhere block metadata is defined, validated, imported, exported, or selected.

- In `examples/block-rich-text/src/blockMeta.ts`:
  - Add `{type: 'kanban'; ts: HLC}` to `RichBlockMeta`.
  - Add a `sameTypeWithTs` branch for `kanban`.
  - Add helper predicates if useful, e.g. `isKanbanBlock(meta)`.
- In `examples/block-rich-text/src/documentFormat.ts`:
  - Add `kanban` to `DocumentBlockType` and `BLOCK_TYPES`.
  - Accept empty metadata for `kanban` in `parseMeta(...)`.
  - Add `richMetaForDocumentBlock(...)` and `documentBlockForMeta(...)` branches.
- Update any metadata validators in:
  - `examples/block-rich-text/src/history.ts`
  - `examples/block-rich-text/src/clipboard.ts`
- In `examples/block-rich-text/src/App.tsx`:
  - Add `kanban` to `BlockTypeMenuValue`.
  - Add toolbar option `Kanban board`.
  - Add slash command `/kanban`, label `Kanban board`, keywords like `board`, `trello`, `cards`, `columns`.
  - Update `blockTypeMeta(...)` and `blockTypeMenuValue(...)`.
- Add format/metadata tests:
  - document import/export round trip for a kanban board with columns and cards.
  - clipboard/history validation accepts `kanban`.

## Phase 2: Command Helpers

Implement the model-level operations before wiring complex UI.

- Add `convertBlockToKanban(...)` in `examples/block-rich-text/src/blockCommands.ts`.
  - If the focused block is already `kanban`, no-op.
  - Set focused block meta to `{type: 'kanban', ts}`.
  - If the board has no visible children, insert three paragraph child blocks titled `todo`, `in progress`, and `done`.
  - Preserve existing children as columns when present.
  - Return selection in the first column title when default columns are created.
- Add kanban structure helpers, colocated in `blockCommands.ts` initially unless shared use argues for extraction:
  - `kanbanColumns(state, boardId)`
  - `kanbanCards(state, columnId)`
  - `kanbanColumnContext(state, columnId)`
  - `kanbanCardContext(state, cardId)`
  - `isKanbanColumn(state, blockId)`
  - `isKanbanCard(state, blockId)`
- Preserve moved block metadata, text, and children.
- Preserve empty source columns when cards move out.
- Add command tests in `blockCommands.test.ts`:
  - converting an empty paragraph creates default columns in order.
  - converting a block with existing children preserves those children as columns.
  - normal `moveBlock(...)` moves preserve card subtree and metadata.
  - card child drops use normal child structure.
  - normal `moveBlock(...)` reorders columns.
  - moving a column out through generic `moveBlock(...)` preserves its subtree.

## Phase 3: Initial Kanban Rendering

Render kanban boards without custom drag logic first.

- Add `KanbanBlock` in `examples/block-rich-text/src/App.tsx`, parallel to `TableBlock`.
- In `renderBlockNode(...)`, special-case `meta.type === 'kanban'`.
- Render:
  - board wrapper `.kanbanBlock`
  - board title using `renderEditableBlock(node.block, context)`
  - horizontal `.kanbanColumns`
  - each direct child as `.kanbanColumn`
  - column title/header using `renderEditableBlock({...column.block, depth: 0}, context, ...)`
  - column card stack `.kanbanCards`
  - cards as `.kanbanCard`
  - card children in `.kanbanCardChildren` using relative-depth rendering
- Keep all column/card block types renderable.
  - For visually heavy types such as table, image, preview, and code, constrain overflow inside the card/column rather than normalizing metadata.
- Use dedicated card drag handles in card rendering.
  - Do not rely on the standard block affordance as the only card drag target.
- Add a kanban fixture in `documentFixtures.ts`.
  - Include default-like columns.
  - Include mixed card block types.
  - Include at least one card with children.
  - Include one odd-but-allowed type, such as code/table/preview, for layout coverage.
- Add basic app tests:
  - fixture loads and renders board, columns, cards.
  - toolbar/slash creation creates default columns.
  - text editing still works in board title, column title, and card title.

## Phase 4: Styling And Layout

Add the visual treatment after the markup is stable.

- In `examples/block-rich-text/src/style.css`, add:
  - `.kanbanBlock`
  - `.kanbanTitle`
  - `.kanbanColumns`
  - `.kanbanColumn`
  - `.kanbanColumnHeader`
  - `.kanbanCards`
  - `.kanbanCard`
  - `.kanbanCardHandle`
  - `.kanbanCardChildren`
  - drop indicator classes for card and column slots
- Layout choices:
  - Board title stays full width.
  - Columns scroll horizontally instead of shrinking below a usable width.
  - Columns have enough min-height to expose empty-column drop targets.
  - Cards are compact repeated surfaces.
  - Empty columns remain visibly droppable.
- Make responsive checks part of the phase:
  - long board titles
  - long column titles
  - long card text
  - mobile width with horizontal column scroll
  - nested children in a card

## Phase 5: Kanban-Aware Drop Target Resolution

Extend normal block dragging so cards and outside blocks can target kanban visual slots while still producing ordinary `MoveTarget` commands.

- Avoid adding kanban-specific reorder commands unless implementation proves a real gap.
- Map kanban hit targets to existing `MoveTarget` values:
  - card before another card: `{type: 'before', targetBlockId: cardId}`
  - card after another card: `{type: 'after', targetBlockId: cardId}`
  - card into empty column: `{type: 'child', parentBlockId: columnId, at: 'end'}`
  - card appended to a column: `{type: 'child', parentBlockId: columnId, at: 'end'}`
  - card into another card: `{type: 'child', parentBlockId: cardId, at: 'end'}`
  - column before another column: `{type: 'before', targetBlockId: columnId}`
  - column after another column: `{type: 'after', targetBlockId: columnId}`
  - outside block into a column: before/after a card, or child/end for an empty column.
- Keep `BlockReorderCommand` unchanged except for existing table cell support:

```ts
export type BlockReorderCommand =
    | MoveTarget
    | {type: 'table-cell-slot'; target: TableCellSlotTarget};
```

- Add DOM/data attributes in `KanbanBlock`:
  - `[data-kanban-board-id]`
  - `[data-kanban-column-id]`
  - `[data-kanban-card-id]`
  - stable classes for card stacks and column slots.
- Resolve kanban visual slots from pointer position:
  - over a card: before/after based on vertical midpoint.
  - over empty column body: child/end of that column.
  - below the last card in a column: append.
  - over the blank body of a card: use generic child move to make the dragged card a child.
- Resolve kanban column visual slots:
  - over a column boundary: before/after based on horizontal midpoint.
  - end board area: after the last column, or child/end of the board if there are no columns.
- Preserve existing generic targets outside the board so cards/columns can leave the board.
- Preserve no-op/subtree checks:
  - no dropping into own subtree.
  - no child target if the target parent is inside the dragged subtree.
  - no before/after target if the target block is inside the dragged subtree.
- In `App.tsx` `useBlockReorder({onMove})`, dispatch new command types:
  - existing `MoveTarget` keeps using `moveBlock(...)`.
  - existing `table-cell-slot` remains unchanged.

## Phase 6: Column And Card Drag UX

Wire the rendering to the new drag commands and indicators.

- Card drag:
  - Start drag from the dedicated card handle.
  - Drag selected card block(s) when block selection already includes multiple cards.
  - Otherwise drag the single card.
  - Allow moving:
    - within same column
    - between columns
    - into an empty column
    - to the end of a column
    - into another card as a child
    - outside the board as a normal block
- Column drag:
  - Provide a column handle in the header.
  - Allow horizontal reordering within the same board.
  - Allow dragging a column out as a normal block.
  - Decide at implementation time whether dragging an outside block into the board chrome creates a column; outside blocks must at least be draggable into column card slots.
- Visual indicators:
  - card slot indicator inside the column stack.
  - child drop indicator on a hovered card body/title.
  - column slot indicator between columns.
  - normal block drop indicator outside the kanban board.
  - only one indicator visible at a time.
- Add UI tests:
  - drag card within a column.
  - drag card between columns.
  - drag card into empty column.
  - drag card to end of non-empty column.
  - drag card onto another card as a child.
  - drag card out before/after a normal block.
  - drag outside block into a column.
  - reorder columns.
  - drag column out of board as normal block.

## Phase 7: Editing Boundary Polish

Keep generic editing behavior, but fix any board-specific breakage revealed by rendering and tests.

- Confirm Enter in cards keeps generic split behavior and creates a sibling in the current parent.
- Confirm Tab/Shift+Tab keep existing indent/unindent behavior unless they conflict with table/code behavior.
- Confirm Backspace/Delete behave acceptably at:
  - empty board title
  - empty column title
  - empty card
  - first card in a column
  - first column in a board
- Confirm range and block selection across board boundaries still work.
- Confirm retained selection rendering appears inside:
  - board title
  - column title
  - card title
  - nested card child content
- Add focused tests only for issues found here; do not add kanban-specific keyboard movement in this pass.

## Phase 8: Verification

Run focused tests first, then broader checks.

- `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/history.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/documentFixtures.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
- `npm --prefix examples/block-rich-text run build`

Manual checks:

- Create a kanban board from toolbar and slash command.
- Edit board title, column titles, card titles, and nested card content.
- Drag cards within a column, between columns, into empty columns, into another card, and out of the board.
- Drag an outside block into a column.
- Reorder columns.
- Drag a column out of the board.
- Verify empty columns remain visible and droppable.
- Check odd card types: code, preview, image, table, nested kanban.
- Check desktop and mobile layout for text overflow and usable horizontal scrolling.

## Risks

- Drag target resolution is the highest-risk area because it overlaps existing table cell slot handling and generic block drag behavior.
- Kanban columns/cards being ordinary blocks means generic commands can create structurally odd boards. That is mostly intended, but UI drop targets should avoid accidental board corruption.
- Rendering all block types inside cards may expose layout problems, especially table, preview, image, and code blocks.
- Existing rich text example files already have uncommitted edits; implementation should preserve unrelated changes.
