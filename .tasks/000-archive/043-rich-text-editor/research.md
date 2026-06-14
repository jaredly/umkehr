# Rich text editor research

## Summary

`src/react-crdt/react-crdt.tsx` already exposes enough CRDT command surface to build a real editor: `useRichText(...)` returns a `RichTextBinding` with `insert`, `delete`, `mark`, `unmark`, and `replace` commands. Those commands already compile to proper `richText` CRDT updates through `createCrdtUpdates`.

The current `RichTextEditor` is intentionally too simple for this task. It renders `view.spans` into a `contentEditable`, but its `onInput` handler always calls:

```ts
commands.replace(richTextFromPlainText(event.currentTarget.textContent ?? ''));
```

That means normal typing/deleting becomes a full snapshot import instead of peritext `insert`/`remove` operations. It also drops formatting intent and resets React DOM identity with `key={`${view.plainText}:${JSON.stringify(view.spans)}`}`, which is likely to fight browser selection.

The implementation should move rich-text UI concerns out of `src/react-crdt/react-crdt.tsx` into a focused `src/react-rich-text` directory, while leaving `useRichText` and the CRDT binding in `react-crdt`.

## Existing CRDT path

The useful path already exists:

- `src/react-crdt/react-crdt.tsx`
  - `useRichText(node)` materializes rich-text metadata with `materializeRichTextState(meta)`.
  - Returned commands call `node.$text.insert`, `delete`, `mark`, `unmark`, and `replace`.
- `src/helper.ts`
  - `$text.*` creates `op: 'richText'` draft patches.
- `src/crdt/updates.ts`
  - `insert` maps local index to stable `afterId` using `insertionAfterIdForIndexPreservingBoundary`.
  - `delete` maps visible ranges to tombstoned char ids.
  - `mark` and `unmark` map ranges to stable before/after anchors with presets.
  - `replace` imports a snapshot into insert/mark operations.
- `src/crdt/apply.ts` and `src/peritext/apply.ts`
  - Apply the anchored operations into rich-text metadata.
- `src/peritext/materialize.ts`
  - Produces render spans with active `strong`, `em`, `code`, `link`, etc.
- `src/crdt/history.ts`
  - Undo/redo for rich-text inserts, removals, and marks already creates fresh rich-text operations.

So the task is primarily React/editor integration, not inventing the operation format.

## Proposed module split

Create `src/react-rich-text/`:

- `index.ts`
  - Public exports for `RichTextEditor` and any small editor types.
- `RichTextEditor.tsx`
  - Main contenteditable component, keyboard handlers, selection tracking, toolbar composition.
- `selection.ts`
  - DOM selection to plain-text index range helpers.
  - Plain-text index to DOM position helpers for restoring selection after React updates.
- `diff.ts`
  - Converts a browser `beforeinput`/`input` event into a minimal `{delete?, insert?}` command when possible.
- `toolbar.tsx`
  - Floating selection toolbar with bold/italic controls.
- `render.tsx`
  - Span rendering and mark-to-element mapping currently embedded as `RichTextSpanView`.

Then update `src/react-crdt/index.ts` to keep exporting `RichTextEditor` from the new module for compatibility. Either keep a re-export in `src/react-crdt/react-crdt.tsx` or remove the component from that file and export through `src/react-crdt/index.ts`.

Potential package export options:

- Conservative: only re-export from `umkehr/react-crdt` for now.
- More explicit: add `./react-rich-text` to `package.json` exports. This is cleaner if the editor grows independently, but it expands public API surface.

## Editing strategy

Use `beforeinput` as the primary command translation layer, with an `input` fallback.

Recommended handling:

- `insertText` / `insertCompositionText`
  - Get current selection range in plain-text indexes.
  - If selection is non-collapsed, call `commands.delete(start, end)` first.
  - Call `commands.insert(start, event.data)`.
  - Prevent default when the command is handled.
- `deleteContentBackward`
  - If selection is non-collapsed, delete that range.
  - Otherwise delete `[caret - 1, caret]`.
- `deleteContentForward`
  - If selection is non-collapsed, delete that range.
  - Otherwise delete `[caret, caret + 1]`.
- `insertFromPaste`
  - Start with plain text from clipboard and emit delete + insert.
  - Rich HTML paste can be a later enhancement using `richTextFromSpans`.
- Unknown input types
  - Let the browser mutate, then fallback in `onInput` by diffing previous `view.plainText` with current `textContent`.
  - Avoid full `replace` except as a last resort or explicit reset/import operation.

The fallback diff can be simple longest-common-prefix/longest-common-suffix. It is enough to translate a single contiguous edit into one delete and/or one insert:

```ts
before: "hello"
after:  "heXlo"
delete range: [2, 3]
insert at: 2, text: "X"
```

This keeps ordinary typing/deleting on the true peritext path.

## Formatting UX

Keyboard shortcuts:

- `Cmd/Ctrl+B`
  - If selection is non-empty, toggle `strong` over the selection.
  - Prevent default.
- `Cmd/Ctrl+I`
  - If selection is non-empty, toggle `em` over the selection.
  - Prevent default.

Toolbar:

- Show only while the editor has a non-collapsed selection inside its root.
- Position near `Selection.getRangeAt(0).getBoundingClientRect()`.
- Include buttons for bold and italic first. Code/link can come later because this task only calls out cmd-b/cmd-i and toolbar formatting.
- Toolbar actions should prevent focus loss (`onMouseDown.preventDefault()`), apply the command, and keep/restore selection.

Toggle behavior needs a decision. The current CRDT binding offers separate `mark` and `unmark`, but the render view only exposes spans and does not provide an explicit "marks active for entire selected range" helper. A reasonable first pass:

- If every selected character has the mark, `unmark`.
- Otherwise `mark`.

This requires a helper that computes mark coverage across `RichTextRenderView.spans` by walking span lengths. It can live in `selection.ts` or a small `marks.ts` inside `src/react-rich-text`.

Use mark names already rendered by `RichTextSpanView`:

- Bold: `strong: true`
- Italic: `em: true`

## Selection handling

The hard part is preserving DOM selection across React rerenders.

Recommended approach:

1. Render spans as plain nested inline elements with text nodes, no extra invisible characters.
2. Before dispatching a command, capture selection as plain-text offsets relative to the editor root.
3. Predict the next caret/selection offsets after the local operation.
4. After React commits the new view, restore selection from offsets using a layout effect.

Useful helpers:

- `selectionRangeIn(root: HTMLElement): {start: number; end: number} | null`
- `domPointForTextOffset(root: HTMLElement, offset: number): {node: Text; offset: number}`
- `restoreSelection(root: HTMLElement, range: {start: number; end: number}): void`
- `selectionInside(root: HTMLElement): boolean`

Because `view.spans` may split the same logical text into several DOM nodes, offsets should be based on a `TreeWalker` over text nodes rather than element child indexes.

## Current testing surface

Existing tests worth extending:

- `src/react-crdt/react-crdt.test.tsx`
  - Currently verifies the old contenteditable helper publishes rich-text updates, but the test only checks that replacing `"hello"` publishes five rich-text updates.
  - This should move or be expanded for the new editor.
- `src/crdt/richtext.test.ts`
  - Already proves insert/delete/mark/update envelopes and undo/redo work at the CRDT layer.
- `src/peritext/*.test.ts`
  - Covers sequence, boundaries, marks, import/export, validation.

Recommended tests:

- Typing text into `RichTextEditor` emits `insert` operations, not `replace` snapshot-derived reset behavior.
- Backspace and forward delete emit `remove` operations for correct visible ranges.
- Replacing a selected range emits delete + insert.
- `Cmd+B` over selected text emits `addMark` with `markType: 'strong'`.
- Pressing `Cmd+B` again over an entirely bold selection emits `removeMark`.
- `Cmd+I` maps to `em`.
- Selection toolbar appears for non-collapsed in-editor selection and disappears for collapsed or outside selection.
- Toolbar bold/italic buttons apply marks without losing the selected range before the command.
- Existing inline mark rendering still renders `strong` and `em` elements.

JSDOM can cover command emission and basic selection APIs, but floating toolbar geometry may need tolerant tests because `getBoundingClientRect()` is usually zeroed in JSDOM.

## Performance note

The editor will make `insert` and `delete` hot paths. `.tasks/042-peritext-notes/task.md` already calls out several peritext performance issues:

- `applyInsert` currently clones/sorts more than it should.
- range helpers repeatedly materialize `visibleChars`.
- `maxOpCounter` should probably be cached.
- sequential inserts need an optimized path.

This editor can still be built first, but once it sends per-character insert operations for normal typing, those peritext hot paths will become visible. The editor should avoid making the situation worse by emitting full `replace` operations for ordinary edits.

## Open questions

- Should `src/react-rich-text` be a public package export (`umkehr/react-rich-text`) or only an internal module re-exported by `umkehr/react-crdt`?
  - separate public package export
- Should the old `RichTextEditor` export remain source-compatible from `umkehr/react-crdt`, or is this allowed to be a breaking move?
  - let's move it
- What exact toggle semantics do we want for mixed selections: unmark only when all selected text has the mark, or split/toggle each subrange independently?
  - unmark only when all has the mark
- Should collapsed-selection formatting be supported now? That would require stored pending mark state for future inserts; the current task only asks for selected-text formatting.
  - not yet
- Should paste preserve HTML marks, or should v1 paste plain text only?
  - preserve compatible html marks
- How should IME/composition be handled? `beforeinput` can handle many cases, but composition may need special deferral to avoid corrupting multi-step input.
  - best effort
- Does the toolbar belong in library CSS/classes, inline styles, or unstyled render props so consuming apps can own presentation?
  - inline styles for now
- Should the editor expose `code` and `link` controls immediately to exercise more of peritext, or keep this task scoped to `strong`/`em` plus text mutation?
  - yeah let's do code and link too
