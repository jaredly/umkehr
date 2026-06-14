# Plan: Block Types For `examples/block-rich-text`

## Phase 1: Example Metadata Foundation

Goal: move the example onto a typed metadata model without changing the editor's behavior yet.

Tasks:

- Add `examples/block-rich-text/src/blockMeta.ts`.
- Define the example-local tagged union:

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
    | {type: 'table_row'; ts: HLC};
```

- Add constructors and predicates: `paragraphMeta`, `sameTypeWithTs`, `isTableBlock`, `isTableRow`, `isCellBlock`, `isEditableBlock`, `isWholeSubtreeStyledBlock`.
- Convert `Replica`, `DemoState`, `CommandResult`, `MultiCommandResult`, history actions, and command helpers to `CachedState<RichBlockMeta>` / `Op<RichBlockMeta>`.
- Replace `initialState('doc', '00000')` with `initialStateWithMeta('doc', paragraphMeta('00000'))`.
- Keep persisted/imported history compatible with the new metadata shape, or explicitly reject older exports with a useful message.

Tests:

- Typecheck the example after generic threading.
- Existing block-rich-text tests still pass.
- History export/import round-trips the new metadata shape.

## Phase 2: Block Type Commands And Linear Rendering

Goal: implement the non-structural block types that do not require virtual parents.

Tasks:

- Add `setBlockType` / `setBlockMeta` commands built on `setBlockMetaOps`.
- Add toolbar or block-type menu controls for paragraph, heading levels, ordered/unordered list item, todo, blockquote, code, and callout.
- Add todo checkbox toggling as a `block:meta` operation with whole-meta LWW.
- Render list items with derived ordered-list numbering.
- Render headings, todos, blockquotes, code blocks, and callouts.
- Render rich-text marks inside code blocks.
- Add language control for code blocks. Start with plain monospace rendering if syntax highlighting is too large for this phase.
- Add callout kind controls for info/warning/error.

Keyboard and editing policy:

- Enter in an empty non-paragraph block converts the current block to paragraph.
- Non-empty splits preserve the original block metadata for the new block.
- Enter inside a non-empty code block inserts newline text into the same block instead of splitting.
- Tab inside code inserts spaces.
- Tab outside code keeps the existing block indent/unindent behavior for now.

Tests:

- Metadata command updates both replicas.
- Undo/redo handles block type changes.
- Empty non-paragraph Enter converts to paragraph.
- Non-empty split preserves metadata.
- Code Enter inserts a newline and does not create a new block.
- Todo toggle syncs and replays through history.

## Phase 3: Grouped Subtree Rendering

Goal: support visual treatments that apply to a block and all of its descendants.

Tasks:

- Introduce a render tree layer over `visibleBlockOutline` plus formatted runs.
- Render blockquote subtrees with a continuous left border covering the block's own content and child blocks.
- Render callout subtrees similarly, with kind-specific treatment across the whole subtree.
- Make drag/drop, depth indentation, and selection decorations work inside grouped subtree containers.
- Keep `data-block-id` on text-editable blocks so DOM selection helpers keep working.

Tests:

- Blockquote left border wraps descendants.
- Callout visual container wraps descendants.
- Selection restore and retained selection decorations still render inside grouped subtrees.
- Dragging blocks within and around grouped subtrees preserves valid outline order.

## Phase 4: Virtual Parent Support In `block-crdt`

Goal: make non-block Lamport ids usable as block parents for annotations and table rows.

Tasks:

- Add a virtual-parent configuration surface to core block traversal/helpers. A likely shape is a function that derives virtual parent ids from block metadata, such as `blockMeta -> Lamport[]`.
- Update block parent validation so `BlockOrder.path` may include configured virtual parent ids in addition to real block ids and root.
- Update parent derivation and materialized paths to tolerate virtual parents.
- Update `visibleBlockChildren`, `visibleBlockOutline`, `materializedBlockPath`, `materializedBlockParent`, `visibleSiblingAnchorsForPath`, `insertBlockOps`, and `moveBlockOps` or add variants that accept the virtual-parent configuration.
- Update remote apply dependency checks so ops parented under known virtual parents do not remain permanently pending.
- Preserve default behavior for callers that do not opt into virtual parents.
- Add explicit cycle-safety tests involving virtual parents.

Decisions:

- Use true virtual parents, not hidden/system blocks.
- Keep the richer block metadata local to the example for now.

Tests:

- Insert/move blocks under a virtual parent.
- Visible traversal excludes virtual parent ids but includes their children where requested by configured traversal.
- Remote ops under virtual parents apply after the block/mark that declares the virtual parent arrives.
- Existing core block-crdt tests pass without virtual-parent config.

## Phase 5: Editable Block Navigation Layer

Goal: separate text-editable traversal from raw visible CRDT traversal.

Tasks:

- Replace `selectionModel.visibleBlockIds` with an `editableBlockIds` helper for editor commands.
- Exclude `table_row` blocks and virtual parent ids from text navigation.
- Include normal table cell blocks in editable navigation.
- Update horizontal/vertical movement, block range selection, multi-selection commands, join/split target lookup, and drag/drop inputs to use the right traversal for the operation.
- Make retained selection resolution clamp to nearest editable block if a target block becomes structural or hidden.

Tests:

- Caret movement skips table rows and virtual parents.
- Multi-selection can span ordinary blocks and cells.
- Retained selections survive metadata-only updates and structural table row operations.

## Phase 6: Annotation Marks, Comments, And Footnotes

Goal: implement one annotation data model with different presentations.

Data model:

```ts
type AnnotationMarkData = {
    id: Lamport;
    presentation: 'sidebar' | 'footnote' | 'popover';
    resolved?: boolean;
};
```

Tasks:

- Add commands to create an annotation mark over selected text.
- Parent annotation body blocks under the mark's Lamport id as a virtual parent.
- Use one mark type with `presentation` data for sidebar comments, footnotes, and popovers.
- Render sidebar comments from annotation marks and their body blocks.
- Render footnotes by deriving visible reference order from document order, not stored numbering.
- Hide annotation bodies whose reference range is deleted or fully hidden.
- If the editor later exposes resolved/deleted annotations, list hidden/deleted annotation bodies there.
- Store `resolved` on the mark data, not the body block.

Tests:

- Annotation mark survives split/join.
- Comment body block is parented under the mark id and replays through history.
- Footnote numbering follows document order.
- Deleted/hidden reference stops rendering the body in the main comment/footnote UI.
- One mark type supports sidebar and footnote presentation.

## Phase 7: Table Data Model And Rendering

Goal: render and edit tables using virtual row parents and ordinary typed cell blocks.

Data model:

- A table block has `{type: 'table'; rowParent: Lamport; ts}`.
- A row block has `{type: 'table_row'; ts}` and parent set to the table's `rowParent`.
- A cell block has parent set to a row block and may use any ordinary block metadata, including nested `table`.
- Cells do not render or expose child blocks in the first implementation.
- Table rows' own text is not visible or selectable.

Tasks:

- Add a `createTable` command that creates a table block, allocates `rowParent`, creates row blocks under that virtual parent, and creates cell blocks under rows.
- Render `TableBlock` by finding rows under `meta.rowParent`, then rendering each row's child blocks as cells.
- Allow normal block children under the table block outside the table's row layout.
- Render sparse missing cells as grayed-out clickable cells.
- Clicking a missing cell creates that cell block.
- Add row creation, column creation, and row reordering.
- Add optional column header blocks for user-controlled column widths:
  - A `column_header` block type may be needed later.
  - Width is an optional integer; null means auto.
  - Tables without a column header row do not expose user-controlled widths.
- Defer user-manipulated row heights.
- Defer merged cells, but leave room for a future `merged_cell` type with a column span.

Tests:

- Table creation produces table, row virtual parent, rows, and cells.
- Table rows are ordered by normal block order under `rowParent`.
- Normal children under the table block still render outside the row grid.
- Sparse missing cells render and can be created.
- Nested table cell renders as a nested table.
- Row reorder syncs across replicas.

## Phase 8: Table Editing Semantics

Goal: make table interaction feel like part of the editor rather than an isolated widget.

Tasks:

- Tab moves between cells.
- Tab at the final cell creates a new row beneath and moves into its first cell.
- Split and join are allowed across cells in the same row.
- Backspace/Delete should handle same-row cell boundaries deliberately, not accidentally through generic visible order.
- Multi-selection across cells is supported.
- Dragging cells into and out of tables is allowed because cells have ordinary block types.
- Dragging rows reorders rows under `rowParent`.
- Dragging columns, if included, reorders cells in each row.
- Indent/unindent skips structural `table_row` blocks and avoids corrupting table structure.

Tests:

- Tab navigation across cells and final-cell row creation.
- Split/join across cells in the same row.
- Multi-selection across cells applies text operations and marks correctly.
- Drag a cell out of a table and drag an ordinary block into a row as a cell.
- Indent/unindent cannot move a row into invalid structure.

## Phase 9: Syntax Highlighting And Polish

Goal: finish the visual/editor quality after core behavior is correct.

Tasks:

- Add syntax highlighting if a dependency is acceptable.
- Combine highlighted token spans with CRDT rich-text runs and annotation marks.
- Add compact controls for block type, heading level, list kind, todo checked state, callout kind, code language, table row/column actions, and annotation presentation.
- Make table, callout, blockquote, comments, and footnotes responsive in the two-replica layout.
- Make keyboard behavior consistent across ordinary blocks, code blocks, and table cells.

Tests:

- Screenshot or DOM tests for rich block rendering.
- Interaction tests for controls that emit metadata ops.
- Regression tests for retained selections and DOM restore in styled/grouped/table contexts.

## Phase 10: Final Verification

Run the focused suite before considering the task complete:

```sh
npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src
npm run typecheck
npm run build
npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit
```

Also verify manually in the example:

- two replicas sync metadata, annotations, and table operations
- history replay/import/export still works
- undo/redo gives useful results or clearly reports unsupported structural undo
- offline queues converge for annotation and table operations
