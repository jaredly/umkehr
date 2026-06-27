# Plan: Retained Inline Format For Collapsed Carets

## Scope

Update `examples/block-rich-text` so collapsed-caret inline mark toggles work like a normal rich text editor:

- `Cmd+B` / `Ctrl+B`, `Cmd+I` / `Ctrl+I`, and strikethrough controls can enter a transient pending typing style at a collapsed caret.
- Pending style remains active while typing consecutive characters until toggled off or the selection changes.
- Selecting a range clears pending state and keeps the existing range-toggle behavior.
- Toolbar buttons should show active pressed state from both pending typing style and the marks at the current caret/selection.

Do not persist pending marks in CRDT document state, history export, replica selection state, or undo history.

## Phase 1: Add Command Support For Marked Inserts

Files:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`

Tasks:

1. Add a command helper that inserts text and immediately applies one or more boolean inline marks over exactly the inserted text.
   - Suggested API: `insertTextWithMarks(state, selection, text, markTypes, context): CommandResult`.
   - It should use the existing deletion/replacement behavior from `insertText`.
   - It should only apply marks when there is inserted text and at least one mark type.
   - For a collapsed selection, mark from the insertion start point to the returned caret.
   - For a range selection, the UI plan clears pending marks before insertion, so this helper does not need special replacement semantics beyond not mis-marking unrelated text.
2. Add a multi-selection wrapper if it keeps call sites clean.
   - Suggested API: `insertTextWithMarksEverywhere(...)`.
   - Scope it to entries that are collapsed and need pending marks; otherwise continue using `insertTextEverywhere`.
3. Keep existing `toggleMark` / `toggleMarkEverywhere` behavior for non-collapsed ranges.

Implementation note:

- `markRangeOp` uses visible offsets, so apply insert ops first, then mark the inserted visible range in the resulting state.
- Use `segmentText(text).length` or equivalent grapheme-aware length when computing inserted text length.

## Phase 2: Add Pending Inline Mark UI State

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/inlineMarks.ts`

Tasks:

1. Represent pending marks in `BlockEditor` local state.
   - Suggested type: `Partial<Record<BooleanInlineMark, boolean>>`.
   - Wire all boolean marks: `bold`, `italic`, and `strikethrough`.
2. Add a helper in `BlockEditor` to toggle a mark command.
   - If the current primary selection is collapsed, toggle the pending mark instead of creating document ops.
   - If the current primary selection is a range, clear pending marks and run the existing range command.
   - Preserve current multi-selection behavior: selected ranges are formatted; carets do not create document ops.
3. Clear pending marks whenever the user moves or changes selection.
   - Clear on mouse selection changes, key navigation selection changes, focus leaving the editor, and reset/history replay UI reset.
   - Do not clear after ordinary text insertion while pending marks are active.
4. On text insertion, if the active primary selection is collapsed and pending marks are active, call the marked-insert command.
   - Otherwise call the existing `insertTextEverywhere`.
   - Pasting can use the same path if the insertion is collapsed and pending marks are active; if this complicates the implementation, start with `beforeinput` typed text and document paste as out of scope.

## Phase 3: Toolbar Active State

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`

Tasks:

1. Compute active inline marks for the toolbar.
   - Pending mark state should make its toolbar button active.
   - At a collapsed caret, inspect the formatted runs around the caret to infer current marks.
   - For a range selection, use the existing selected-range mark information or add a small helper to determine whether the selected range is fully marked.
2. Pass active states into `Toolbar`.
   - Suggested prop: `activeMarks: Partial<Record<BooleanInlineMark, boolean>>`.
3. Render buttons with `aria-pressed`.
   - Bold, Italic, and Strikethrough should all expose pressed state.
   - Add or reuse CSS so pressed buttons are visually distinct.

Implementation note:

- Do not make toolbar active state part of history or replica state.
- Keep active-mark detection local to the app layer unless a reusable helper naturally belongs in `inlineMarks.ts`.

## Phase 4: Keyboard And Surface Wiring

Files:

- `examples/block-rich-text/src/App.tsx`

Tasks:

1. Replace direct shortcut calls to `toggleMarkEverywhere` for `bold` and `italic` with the new pending-aware helper.
2. Add pending-aware handling for strikethrough wherever the app currently exposes it.
   - Toolbar already has a strikethrough button.
   - If there is an existing keyboard shortcut for strikethrough, route it through the same helper. If not, do not invent a new shortcut unless the surrounding code already establishes one.
3. Thread pending-aware insertion through normal block text, table row headers, table cells, code blocks, and annotation body editors as appropriate.
   - Main document blocks are required.
   - Annotation body editors have a separate command path; include them only if the shared wiring stays simple.

## Phase 5: Tests

Files:

- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `examples/block-rich-text/src/App.test.tsx`

Add focused coverage:

1. Command-level marked insert:
   - Insert at collapsed caret with `bold`; formatted output marks only inserted text.
   - Multiple mark types can apply to the same inserted text.
   - Existing unmarked insert behavior is unchanged.
2. UI typing:
   - Type `a`, press `Cmd+B`, type `bc`; `bc` is bold and `a` is not.
   - Press `Cmd+B` again before typing; subsequent text is not bold.
   - `Ctrl+B` follows the same path.
   - `Cmd+I` and toolbar strikethrough have the same pending behavior.
3. Selection clearing:
   - Move the caret after enabling pending bold, then type; new text is not bold.
   - Select a range after enabling pending bold; pending state clears and range toggle behavior remains normal.
4. Toolbar:
   - Button `aria-pressed` reflects pending state at a collapsed caret.
   - Button `aria-pressed` reflects actual marks at the caret/selection.

Run the relevant tests:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/App.test.tsx
```

## Risks And Checks

- Selection reads are DOM-dependent. Prefer using existing `liveSelectionSet`, `readSelectionFromDom`, and test helpers instead of adding a parallel selection model.
- Marking inserted text must be grapheme-aware; avoid plain `text.length`.
- Toolbar active state can drift if it only uses pending state. It must also read actual formatted marks from rendered document state.
- History replay should not serialize or restore pending marks. Reset/replay should clear local pending state.
