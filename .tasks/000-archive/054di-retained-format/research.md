# Research: Retained Inline Format For Collapsed Carets

## Task

In `examples/block-rich-text`, when the selection is collapsed, `Cmd+B` / `Ctrl+B` should make the next character typed at that caret bold. This can be transient editor UI state; moving the cursor elsewhere and back does not need to preserve the pending bold status.

## Current State

The example already supports inline marks for selected ranges:

- `examples/block-rich-text/src/blockCommands.ts`
  - `toggleMark(state, selection, markType, context)` normalizes selected range segments and creates `markRangeOp` entries.
  - If the selection is collapsed, `normalizeSelectionSegments` returns no segments, so `toggleMark` returns no ops.
- `examples/block-rich-text/src/multiSelectionCommands.ts`
  - `toggleMarkEverywhere` dedupes/merges selections and explicitly filters out collapsed selections with `!isCollapsed(resolved)`.
  - This is why keyboard shortcuts and toolbar buttons currently do nothing at a caret.
- `examples/block-rich-text/src/App.tsx`
  - Main toolbar `onBold` calls `runEditCommand(... toggleMarkEverywhere(..., 'bold', ...))`.
  - Editable block `Cmd+B` / `Ctrl+B` handlers do the same.
  - Typed text is intercepted in `RichTextEditableSurface` via `beforeinput`; `onInsertText` ultimately calls `insertTextEverywhere`.
  - `runEditCommand` reads the live DOM selection, runs the command, and schedules DOM selection restore.

The CRDT layer already has all primitives needed to mark newly inserted text:

- `insertTextOps` inserts characters and returns char ops in order.
- `markRangeOp` can mark a visible offset range after those characters have been inserted.
- The current command code commonly applies ops incrementally with `applyMany(...)`.

Existing tests cover range formatting in `examples/block-rich-text/src/blockCommands.test.ts` and UI typing/shortcut flows in `examples/block-rich-text/src/App.test.tsx`.

## Implementation Direction

Keep the pending mark state out of the replicated document and out of history. Add a local transient state inside `BlockEditor`, likely:

```ts
type PendingInlineMarks = Partial<Record<BooleanInlineMark, boolean>>;
```

For this task, only `bold` needs to be wired. The state should be cleared when the active selection changes or when focus leaves the editor, since the requirement says it does not need to be retained after moving away.

Suggested behavior:

1. When `Cmd+B` / `Ctrl+B` runs against a non-collapsed primary selection, keep the existing behavior: apply/remove bold over the selected range.
2. When it runs against a collapsed primary selection and no other selected range should be modified, prevent default and toggle `pendingInlineMarks.bold`.
3. On typed text insertion, if `pendingInlineMarks.bold` is true and the active insertion selection is collapsed, insert the text and add a bold mark over exactly the newly inserted text.
4. Leave `pendingInlineMarks.bold` active after insertion so consecutive typed characters stay bold until the user toggles bold off or moves the selection.

The least invasive command-level addition is probably a helper in `blockCommands.ts`:

- `insertTextWithMarks(state, selection, text, markTypes, context): CommandResult`
- It can call the existing `insertText(...)`, then, if the original resolved selection was collapsed and inserted text length is nonzero, mark the range from the original insertion point to the returned caret.
- For range replacement, the open question is whether pending bold should apply to replacement text. If yes, after `insertText` deletes the selected range and returns the final caret, the helper should mark the inserted text by tracking the post-delete insertion point.

For multi-selection, this can be wrapped similarly to `insertTextEverywhere`, but the initial requirement only needs the active caret. A scoped implementation can have `BlockEditor` apply the pending mark only when the primary resolved selection is collapsed, and call the normal `insertTextEverywhere` otherwise.

## UI Notes

Toolbar state currently has no active/pressed styling for bold/italic/strikethrough. It may be worth exposing pending bold with `aria-pressed={pendingInlineMarks.bold}` on the Bold button, but this task does not require a full "current marks at caret" toolbar model.

If the button is used at a collapsed caret, it should follow the same pending state path as the keyboard shortcut. Existing `onMouseDown(event.preventDefault())` is useful because it preserves focus/selection while clicking toolbar controls.

## Test Plan

Add command or UI tests for:

- Collapsed caret: type `a`, press `Cmd+B`, type `b`; rendered runs should be `a` unbold and `b` bold.
- Press `Cmd+B` again before typing; next typed character should not be bold.
- Pending bold continues across multiple inserted characters typed sequentially.
- Moving the caret clears pending bold; typing at the new selection is not bold.
- Non-collapsed range `Cmd+B` still toggles the selected text and does not set pending bold.
- Existing range/multi-selection mark tests should continue to pass.

The app-level tests can use existing helpers in `App.test.tsx`, especially `selectCaret`, `beforeInputText` / `typeText`, `fireEvent.keyDown`, and DOM queries for `.markBold`.

## Open Questions

- Should pending bold apply only to the next character, or should it remain active for subsequent typed characters until toggled off? The wording says "the next character you type is bolded"; editor convention usually means an active typing style that remains on. I would implement the conventional behavior unless the desired behavior is literally one character only.
    - yes do conventional
- Should pending bold apply when replacing a selected range after a pending mark was set earlier? Since moving/changing the selection can clear pending state, this may be irrelevant, but it affects paste/selection replacement edge cases.
    - if you've selected a range, the pending state should be cleared
- Should `Ctrl+B` be treated the same as `Cmd+B` on macOS? Current code already treats `metaKey || ctrlKey` as the modifier, so preserving both is consistent.
    - yes
- Should italic and strikethrough get the same pending-caret behavior while touching the plumbing? The requested scope is bold only, but the abstraction will naturally support all `BooleanInlineMark` values.
    - yes
- Should toolbar buttons show active state based on the current caret's surrounding marks, or only based on the transient pending state? Full active-mark detection is larger than the task.
    - both please
