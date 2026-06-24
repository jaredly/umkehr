# Research: Row Header Editing Unification

## Task

`examples/block-rich-text`: make row header editing less different. The row header probably does not need a separate editor component. Annotation blocks may be in the same category.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/App.test.tsx`

The editor already has a generic editable content surface:

- `RichTextEditableSurface` renders a `contentEditable` div from formatted runs.
- It handles `beforeinput`, DOM selection read/restore, rendering run nodes, copy/paste hooks, hover triggers for links/code/annotations, inline embeds, and basic DOM event plumbing.
- `EditableBlock` wraps that surface with normal block behavior: keyboard shortcuts, Enter/Tab/Backspace/Delete behavior, block affordances, inline controls, table cell navigation, drag styling, decorations, retained selection display, and command dispatch.

Table row headers are not a separate data model. A row header is just the row block itself:

- `TableBlock` renders each non-table row with `<TableRowHeader row={row.block} ... />`.
- `TableRowHeader` renders a row drag button and a direct `RichTextEditableSurface`.
- Row header text uses the same block id, runs, char ids, selection, decorations, paste, copy, link/code hover, and inline embed plumbing as regular block text.
- The special casing is mostly in the React wrapper and key handling, not in CRDT storage.

Annotation body blocks also use normal blocks, but they have a separate editor path:

- `AnnotationBodyBlock` renders `RichTextEditableSurface` directly.
- It owns local selection state, pending caret/range restore refs, link/code popover state, retained code-mark state, and annotation-specific command dispatch.
- Annotation body commands live in `annotations.ts`: `replaceAnnotationBodySelection`, `splitAnnotationBodyBlock`, `deleteAnnotationBodyBackward`, `deleteAnnotationBodyForward`, annotation body mark/link/code helpers, and paste helpers.

## Where Row Headers Differ Today

`TableRowHeader` duplicates a subset of `EditableBlock` behavior:

- It manually wires `onInsertText`, `onDeleteBackward`, `onDeleteForward`, `onPaste`, `onCopy`, and many key commands.
- It uses the generic editable surface directly instead of `renderEditableBlock`/`EditableBlock`.
- It has row-specific outer markup: `.tableRowHeader`, `role="rowheader"`, row drag button, row header aria label, and numeric placeholder.
- It handles table boundary arrow movement itself by calling `moveTableSelectionByArrowKey` and `extendTableSelectionByArrowKey`.

Because of that fork, row headers can drift from normal block behavior:

- `EditableBlock` supports more shortcuts than `TableRowHeader`, including strikethrough, inline code toggle, Home/End, word/block horizontal movement, multi-selection arrow behavior, visual vertical movement fallback, code handling, image/callout controls, todo toggles, and table-cell Tab behavior.
- Row headers currently call `splitBlockEverywhere` on Enter. There are row-header-specific commands in `blockCommands.ts` (`splitTableRowHeader`, `deleteTableRowHeaderBackward`), but they are not imported or used by `App.tsx` in the current code. This is a likely implementation gap or leftover.
- Backspace in row headers routes through `deleteBackwardEverywhere`; it does not explicitly call `deleteTableRowHeaderBackward`.

## Existing Table Semantics To Preserve

Tests in `App.test.tsx` cover the important row-header behaviors:

- Slash commands open in row headers.
- ArrowLeft from the first table cell moves to the row header.
- ArrowRight/ArrowUp/ArrowDown navigation works from row headers.
- Typing in a row header replicates to the other editor.
- Pasted markdown markers are stripped in row headers.

Command helpers in `blockCommands.ts` show intended table-row semantics:

- `splitTableRowHeader` creates a new table row and empty cells when splitting a row header.
- `deleteTableRowHeaderBackward` removes an empty row header row when its cells are empty, or falls back to the previous row/table title when not removable.
- `deleteEmptyTableRowBackward` is currently used from normal `EditableBlock` Backspace handling.
- `moveTableSelectionByArrow` already treats row headers and cells as navigation locations.

## Recommended Direction

Unify row header editing by reusing `EditableBlock` for the row block, with a small presentation/configuration layer instead of a separate `TableRowHeader` editor.

Likely shape:

1. Add an `EditableBlock` presentation mode or wrapper props for table row headers.
   - Example concerns: outer class/role/aria label, placeholder, affordance override, depth override, and whether block inline controls should be hidden.
   - The goal is to keep `RichTextEditableSurface` and keyboard dispatch in one path.

2. Replace `TableRowHeader`'s direct `RichTextEditableSurface` with `renderEditableBlock`/`EditableBlock` in row-header mode.
   - Keep `.tableRowHeader` and `role="rowheader"` wrapper if needed for layout/accessibility.
   - Keep the row drag button, or express it as an `EditableBlock` affordance override.
   - Preserve the existing `.tableRowHeaderText[role="textbox"]` selector or update tests/styles deliberately.

3. Move row-header-specific Enter/Backspace behavior into the shared edit path.
   - `EditableBlock.onSplit` should try table-title split, then row-header split, then generic split.
   - `EditableBlock.onDeleteBackward` should try empty row deletion/row-header deletion before generic deletion.
   - Use the existing `splitTableRowHeader` and `deleteTableRowHeaderBackward` helpers if their behavior matches the desired UX; otherwise remove or replace them to avoid dead code.

4. Keep table boundary navigation centralized.
   - `EditableBlock` already calls `moveTableSelectionByArrowKey` and `extendTableSelectionByArrowKey` at text boundaries.
   - Once row headers use `EditableBlock`, verify that row-header left/right/up/down behavior still matches tests. If needed, adjust the generic boundary checks rather than reintroducing a row-header component.

5. Add or update focused tests.
   - Existing tests should be kept: slash command, markdown paste, arrow navigation, replication.
   - Add tests for Enter in a row header creating a new row with cells, if that is the intended behavior.
   - Add tests for Backspace at an empty row header, including non-empty-cell fallback behavior.
   - Add a regression test for a normal block shortcut that row headers currently miss, such as Cmd/Ctrl+E code toggle or Home/End, if unification is expected to make it available.

## Annotation Blocks

Annotation body blocks are a similar but larger duplication.

They can probably share more with normal block editing, because the annotation body content is normal block content rendered through `RichTextEditableSurface`. However, `AnnotationBodyBlock` is doing more than row headers:

- It keeps an independent active annotation body selection outside the main editor selection set.
- It has local focus requests for nested/popover annotation bodies.
- It has annotation-specific deletion behavior, including removing an empty body block or resolving/removing an annotation body.
- It has separate link/code popover state and retained inline code mark sessions.
- It has body-specific paste handling that preserves annotation body constraints.

Recommended approach for annotations:

- Treat annotation unification as a follow-up after row headers.
- First extract common editable-block command wiring into reusable hooks/helpers that both `EditableBlock` and `AnnotationBodyBlock` can call.
- Avoid forcing annotation bodies into the main editor selection model until the intended selection/focus behavior is clarified.

## Risks

- Row headers are both editable text and structural table rows. A fully generic block path must still know when Enter/Backspace should create/remove rows instead of ordinary sibling blocks.
- `EditableBlock` renders block affordances and inline controls that may not belong inside row headers. The unification should share editing behavior without accidentally showing normal block handles, todo toggles, code language inputs, image controls, or callout controls in the row header slot.
- Tests currently query `.tableRowHeaderText[role="textbox"]` and aria names like `Row header 1`. Preserving or intentionally migrating those selectors matters.
- Existing source files are modified in the worktree, so implementation should inspect current diffs before editing.

## Open Questions

- Should pressing Enter in a row header create a new table row? The existence of `splitTableRowHeader` suggests yes, but the current UI path appears to call `splitBlockEverywhere` instead.
    - splitBlockEverywhere is fine
- Should Backspace at the start of an empty row header remove the row when all cells are empty? `deleteTableRowHeaderBackward` suggests yes, but the current UI path does not explicitly call it.
    - yes
- Should row headers support the full normal block shortcut set, including code toggle, strikethrough, Home/End, word movement, multi-cursor movement, and block type controls where applicable?
    - yes
- Should row headers allow their block type to become heading/list/todo/code/callout/image through slash commands or toolbar changes, or should they remain paragraph-like text even though they share the editor path?
    - yes, support all block types
- Should annotation body selections eventually participate in the same `EditorSelectionSet` as the main editor, or is their independent selection/focus model intentional?
    - that needs some more thought
- Are annotation body block types meant to support the same full block controls as normal blocks, or only inline text editing plus list/todo markers?
    - yes they should support full controls
