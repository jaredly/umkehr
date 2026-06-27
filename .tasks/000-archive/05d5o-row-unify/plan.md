# Plan: Row Header Editing Unification

## Decisions From Research

- Row headers should use the normal block editing path instead of a separate row-header editor component.
- Enter in a row header can continue using `splitBlockEverywhere`; it does not need to create a new table row through `splitTableRowHeader`.
- Backspace at the start of an empty row header should remove the row when the row's cells are empty.
- Row headers should support the full normal block shortcut set.
- Row headers should support all block types, including heading, list, todo, code, callout, image, and table where the command layer permits it.
- Annotation body blocks should eventually support full block controls, but their selection model needs more thought before folding them into this same change.

## Phase 1: Prepare The Shared Row Header Render Path

Goal: make `EditableBlock` flexible enough to render a row header without losing row-header layout or accessibility.

1. Add row-header presentation props to `EditableBlock`.
   - Suggested shape:
     - `variant?: 'block' | 'table-row-header'`
     - `ariaLabel?: string`
     - `placeholder?: string`
     - `surfaceClassName?: string`
     - `hideBlockAffordance?: boolean`
     - `hideInlineControls?: boolean`
     - optional custom affordance slot for the row drag button
   - Keep default behavior identical for normal blocks.

2. Thread those props through `renderEditableBlock`.
   - Add optional render options to `renderEditableBlock(block, context, options?)`.
   - For ordinary blocks and table cells, call it with no options.
   - For row headers, call it with row-header options.

3. Preserve row-header DOM contracts where practical.
   - Keep an outer `.tableRowHeader` element with `role="rowheader"` and `aria-label="Row N header"`.
   - Keep the editable textbox aria label as `Row header N`.
   - Keep `.tableRowHeaderText` on the editable surface so existing styles/tests continue to work.
   - Keep the row drag button as `.tableRowDrag`.

## Phase 2: Replace `TableRowHeader` Editing With `EditableBlock`

Goal: remove duplicated row-header editor wiring while preserving row-specific chrome.

1. Replace the direct `RichTextEditableSurface` usage in `TableRowHeader`.
   - Keep `TableRowHeader` as a lightweight layout wrapper if useful.
   - Inside it, render the row block through `renderEditableBlock({...row, depth: 0}, context, rowHeaderOptions)`.

2. Remove duplicated row-header keyboard handling.
   - Delete row-header-specific inline handlers for insert/delete/key/copy/paste once `EditableBlock` is handling those.
   - Let shared `EditableBlock` logic handle shortcuts, Home/End, word movement, retained selections, link/code interactions, paste, copy, and inline embeds.

3. Avoid normal-block chrome where it does not belong.
   - Row headers should not show the normal block drag handle in addition to the row drag button.
   - Inline controls may render only if they make sense in the row-header layout. If full block controls are intended through slash/toolbar rather than inline controls, hide inline controls in row-header mode.
   - Todo/list/code/callout/image visual styles should still be represented by normal block classes on the row-header editable area where possible.

## Phase 3: Backspace Row Removal

Goal: support the confirmed behavior that Backspace removes an empty row when the row's cells are empty.

1. Import and use `deleteTableRowHeaderBackward` from `blockCommands.ts`.

2. Update shared `EditableBlock.onDeleteBackward`.
   - Resolve the current primary selection.
   - Try `deleteTableRowHeaderBackward(current.state, selected, context)` before generic deletion.
   - Keep existing `deleteEmptyTableRowBackward` behavior for table cell rows.
   - If a table-specific command applies, replace the primary selection with the command result selection.
   - Otherwise fall back to `deleteBackwardEverywhere`.

3. Re-evaluate dead or confusing command code.
   - `splitTableRowHeader` is not needed for the desired Enter behavior. It can stay if it has future value, but note that it is intentionally unused.
   - If unused exports become confusing, add a focused comment or remove them in a separate cleanup only after confirming no tests/imports depend on them.

## Phase 4: Full Block Behavior In Row Headers

Goal: row headers should behave like normal blocks for shortcuts and block-type changes.

1. Verify keyboard shortcuts inherited from `EditableBlock`.
   - Bold, italic, strikethrough.
   - Inline code toggle.
   - Link opening.
   - Home/End movement.
   - Option/Ctrl/Meta word or block movement.
   - Multi-selection movement/extension.
   - Undo/redo.

2. Verify block type changes.
   - Slash commands in row headers should be able to set all supported block types.
   - Toolbar block type changes should work when the row header selection is active.
   - If converting a row header to a table creates nested table structure, verify the existing command layer handles it acceptably. If not, decide whether table conversion is a command-layer limitation rather than a row-header rendering limitation.

3. Verify row-header layout across block types.
   - Heading classes should not break table row sizing.
   - List/todo markers should not collide with the row drag button.
   - Code blocks should show code styling and language control only if the row-header layout can contain it cleanly.
   - Image blocks in row headers need a deliberate rendering result; if awkward, document as an existing full-block-support edge case and add a follow-up.

## Phase 5: Tests

Goal: prove behavior stayed stable and cover the newly confirmed semantics.

1. Keep existing row-header regression coverage passing.
   - Slash commands open in row headers.
   - Arrow navigation from cells to row headers and from row headers to cells/other row headers.
   - Typing in a row header replicates.
   - Pasted markdown markers are stripped in row headers.

2. Add Backspace row removal tests.
   - Backspace at offset 0 in an empty row header removes the row when all cells in that row are empty.
   - Backspace at offset 0 in an empty row header does not remove the row when any cell in that row has content, and moves/falls back according to `deleteTableRowHeaderBackward`.
   - Verify both replicas converge after row removal.

3. Add full-behavior regression tests for row headers.
   - A shortcut currently handled by `EditableBlock` but not old `TableRowHeader`, such as strikethrough or code toggle.
   - Home/End or word/block movement if jsdom selection helpers can express it reliably.
   - Block type change through slash command or toolbar, with the row header still queryable as a textbox.

4. Run targeted tests.
   - `npm exec vitest -- run src/App.test.tsx` from `examples/block-rich-text`.
   - If changes touch command helpers directly, also run `npm exec vitest -- run src/blockCommands.test.ts`.
   - Run `npm run build` from `examples/block-rich-text` for type checking.

## Phase 6: Annotation Follow-Up Plan

Goal: capture annotation direction without mixing it into the row-header implementation.

1. Do not fold annotation body selections into the main `EditorSelectionSet` in this change.
   - The selection/focus model needs design first.

2. Extract shared editing behavior only after row headers are unified.
   - Candidate extraction points:
     - key command dispatch
     - link/code popover controller wiring
     - retained inline code mark session behavior
     - paste/copy command wrappers

3. Plan a separate annotation block-controls change.
   - Annotation bodies should support full block controls.
   - Decide how block toolbar state should reflect an active annotation body selection.
   - Decide how nested annotation body focus requests interact with main-editor selection, undo/redo, and retained remote selections.

## Implementation Notes

- Inspect the current `App.tsx` diff before editing; the worktree already has local modifications.
- Keep changes scoped to `examples/block-rich-text` unless command-layer behavior requires touching shared CRDT code.
- Prefer reusing `EditableBlock` behavior over copying handlers into row-header mode.
- Preserve accessibility names and existing test selectors unless there is a deliberate test migration.
