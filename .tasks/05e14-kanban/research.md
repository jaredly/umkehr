# Research: Kanban Block Type

## Goal

Add a Trello/Kanban-style block type to `examples/block-rich-text`.

The intended model is similar in spirit to the existing table block, but oriented around columns:

- A kanban board is a normal block with `meta.type === 'kanban'`.
- Direct visible children of the kanban block are columns.
- A column's editable text is its title.
- Direct visible children of a column are cards.
- A card with children renders as a card title with nested contents.
- A card without children can render as just the card itself.
- Cards/columns should not be restricted to paragraph metadata. Any existing block type can be used, even if some render oddly.

Drag and drop is the critical part. A card needs to be draggable within a column, between columns, into another card as a child, and out of the kanban board as a normal document block.

## Current State

Relevant files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/documentFixtures.ts`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`

The closest existing feature is `table`.

Tables are not modeled with row/cell metadata. They are modeled with ordinary block ancestry:

- table block: `meta.type === 'table'`
- rows: direct visible children of the table block, excluding nested table blocks in some helper paths
- cells: direct visible children of row blocks

This is important because it matches the kanban request. Columns and cards can also be ordinary blocks whose role is determined by ancestry under a `kanban` block.

Current block metadata is defined in `blockMeta.ts`. `RichBlockMeta` includes `table`, but not `kanban`. Helpers such as `sameTypeWithTs`, `RichBlockType`, document import/export, history validation, clipboard validation, block type menus, and slash commands will all need the new type added.

`App.tsx` renders a materialized block tree with `renderBlockNode(...)`. It special-cases tables:

```ts
if (meta.type === 'table') {
    return <TableBlock key={node.block.id} node={node} context={context} />;
}
```

`TableBlock` renders the table title from the table block itself, then rows and cells from descendants. A kanban block can follow the same top-level pattern with a new `KanbanBlock` component.

Normal block dragging is handled by `useBlockReorder.ts`. It receives a flat outline of `{id, depth, parentId}`, registers visible row elements, resolves pointer coordinates into a `DropTarget`, and calls `onMove(blockIds, target)`.

The generic move command is already rich enough for most kanban moves:

```ts
type MoveTarget =
    | {type: 'before'; targetBlockId: string}
    | {type: 'after'; targetBlockId: string}
    | {type: 'child'; parentBlockId: string; at: 'start' | 'end'};
```

`moveBlock(...)` in `blockCommands.ts` uses `moveBlockOps(...)` and preserves the moved block's metadata and subtree. It already rejects descendant/self moves. It also has table-specific restrictions, such as refusing generic child moves into table rows. Similar restrictions may be needed for kanban only if we want to preserve column/card shape.

## Design Direction

Add a new top-level block meta:

```ts
| {type: 'kanban'; ts: HLC}
```

Use ancestry, not child metadata, to define roles:

- board: the `kanban` block itself
- column: direct child of the board
- card: child of a column
- nested card/body item: child of a card

This keeps the "no restrictions on block types" requirement. A heading can be a column title; a todo can be a card; a code block can be a card, even if the resulting layout is awkward.

The board block's own editable contents should probably be the board title, matching table title behavior. Conversion from an existing block to kanban can preserve the block's current text as the board title and create default empty columns if it has no existing children.

Suggested default conversion:

- `/kanban` or toolbar "Kanban board" converts the focused block to `kanban`.
- If the block has no children, create 3 paragraph children titled `Todo`, `Doing`, and `Done`.
- Do not create default cards.
- If the block already has children, preserve them as columns and do not synthesize defaults.

Open product decision: whether the default column names should be `Todo/Doing/Done`, `Backlog/In Progress/Done`, or fewer/more columns.

## Rendering Plan

Add `KanbanBlock` in `App.tsx`, parallel to `TableBlock`.

Likely shape:

- outer `.kanbanBlock`
- title row renders `renderEditableBlock(node.block, context)`
- columns container `.kanbanColumns`
- each column is a direct child node
- column header renders the column block's editable surface with block affordance hidden or adapted
- column body renders each child as a card
- cards render their own editable block; if they have children, render a nested contents area below the card title

Possible rendering helpers:

```ts
const renderKanbanColumn = (column: RenderTreeNode, context: RenderBlockContext) => ...
const renderKanbanCard = (card: RenderTreeNode, context: RenderBlockContext, baseDepth: number) => ...
```

Cards with no children can render as a compact card containing just `renderEditableBlock({...card.block, depth: 0}, ...)`.

Cards with children should render as:

- card title/editor
- nested content area using `renderBlockNodeAtRelativeDepth(...)`

Nested tables and nested kanban boards should be allowed. Like table cells, special block types may need local CSS constraints so they do not break the board layout.

Column titles should probably keep inline controls available, because any block type is allowed. If the controls make columns too noisy, hide inline controls in column headers and rely on the normal toolbar/slash commands while focused.

## Command Layer

At minimum:

- Add `kanban` to `RichBlockMeta`.
- Add `convertBlockToKanban(...)` in `blockCommands.ts`.
- Add helpers similar to table helpers:
  - `kanbanColumns(state, boardId)`
  - `kanbanCards(state, columnId)`
  - `kanbanColumnContext(state, columnId)`
  - `kanbanCardContext(state, cardId)`

The helpers can initially stay local to `blockCommands.ts` and `App.tsx`, but exporting them from one place may reduce duplication once drag/drop and selection logic need them.

Possible `convertBlockToKanban(...)` behavior:

1. If focus block is already `kanban`, no-op.
2. Change focused block metadata to `{type: 'kanban', ts}`.
3. If it has no visible children, insert default column blocks as children.
4. Return caret in the first column title, or on the board title if conversion no-ops.

Unlike tables, kanban probably does not need special text navigation commands at first. Enter, Tab, Backspace, and arrow behavior can use existing block behavior unless board/column boundary behavior proves rough.

## Drag And Drop

This is the main implementation risk.

Generic `useBlockReorder` already supports:

- reorder before/after a visible block
- make a dragged block a child of the hovered block
- prevent dropping into the dragged subtree
- suppress no-op moves

For many kanban cases, this is enough if the kanban renderer registers the right row/card elements:

- card reorder within a column: before/after another card
- card move between columns: before/after a card in another column
- card become child of another card: child target on hovered card
- card move out of kanban: before/after a normal block outside the board

However, board-specific slots are needed for good Trello-style ergonomics:

- dropping a card into an empty column
- dropping a card at the end of a non-empty column without hovering a specific card
- moving/reordering columns horizontally
- moving a normal outside block into a column, including empty columns
- preventing accidental drops that make a card a sibling of columns when the pointer is in the board chrome

Likely target union:

```ts
type BlockReorderCommand =
    | MoveTarget
    | {type: 'table-cell-slot'; target: TableCellSlotTarget}
    | {type: 'kanban-column-slot'; boardId: string; index: number}
    | {type: 'kanban-card-slot'; columnId: string; index: number};
```

`kanban-card-slot` would move the dragged block(s) as children of the target column with before/after anchors derived from the column's current cards. This handles empty columns and end-of-column drops better than generic child intent.

`kanban-column-slot` would move a column as a direct child of the board. This is useful if column drag handles are supported. It also avoids using normal child/drop heuristics for horizontal column movement.

Implementation options:

1. Extend `useBlockReorder` with kanban slot discovery using DOM classes/data attributes.
2. Keep `useBlockReorder` generic and add kanban-specific drag state in `KanbanBlock`, like `TableBlock` does for cell dragging.

Option 1 is probably better for card drags because cards should behave like normal block drags and leave the board naturally. Option 2 may be better for horizontal column dragging if column behavior diverges from normal block drag.

The table cell drag work already added precedent for extending `BlockReorderCommand` beyond `MoveTarget`. Kanban slots can follow that style.

Important no-op/invalid cases:

- Do not drop a board into one of its own columns/cards.
- Do not drop a column/card into its own subtree.
- If moving multiple selected blocks, preserve visible order.
- If dropping after a target, order may need reversing, matching `orderDraggedBlockIds(...)`.
- Decide whether dropping a column into a card should be allowed. The "no restrictions" note applies to card/row block types, but probably not to breaking board structure accidentally.

## Selection And Editing

`EditorSelection` currently has special table-cell selections, but kanban likely does not need a new selection type for the first version.

Existing block selection and text selection should work if kanban columns/cards are normal blocks in the visible outline.

Potential rough edges:

- `editableBlockIds(state)` includes board, columns, and cards, so range selection can cross board/column/card boundaries in document order.
- Arrow navigation will follow the materialized outline order, not visual column geometry. This may be acceptable initially, but left/right across columns may feel strange.
- Block-level selection of multiple cards should move only top-level selected roots via `selectedTopLevelBlockIdsForSelectionSet(...)`.
- Drag handles may be hidden inside card surfaces if cards render with custom containers. The card renderer should expose a clear card drag handle or preserve `BlockAffordance`.

## Import, Export, Clipboard, History

`documentFormat.ts` needs `kanban` in:

- `DocumentBlockType`
- `BLOCK_TYPES`
- `parseMeta(...)`
- `richMetaForDocumentBlock(...)`
- `documentBlockForMeta(...)`

Because children are already recursive in the document format, no new serialized shape is needed. Example:

```json
[
  {
    "type": "kanban",
    "content": "Project board",
    "children": [
      {
        "content": "Todo",
        "children": [{"content": "Draft proposal"}]
      },
      {
        "content": "Done",
        "children": [{"type": "todo", "meta": {"checked": true}, "content": "Kickoff"}]
      }
    ]
  }
]
```

Clipboard and history validation likely have their own metadata validators. They should accept `{type: 'kanban', ts}`.

Add a kanban fixture in `documentFixtures.ts`, ideally with:

- three columns
- mixed card block types
- a card with child content
- a nested table or nested kanban card if layout needs stress coverage

## Styling

The table styling is a useful reference but kanban should not look like a grid.

Suggested CSS:

- `.kanbanBlock`: margin by `--block-depth`, padding, border, restrained background
- `.kanbanTitle`: board title band
- `.kanbanColumns`: horizontal flex/grid, `overflow-x: auto`, fixed/min column width
- `.kanbanColumn`: vertical stack, subtle border/background, min-height to expose empty drop area
- `.kanbanColumnHeader`: title block styling
- `.kanbanCards`: vertical stack
- `.kanbanCard`: compact card surface with selection/drop/drag states
- `.kanbanCardChildren`: nested contents area with relative depth reset

Avoid nesting card-styled containers unnecessarily. The repeated visual cards should be the kanban cards themselves; the board and columns can be structural surfaces.

Responsive behavior should allow horizontal scrolling rather than crushing columns too narrow. Mobile should still expose columns and cards without text overlap.

## Suggested Implementation Steps

1. Add `kanban` metadata support across `blockMeta.ts`, document format, history/clipboard validators, block type menu, and slash commands.
2. Implement `convertBlockToKanban(...)` with default columns.
3. Add `KanbanBlock` rendering in `App.tsx`, reusing `renderEditableBlock` and relative-depth helpers.
4. Add kanban CSS and a fixture for manual testing.
5. Extend drag target resolution for kanban card slots, including empty-column and end-of-column drops.
6. Add optional horizontal column drag support.
7. Add tests for conversion, import/export, fixture loading, card moves within/between/outside columns, empty-column drops, and card-as-child drops.

## Test Plan

Unit tests in `blockCommands.test.ts`:

- converting a paragraph to kanban creates default columns
- converting a block with existing children preserves those children as columns
- moving a card to another column preserves metadata and children
- moving a card out of a board preserves metadata and children
- dropping a card as a child of another card preserves subtree order

Document tests:

- import/export round trip for kanban with mixed card types
- document format rejects unknown types but accepts `kanban`

App tests:

- slash command or toolbar creates a kanban board
- fixture renders columns and cards
- drag a card within a column
- drag a card between columns
- drag a card into an empty column
- drag a card onto another card as a child
- drag a card out of the kanban board
- optionally drag a normal block into a kanban column

Visual/manual checks:

- desktop and mobile layout
- long column titles and long card text
- nested card children
- odd card block types such as code, preview, table, image
- retained selection rendering inside cards/columns

## Open Questions

1. What default columns should a newly converted kanban board create?
    - todo, in progress, done
2. Should a board title be editable as the kanban block's own text, matching table titles?
    - yes
3. Should column drag/reorder ship in the first version, or only card drag/reorder?
    - yes
4. Should dragging a column out of a board be allowed as a normal block move?
    - yes
5. Should dropping a card into the blank body of a card make it a child, or should child drops require hovering the card title/body center?
    - yes
6. Should cards expose normal block affordances, a dedicated card drag handle, or both?
    - dedicated handle
7. Should Enter at the end of a card create a sibling card, a child/body block, or keep the existing generic split behavior?
    - generic split (will create a sibling)
8. Should empty columns be preserved when their last card is moved out?
    - yes
9. Should outside blocks be draggable into columns in the first pass?
    - yes
10. Should kanban-specific keyboard movement exist eventually, e.g. shortcuts to move cards between columns, or is drag-only enough for now?
    - drag only for now
