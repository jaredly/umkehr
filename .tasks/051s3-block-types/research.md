# Research: Block Types For `examples/block-rich-text`

## Goal

Expand `examples/block-rich-text` from mostly paragraph-like blocks into a richer Notion-style block editor with real block metadata:

- ordered and unordered lists
- checkboxes
- headings h1/h2/h3
- blockquote
- code blocks with syntax highlighting and configurable language
- tables, where each cell is a block
- callouts
- text-anchored comments rendered in a sidebar
- text-anchored footnotes rendered as footnotes, popovers, or similar

The important design constraint is that this example sits directly on `umkehr/block-crdt`, so block types should preserve the CRDT's existing split, join, move, retained-selection, formatting, history, and undo behavior rather than creating a parallel document model.

## Current State

Relevant files:

- `src/block-crdt/types.ts`
- `src/block-crdt/changes.ts`
- `src/block-crdt/Readme.md`
- `src/block-crdt/initialState.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/history.ts`
- `examples/plim-block-crdt/src/plimBlockCrdtAdapter.ts`

The CRDT already supports generic timestamped block metadata:

```ts
export type TimestampedBlockMeta = {ts: HLC};

export type Block<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    id: Lamport;
    meta: M;
    order: BlockOrder;
    deleted: boolean;
};

export type Op<M extends TimestampedBlockMeta = DefaultBlockMeta> =
    | {type: 'block:meta'; id: Lamport; meta: M}
    // ...
```

`setBlockMetaOps(state, {block, meta})` creates metadata updates. Conflict resolution for `block:meta` is last-writer-wins by `meta.ts`.

`examples/block-rich-text` currently uses `CachedState` and `Op` without a custom metadata type, so it inherits `DefaultBlockMeta`. Rendering calls `materializeFormattedBlocks(replica.state)`, then maps those blocks to `EditableBlock`. Editing commands mostly operate on visible block ids and visible offsets, not on metadata.

`examples/plim-block-crdt` is still a useful precedent because it translates block type metadata into `block:meta` ops. For this example, though, use a stronger tagged union rather than a loose `type + attrs` record.

## Recommended Metadata Shape

Use a custom tagged union for the example instead of expanding `DefaultBlockMeta` immediately:

```ts
type RichBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    | {type: 'heading'; level: 1 | 2 | 3; ts: HLC}
    | {type: 'list_item'; kind: 'ordered' | 'unordered'; ts: HLC}
    | {type: 'todo'; checked: boolean; ts: HLC}
    | {type: 'blockquote'; ts: HLC}
    | {type: 'code'; language: string; ts: HLC}
    | {type: 'callout'; kind: 'info' | 'warning' | 'error'; ts: HLC}
    | {type: 'table'; rowParent: Lamport; ts: HLC}
    | {type: 'table_row'; ts: HLC}; // note that a table_row's BlockOrder.parent is set to a 'table' block's rowParent
```

There is intentionally no distinct `table_cell` metadata variant. A cell is a normal block whose parent is a `table_row`; it can have any ordinary block metadata, including paragraph, todo, blockquote, callout, code, heading, or table for nested tables.

Use whole-meta LWW for now. This keeps the demo simple and matches current `block:meta` semantics. Checkbox state, code language, callout kind, and table metadata should all be ordinary whole-block metadata updates.

Comments and footnotes should not be block metadata variants. They are mark-anchored annotations with block-backed content.

## Implementation Direction

Add a local metadata module in the example, something like `examples/block-rich-text/src/blockMeta.ts`, with:

- `RichBlockMeta` and helper constructors.
- `paragraphMeta(ts)`.
- `setBlockMeta` / `setBlockType` command helpers.
- guards such as `isTextEditableBlock(meta)`, `isTableRow(meta)`, `isTableBlock(meta)`, `isCellBlock(state, blockId)`, and `isWholeSubtreeStyledBlock(meta)`.

Then thread `CachedState<RichBlockMeta>` and `Op<RichBlockMeta>` through the example runtime and command types. `initialStateWithMeta('doc', paragraphMeta('00000'))` can replace `initialState('doc', '00000')`.

The first useful UI slice should be metadata-only block types:

1. headings, list items, todo, blockquote, code, callout
2. toolbar or block-type menu to set block type and type-specific fields
3. rendering styles and controls
4. tests for metadata ops, split inheritance, undo, replay/import

Tables, comments, and footnotes should be a second slice because they add structural and side-panel/popover behavior.

## Feature Notes

### Lists

Represent list entries as normal text blocks with `type: 'list_item'` and `kind`.

Nested lists can reuse the existing child-block outline. Indent/unindent already move blocks under previous siblings or grandparents. Rendering can show bullets/numbers based on visible siblings with the same parent and list kind.

Ordered-list numbering should be derived at render time, not stored per item. Concurrent moves then naturally renumber in each replica after convergence.

Follow Notion-style empty-block behavior: pressing Enter in an empty non-paragraph block converts that block to a paragraph instead of creating another block of the same type.

### Checkboxes

Represent as `type: 'todo'` with `checked: boolean`.

Toggling the checkbox should emit `block:meta` and be recorded in history like other local changes. Whole-meta LWW is acceptable for checkbox state.

### Headings

Represent h1/h2/h3 as `type: 'heading'` plus `level`.

Split behavior should preserve heading metadata for the left block. For an empty heading, Enter should convert it to a paragraph. For non-empty headings, the command layer can decide whether the new right block remains a heading or becomes a paragraph, but empty-block conversion should be the required Notion-like behavior.

### Blockquote

Represent as `type: 'blockquote'`.

Blockquote rendering should apply to the whole block subtree: the left border should cover both the blockquote's own content and its child blocks. This likely means the renderer needs to group descendants visually under the blockquote instead of styling only the single editable block row.

### Code Blocks

Represent as `type: 'code'` plus `language`.

Code blocks should remain text-editable and should still render rich text marks. This matters for inline comment/footnote marks, and it is reasonable to render bold/italic or other marks in code too unless a later UX pass says otherwise.

Enter in the middle of a code block should insert a newline character into the same CRDT block, not split into a new block. Enter on an empty code block should follow the general empty non-paragraph behavior and convert to paragraph.

Syntax highlighting can be render-only from visible text and `language`. A first pass can use plain monospace plus language selection; adding `highlight.js` or `shiki` is a package/dependency decision.

Open questions:

- Should Tab inside code insert spaces, while Tab outside code indents blocks?
    -> yeah let's indent spaces
- How should syntax highlighting combine with CRDT rich-text runs and comment marks?
    -> carefully? seems like it ought to be doable.

### Callouts

Represent as `type: 'callout'` plus `kind`.

Callouts should use whole-block-plus-children formatting like blockquotes. The callout visual treatment should wrap the block's own content and descendants, not just the single row.

Enter on an empty callout should convert it to a paragraph. Splitting non-empty callouts can keep callout metadata or create a paragraph depending on the final editor policy.

### Comments

Use text-anchored comments via marks, not comment block metadata.

The mark data should contain a Lamport id for the annotation/thread and presentation metadata:

```ts
type AnnotationMarkData = {
    id: Lamport;
    presentation: 'sidebar' | 'footnote' | 'popover';
    resolved?: boolean;
};
```

For comments, use a mark type such as `annotation` or `comment` with `presentation: 'sidebar'`. The text of the primary comment lives in a block whose parent points to the mark's Lamport id. Replies can be normal child/sibling blocks under the same annotation parent, giving threads ordinary block parentage and nesting.

The `resolved` state should live on the mark data, not on the comment body block. That keeps the annotation state attached to the text range it annotates.

This model needs a small extension or convention because normal `BlockOrder.path` parents currently point to block Lamports or the root. The example can either allow annotation Lamports as virtual parents in command/rendering helpers, or create hidden anchor blocks for annotation threads. The cleaner model is virtual annotation parents, but it may require careful helper code around insertion and traversal.

-> let's go with virtual parents

### Footnotes

Footnotes should use the same data model as comments with different presentation.

Use a text-anchored annotation mark with `presentation: 'footnote'` or `presentation: 'popover'`. The footnote body is ordinary rich block content whose parent is the annotation mark's Lamport id, same as comment body blocks. Rendering decides whether to show the body in a sidebar, popover, or bottom footnote section.

Footnote numbering should be derived from document order of visible refs, not stored as explicit numbers.

Open questions:

- Should a deleted or fully hidden reference hide the footnote body, archive it, or surface it as orphaned annotation content?
    -> hide it
- Should sidebar comments and footnotes share one mark type with presentation data, or use separate mark types with identical data shape?
    -> one mark type w/ a presentation attribute

## Tables

Tables should be self-contained but still allow normal block children under the table block.

The recommended model is:

- A `table` block has metadata `{type: 'table'; rowParent: Lamport; ts}`.
- Row blocks are normal CRDT blocks with `{type: 'table_row'; ts}` and parent set to the table's `rowParent`, not to the table block itself.
- Row order uses the normal `BlockOrder` fractional index among siblings under `rowParent`.
- Cell blocks have parent set to one of the row blocks.
- Cell blocks can have any normal block metadata, including nested `table`.
- Cell blocks do not render child blocks for now.
- The contents/text of a `table_row` block are not visible or selectable in normal editing.

Shape:

```text
table {rowParent: R}
  normal child blocks can still live here

R (virtual row parent, not rendered as a normal block)
  table_row
    paragraph cell
    todo cell
    callout cell
  table_row
    paragraph cell
    table cell
```

This makes row reordering natural because rows are ordinary siblings under `rowParent`. Column reordering is more invasive because it requires updating the `parent.order` / sibling order of each cell in that column, but that is acceptable.

Tables can be sparse. The default "add column" action should add cells to each row, but concurrent edits can produce rows with fewer cells, for example one client adds a row while another adds a column. The editor should make missing cells visible, and clicking a missing cell should create it.

### Table Metadata And IDs

`rowParent` should be a Lamport id allocated when the table is created. It acts as a virtual parent for rows. It does not need visible text and should not appear as a normal editable block.

Rows are blocks so they have stable ids and normal ordering. Cells are also blocks so they have stable ids, normal text/marks, retained selections, and normal metadata.

Open implementation question: core public helpers currently validate visible block parents for `insertBlockOps` and `moveBlockOps`. Supporting `rowParent` as a virtual parent may require one of:

- extending core helpers to allow non-block virtual parents,
- representing `rowParent` as a hidden/system block,
- adding example-specific lower-level op helpers for table row insertion/move.

The hidden/system block approach may be the quickest if the current traversal can keep it out of normal editing while still allowing rows to be children.

#### Decision

Let's allow non-block virtual parents. If needed, we can have some kind of configuration indicating how to traverse the tree given virtual parents. Or perhaps the configuration function would just be for taking `blockMeta -> set of virtual parent ids` or something like that.

### Table Command Policy

Required command guards:

- `table_row` blocks are structural and not directly text-editable.
- A table block's own normal children remain ordinary document blocks, separate from rows.
- Cell blocks are directly text-editable and can have any ordinary block type.
- Cells should not render or expose child blocks in the first implementation.
- Enter inside a code cell follows code behavior and inserts a newline.
- Enter inside an empty non-paragraph cell converts it to paragraph.
- Split/join should not operate on `table_row` blocks directly.
- Backspace/Delete should not accidentally join text across different cells.
    -> Feedback: we should definitely allow joining across cells in the same row, as well as splitting.
- Dragging rows should reorder rows under `rowParent`.
- Dragging columns, when implemented, should reorder cells in each row.
- Dragging a cell out of a row should be disallowed unless implementing an explicit "convert cell to block" command.
    -> Feedback: we should also allow dragging cells into and out of tables. cells have ordinary block types, and should be treated as such.
- Dragging ordinary blocks into cells is out of scope while cells do not render children.
- Indent/unindent should skip structural rows and should not move blocks across table row/cell boundaries by accident.

Open questions:

- Should `rowParent` be a true virtual Lamport parent or a hidden/system block?
    -> virtual parent
- What exact visible affordance should represent sparse missing cells?
    -> a grayed out, clickable cell
- What table operations are in scope for the first pass: create table only, add row/column, remove row/column, or reorder row/column?
    -> tab to move between cells, tab at the final cell of a table should create a new row beneath, and row reordering
- Should multi-selection across cells be supported initially?
    -> yes

## Rendering Implications

The current render path maps every `materializeFormattedBlocks` item to one `EditableBlock`. That works for linear block types, but tables, blockquotes, and callouts require grouped rendering.

A likely approach:

- Build a render tree from `visibleBlockOutline(state)` plus formatted block text by id.
- Render ordinary blocks with `EditableBlock`.
- Render blockquote/callout subtrees as grouped visual containers.
- Render `table` blocks with a `TableBlock` component that finds rows via `meta.rowParent`, then renders each row's cell-block children.
- Keep `data-block-id` on actual text-editable blocks so DOM selection helpers continue to work.
- Do not make `table_row` blocks contenteditable.
- Do not render row block text in normal editing.

For comments and footnotes, sidebar/popover/bottom-section rendering can be derived from annotation marks in `materializeFormattedBlocks`, plus body blocks parented to the annotation mark id.

## Selection And Navigation Implications

The current selection model is block-id plus grapheme offset. That remains correct for text-editable ordinary blocks and text-editable cell blocks.

Structural table rows and virtual annotation/table parents should be excluded from text navigation helpers such as `visibleBlockIds`. Today `visibleBlockIds(state)` is based on `materializeFormattedBlocks(state)`, so it will include all visible blocks even if a block is structural. The example will need an `editableBlockIds(state)` helper.

Affected areas:

- `selectionModel.visibleBlockIds`
- horizontal and vertical movement in `multiSelectionCommands.ts`
- block selection expansion across ranges
- `joinWithPrevious` and `joinWithNext`
- drag/drop target computation in `useBlockReorder`
- DOM queries by `[data-block-id]`

Retained selections should continue to work if selections only target editable blocks. If a selected block is deleted or transformed into a structural block, resolution should clamp to the nearest editable block, not just the first visible CRDT block.

## Split And Join Policy

The core CRDT split and join operations are type-agnostic. The example command layer should decide metadata inheritance and block-type constraints.

Recommended defaults:

- paragraph: split creates paragraph
- empty non-paragraph block: Enter converts the current block to paragraph
- heading: non-empty split policy TBD; empty heading converts to paragraph
- list_item: non-empty split creates list_item with same kind; empty item converts to paragraph
- todo: non-empty split creates todo unchecked or paragraph TBD; empty todo converts to paragraph
- blockquote: non-empty split policy TBD; empty blockquote converts to paragraph
- code: Enter in the middle inserts newline text; empty code converts to paragraph
- callout: non-empty split policy TBD; empty callout converts to paragraph
- table: no direct text split/join
- table_row: no direct text split/join
- table cell block: follows its own metadata type, but never joins across different cells by default

Because `splitBlockOps` creates a new block id deterministically from the next Lamport counter, the command layer can identify the created block the same way current `splitBlock` does and then append a `block:meta` op if the new block's metadata should differ from the copied source metadata.

## Undo And History

History already accepts `block:meta` in exported/imported operation lists. Core undo planning supports block metadata changes when previous metadata is available.

Risk areas:

- If metadata changes become common, local history action metadata should capture `beforeSelection` and `afterSelection` as it does today, but command labels may need to distinguish format-block changes from text edits.
- Whole-meta LWW means undoing one field can revert unrelated concurrent fields if the previous snapshot is stale.
- Structural table operations may involve multiple `block`, `block:move`, and `block:meta` ops; undo support for inserted/deleted blocks, splits, and joins is currently limited.
- Annotation body blocks parented to mark ids or hidden parents will need explicit history/replay tests.

## Testing Plan

Focused tests should land with each slice:

- metadata command creates `block:meta` and updates both replicas
- history export/import round-trips new metadata
- undo/redo handles block type changes
- empty non-paragraph Enter converts to paragraph
- code Enter inserts newline rather than splitting
- split behavior per non-code block type
- join guards prevent crossing table cell boundaries
- row reorder moves table rows under `rowParent`
- sparse table missing cells render and can be created
- retained selection survives metadata-only updates
- annotation marks survive split/join
- comment/footnote body blocks replay and render from mark ids
- blockquote/callout rendering wraps child blocks
- table rendering groups rows/cells while ordinary table children remain renderable outside row layout

## Open Questions

- Should `rowParent` and annotation mark parents be true virtual parents, or hidden/system blocks?
    -> virtual parents
- What exact non-empty split behavior should headings, todos, blockquotes, and callouts use?
    -> new block should have the same meta has the original block
- Should Tab navigate cells, insert spaces in code, or indent blocks depending on context?
    -> yes
- How should syntax highlighting combine with CRDT rich-text runs and annotation marks?
    -> carefully
- Should sidebar comments and footnotes share one mark type with presentation data, or use separate mark types with identical data?
    -> same mark type
- What should happen to annotation body blocks when the annotated range is deleted?
    -> no longer rendered, and should be listed among "resolved/deleted" annotations if the editor supports that
- What table operations are in scope for the first pass: create table only, or also add/remove/reorder rows and columns?
    -> add rows/columns, reorder rows
- Should multi-selection across cells be supported initially?
    -> yes
- Should the richer block metadata stay local to `examples/block-rich-text`, or should `DefaultBlockMeta` in core be expanded later?
    -> let's keep it in examples for now

## Suggested First Slice

Start with a custom tagged-union `RichBlockMeta` in the example and implement non-structural block types first:

1. Convert the example state/runtime/history command types to `CachedState<RichBlockMeta>` and `Op<RichBlockMeta>`.
2. Add block metadata helpers and a `setBlockType` command.
3. Add toolbar/block menu controls for paragraph, heading, unordered list, ordered list, todo, blockquote, code, and callout.
4. Render those block types with CSS and checkbox/language/callout controls.
5. Add empty-block Enter conversion and code newline insertion.
6. Add tests for metadata sync, history replay, undo, empty-block conversion, code newline behavior, and split behavior.

Then implement annotations with mark-backed body blocks, followed by tables with `table.rowParent`, `table_row` blocks under that parent, and typed cell blocks under rows.
