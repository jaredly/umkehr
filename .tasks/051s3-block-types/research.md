# Research: Block Types For `examples/block-rich-text`

## Goal

Expand `examples/block-rich-text` from mostly paragraph-like blocks into a richer Notion-style block editor with real block metadata:

- ordered and unordered lists
- checkboxes
- headings h1/h2/h3
- blockquote
- code blocks with configurable language and highlighting
- tables, with cells represented as blocks
- callouts
- comments
- footnotes

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

The current default metadata union is small:

```ts
type DefaultBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    | {type: 'blockquote'; ts: HLC}
    | {type: 'bullets'; ts: HLC}
    | {type: 'checkboxes'; ts: HLC; checked: Record<string, {ts: HLC; checked: boolean}>};
```

`examples/block-rich-text` currently uses `CachedState` and `Op` without a custom metadata type, so it inherits `DefaultBlockMeta`. Rendering calls `materializeFormattedBlocks(replica.state)`, then maps those blocks to `EditableBlock`. Editing commands mostly operate on visible block ids and visible offsets, not on metadata.

`examples/plim-block-crdt` is a useful precedent. It defines:

```ts
export type PlimBlockMeta = {
    type: string;
    attrs?: Record<string, JsonValue>;
    ts: HLC;
};
```

The plim adapter maps `block.meta.type` and `block.meta.attrs` into editor nodes, translates `setBlockType` and `setBlockAttrs` into `block:meta`, and treats some block types as atomic. This is likely the cleanest direction for the block-rich-text example too.

## Recommended Metadata Shape

Use a custom metadata type for the example instead of expanding `DefaultBlockMeta` immediately:

```ts
type RichBlockMeta = {
    type: RichBlockType;
    attrs?: Record<string, JsonValue>;
    ts: HLC;
};

type RichBlockType =
    | 'paragraph'
    | 'heading'
    | 'list_item'
    | 'todo'
    | 'blockquote'
    | 'code'
    | 'callout'
    | 'table'
    | 'table_row'
    | 'table_cell'
    | 'comment'
    | 'footnote';
```

Suggested attrs:

- heading: `{level: 1 | 2 | 3}`
- list_item: `{kind: 'ordered' | 'unordered'}`
- todo: `{checked: boolean}`
- code: `{language: string}`
- callout: `{kind: 'info' | 'warning' | 'error'}`
- table: `{columns: number}` or `{columnIds: string[]}`
- table_row: `{rowId: string}`
- table_cell: `{rowId: string; columnId: string; header?: boolean}`
- comment: `{threadId: string; resolved?: boolean}`
- footnote: `{noteId: string}`

This keeps the example close to the plim adapter, allows new block types without touching core CRDT algorithms, and avoids creating one bespoke TypeScript variant per block type unless that becomes useful for UI exhaustiveness.

One caveat: because `block:meta` is currently LWW for the whole meta object, concurrent attr edits can overwrite each other. That is probably acceptable for the demo's first pass, but it affects checkboxes, code language, callout kind, table column metadata, comments, and footnotes.


### Feedback
Ok we definitely want more type safety than that. Do a tagged union please.

## Implementation Direction

Add a local metadata module in the example, something like `examples/block-rich-text/src/blockMeta.ts`, with:

- `RichBlockMeta` and helper constructors.
- `paragraphMeta(ts)`.
- `updateBlockMeta(state, blockId, patch, context)` command helper.
- guards such as `isTextEditableBlock(meta)`, `isTableStructuralBlock(meta)`, and `isContainerOnlyBlock(meta)`.

Then thread `CachedState<RichBlockMeta>` and `Op<RichBlockMeta>` through the example runtime and command types. `initialStateWithMeta('doc', paragraphMeta('00000'))` can replace `initialState('doc', '00000')`.

The first useful UI slice should be metadata-only block types:

1. headings, list items, todo, blockquote, code, callout
2. toolbar or block-type menu to set type/attrs
3. rendering styles and controls
4. tests for metadata ops, split inheritance, undo, replay/import

Tables, comments, and footnotes should be a second slice because they add structural and side-panel/popover behavior.

## Feature Notes

### Lists

Represent list entries as normal text blocks with `type: 'list_item'` and `attrs.kind`.

Nested lists can reuse the existing child-block outline. Indent/unindent already move blocks under previous siblings or grandparents. Rendering can show bullets/numbers based on visible siblings with the same parent and list kind.

Ordered-list numbering should be derived at render time, not stored per item. Concurrent moves then naturally renumber in each replica after convergence.

Open question: should Enter on an empty list item convert it back to paragraph, outdent it, or create another list item? Notion-like behavior usually exits the list at an empty item.

#### Feedback

Let's follow notion behavior; if the block is empty and not a paragraph, we convert to paragraph.

### Checkboxes

Prefer `type: 'todo'` with `attrs.checked` over the current default `checkboxes.checked` map.

The existing `checkboxes.checked: Record<string, ...>` shape looks like it was intended for per-character or per-item state, but once each checkbox is its own block, a single `checked` value on block metadata is simpler. Toggling the checkbox should emit `block:meta` and be recorded in history like other local changes.

Open question: should concurrent checkbox toggle use whole-meta LWW, or should checkbox state become a dedicated nested timestamp such as `{checked: {value: boolean; ts: HLC}}`? Whole-meta LWW is simpler but can lose a concurrent type/attr edit.

#### Feedback

Whole meta LWW.

### Headings

Represent h1/h2/h3 as `type: 'heading'` plus `attrs.level`.

Split behavior should probably preserve heading metadata for the left block and create a paragraph for the new right block when splitting at end, matching common editors. Current `splitBlockOps` likely copies existing metadata to the created block via core `split`; if that is true, the example command can immediately follow with `setBlockMetaOps` for the new block where needed.

Open question: should splitting in the middle of a heading keep the right side as heading, or convert only empty/end splits to paragraph?

### Blockquote

Represent as `type: 'blockquote'`. This is already in `DefaultBlockMeta`, but the example should move to the unified `RichBlockMeta` shape.

Blockquote nesting can use normal children. Rendering should avoid confusing quote indentation with block depth indentation.

#### Feedback

Note that the rendering for a blockquote should have the left border cover all child blocks as well as the blockquote content itself.

### Code Blocks

Represent as `type: 'code'` plus `attrs.language`.

Code blocks should remain text-editable blocks, but inline rich-text marks probably should not render inside them. Existing mark operations can still technically affect code text unless commands block them.

Syntax highlighting can be render-only from visible text. For a demo, a small dependency like `highlight.js` or `shiki` would require package changes; a lightweight first pass can use plain monospace plus language selection, then add highlighting if dependency install is acceptable.

Open questions:

- Should code blocks allow multiline text inside one block, or should Enter split into another block as it does today?
- Should Tab inside code insert spaces, while Tab outside code indents blocks?
- Should bold/italic commands be disabled inside code?

#### Feedback

Let's try to render rich-text inside code blocks (we'll want it for inline comment support at least, so why not the other stuff).
Also, enter in the middle of a code block should create a newline, not a new block.

### Callouts

Represent as `type: 'callout'` plus `attrs.kind`.

A callout can be a normal text block with optional children. Rendering can show an icon/control based on kind. Splitting a callout likely should create another callout only for mid-text splits and a paragraph for empty/end splits.

#### Feedback

Let's have whole-block-plus-children formatting for callouts, same as blockquotes.

### Comments

There are two plausible models:

1. Block comments: `type: 'comment'` blocks with `attrs.threadId`, rendered in a sidebar and not necessarily inline in the outline.
2. Text comments: mark ranges with `type: 'comment'` and `data: {threadId}`, plus separate comment body blocks somewhere else.

Given the request says "comments rendered in a sidebar", text comments as marks are more useful for anchoring a comment to selected text. The sidebar body can be represented as comment blocks under a hidden/system parent later, but the first pass can store comment metadata externally in the example history only if persistence is not important.

The CRDT already has marks with JSON data and split/join-aware mark materialization, so text-anchored comments should use marks rather than block metadata.

Open questions:

- Are comments attached to selected text, whole blocks, or both?
- Do comment bodies need to be collaborative CRDT text, or is this just a visual annotation demo?
- Where should resolved/deleted comment threads live?

#### Feedback

Ok so we want text-anchored comments (via addMark), but the metadata on the mark is just a lamport ID. Then the "text" of the primary comment lives in a block whose `parent` points to the mark's lamport ID. That way we can have a "thread" of comments and replies and such, with normal block parentage and nesting. I think the "resolved" attribute should live on the mark, not on the block.

### Footnotes

Footnotes are closer to comments than block types if they attach to text. Recommended model:

- mark selected text or insertion point with `type: 'footnote_ref'` and `data: {noteId}`
- store footnote content in normal blocks under a footnotes container, or as `type: 'footnote'` blocks with `attrs.noteId`
- render refs inline and content in a popover or bottom section

Open questions:

- Can one footnote have rich block content, or only plain text?
- Is footnote ordering derived from document order of refs, or stored as explicit numbers?
- What happens when the referenced text is deleted?

#### Feedback

Same model as comments, but different rendering. In fact, perhaps the data model should be identical, with an attribute on the `mark` indicating whether it's presented in the "sidebar" or a "footnote" or a "popover".

## Tables

Tables need the most careful design because rows and cells are structural blocks, while each cell should still contain editable blocks.

### Option A: Table -> Row -> Cell -> Content Blocks

Tree shape:

```text
table
  table_row
    table_cell
      paragraph
      paragraph
    table_cell
      paragraph
  table_row
    table_cell
      paragraph
    table_cell
      paragraph
```

Pros:

- Maps naturally to the existing block parent/child CRDT.
- Cell contents are ordinary blocks, so retained selections, marks, split/join, history, and moves mostly keep working.
- Dragging blocks into or out of a cell can be represented as normal `block:move`.
- Rows and cells have stable block ids.

Cons:

- Generic `visibleBlockOutline` will include table, row, and cell blocks unless rendering filters or groups them.
- Generic split/join commands must not split or join structural `table`, `table_row`, or `table_cell` blocks.
- Generic drag/indent must constrain moves so rows stay under tables, cells stay under rows, and content blocks stay under cells or normal containers.

This is the recommended model.

### Option B: Table -> Row, Cells Stored In Row Attrs

Tree shape:

```text
table
  table_row {cells: [{cellId, blockIds...}]}
```

This fights the CRDT. It stores structural order inside LWW metadata instead of using `BlockOrder`, and moving content between cells would require attrs updates that can conflict as whole-meta overwrites.

Not recommended.

### Option C: Table -> Cell Blocks Directly

Tree shape:

```text
table
  table_cell {rowId, columnId}
  table_cell {rowId, columnId}
```

This avoids row header blocks and allows other children under the table, but row-level operations become derived from metadata and sibling ordering. It also makes inserting/deleting rows less explicit.

Not recommended for the first implementation.

#### Decision

So I actually think I want table blocks to be self-contained, such that there could be normal block children of the table block.
The way this works will be: the metadata of a table block will have a `rowParent: lamportId`. Then "row" blocks will have their parent be that "rowParent" id, and ordering based on the fractional index as normal. cells will have their `parent` set to one of the rows. In normal editing the "contents" of a "row" block will not be visible or selectable.
Let's prevent cells from having/rendering child blocks for now. cells can have any type, however (i.e. todo, blockquote, callout, or event table [making a sub-table]).
This setup will make reordering rows very natural. Reordering columns will be more invasive (requiring updates to the parent.order of each cell in the column) but I'm fine with that.
It's also the case that tables might be "sparse", where a row doesn't have as many cells are others. The default "add a column" action should add cells to each row, but it's possible for one client to add a row while another adds a column, resulting in a row that doesn't have as many columns as the others. I don't think this is avoidable, and I'm OK with it. We should make that state clear in the editor, and clicking on a "missing" cell should create it.

### Table Command Policy

With Option A, command guards are required:

- `table`, `table_row`, and `table_cell` are container/structural blocks, not directly text-editable.
- Enter/split inside a content block in a cell should create another content block in the same cell.
- Backspace at start of the first content block in a cell should probably not join with the previous cell's content.
- Delete at end of the last content block in a cell should probably not join into the next cell.
- Dragging a normal block into a cell should target the cell as parent.
- Dragging a cell out of a row should be disallowed unless implementing column operations.
- Dragging a row out of a table should be disallowed unless converting row contents to ordinary blocks.
- Indent/unindent should skip structural blocks and should not move content blocks across cell boundaries by accident.

Open questions:

- Can cells contain multiple blocks, or exactly one block? Multiple blocks are more Notion-like and fit the CRDT better.
- Should table rows/cells be visible in history and selection traversal, or grouped into a separate table renderer?
- How should multi-selection behave across cells?
- Should Tab navigate cells, insert spaces in code, or indent blocks depending on context?
- How are columns inserted/deleted under concurrent edits?
- Should column ids be generated Lamports, UUID-like strings, or derived from cell block ids?

## Rendering Implications

The current render path maps every `materializeFormattedBlocks` item to one `EditableBlock`. That works for linear block types, but tables require grouped rendering.

A likely approach:

- Build a render tree from `visibleBlockOutline(state)` plus formatted block text by id.
- Render ordinary blocks with `EditableBlock`.
- Render `table` blocks with a `TableBlock` component that walks row/cell children and renders content blocks inside each cell.
- Keep `data-block-id` on actual text-editable blocks so DOM selection helpers continue to work.
- Do not make structural table blocks contenteditable.

For comments and footnotes, sidebar/popover rendering can be derived from marks in `materializeFormattedBlocks`, plus any note/comment blocks by `noteId` or `threadId`.

## Selection And Navigation Implications

The current selection model is block-id plus grapheme offset. That remains correct for text-editable content blocks.

Structural table blocks should be excluded from text navigation helpers such as `visibleBlockIds` if they have no editable text. Today `visibleBlockIds(state)` is based on `materializeFormattedBlocks(state)`, so it will include all visible blocks even if a block is structural. The example will need an `editableBlockIds(state)` helper.

Affected areas:

- `selectionModel.visibleBlockIds`
- horizontal and vertical movement in `multiSelectionCommands.ts`
- block selection expansion across ranges
- `joinWithPrevious` and `joinWithNext`
- drag/drop target computation in `useBlockReorder`
- DOM queries by `[data-block-id]`

Retained selections should continue to work if selections only target editable content blocks. If a selected block is deleted or transformed into a structural block, resolution should clamp to the nearest editable block, not just the first visible CRDT block.

## Split And Join Policy

The core CRDT split and join operations are type-agnostic. The example command layer should decide metadata inheritance and block-type constraints.

Recommended defaults:

- paragraph: split creates paragraph
- heading: split at middle creates heading or paragraph TBD; split at empty/end creates paragraph
- list_item: split creates list_item with same kind; empty item exits list
- todo: split creates todo unchecked, or paragraph on empty item TBD
- blockquote: split creates blockquote, or paragraph on empty/end TBD
- code: either split code block, insert newline text, or create paragraph after code block TBD
- callout: split creates callout in middle, paragraph at empty/end
- table structural blocks: no direct split/join
- table cell content: split within same cell
- join across different table cells: disallow by default

Because `splitBlockOps` creates a new block id deterministically from the next Lamport counter, the command layer can identify the created block the same way current `splitBlock` does and then append a `block:meta` op if the new block's metadata should differ from the copied source metadata.

## Undo And History

History already accepts `block:meta` in exported/imported operation lists. Core undo planning supports block metadata changes when previous metadata is available.

Risk areas:

- If metadata changes become common, local history action metadata should capture `beforeSelection` and `afterSelection` as it does today, but command labels may need to distinguish format-block changes from text edits.
- Whole-meta LWW means undoing one attr can revert unrelated concurrent attrs if the previous snapshot is stale.
- Structural table operations may involve multiple `block`, `block:move`, and `block:meta` ops; undo support for inserted/deleted blocks, splits, and joins is currently limited.

## Testing Plan

Focused tests should land with each slice:

- metadata command creates `block:meta` and updates both replicas
- history export/import round-trips new metadata
- undo/redo handles block type changes
- split behavior per block type
- join guards prevent crossing table cell boundaries
- drag guards prevent invalid table row/cell moves
- retained selection survives metadata-only updates
- comments/footnotes marks survive split/join if implemented as marks
- table rendering groups rows/cells while ordinary outline commands still operate on editable content blocks

## Open Questions

- Should the example use a loose `type + attrs` metadata shape like plim, or a discriminated union for stronger local typing?
- Is whole-block LWW metadata acceptable for checkbox state and table attrs, or do we need per-attr timestamps?
- What exact Enter/Backspace behavior should each block type have?
- Should code blocks be single CRDT blocks with embedded newline characters, or collections of line blocks?
- Should comments be mark-anchored text annotations, block-level annotations, or both?
- Should comment and footnote bodies be collaborative rich text blocks?
- Can table cells contain multiple blocks?
- Should table structural blocks appear in visible traversal, or should the example introduce an editable/renderable traversal layer?
- What table operations are in scope for the first pass: create table only, or also add/remove rows and columns?
- How should concurrent table column insertion/deletion be represented?
- Should dragging ordinary blocks into and out of cells be allowed in the initial implementation?
- Should the richer block metadata stay local to `examples/block-rich-text`, or should `DefaultBlockMeta` in core be expanded later?

## Suggested First Slice

Start with a custom `RichBlockMeta` in the example and implement non-structural block types first:

1. Convert the example state/runtime/history command types to `CachedState<RichBlockMeta>` and `Op<RichBlockMeta>`.
2. Add block metadata helpers and a `setBlockType` command.
3. Add toolbar/block menu controls for paragraph, heading, unordered list, ordered list, todo, blockquote, code, and callout.
4. Render those block types with CSS and checkbox/language/callout controls.
5. Add split metadata policy for the simple types.
6. Add tests for metadata sync, history replay, undo, and split behavior.

Then implement tables as `table -> table_row -> table_cell -> content blocks`, with explicit command guards before exposing drag/drop into cells.
