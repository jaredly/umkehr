# Rich text editor implementation plan

Goal: move the current `RichTextEditor` out of `src/react-crdt/react-crdt.tsx` into a dedicated `src/react-rich-text` package surface, and make ordinary editor actions exercise the real peritext CRDT operations instead of replacing the whole document snapshot.

Resolved scope from research:

- Add a separate public package export: `umkehr/react-rich-text`.
- Move the old `RichTextEditor`; compatibility through `umkehr/react-crdt` is optional, not required as the primary API.
- Toggle formatting by unmarking only when the entire selected range already has that mark.
- Do not support collapsed-selection pending formatting yet.
- Paste should preserve compatible HTML marks where practical.
- IME/composition support is best effort.
- Use inline styles for the built-in toolbar.
- Include `strong`, `em`, `code`, and `link` controls.

## Phase 1: Module Extraction And Public API

Create the new module and move rendering code out of `src/react-crdt/react-crdt.tsx`.

Files:

- `src/react-rich-text/index.ts`
- `src/react-rich-text/RichTextEditor.tsx`
- `src/react-rich-text/render.tsx`
- `src/react-crdt/react-crdt.tsx`
- `src/react-crdt/index.ts`
- `package.json`
- `src/package-smoke.test.ts`

Implement:

- Move `RichTextEditor` and `RichTextSpanView` into `src/react-rich-text`.
- Export `RichTextEditor` from `src/react-rich-text/index.ts`.
- Add `./react-rich-text` to `package.json` exports.
- Keep `RichTextBinding` defined in `src/react-crdt/react-crdt.tsx` for now, because it is produced by `useRichText`.
- Import/re-export `RichTextEditor` from `src/react-crdt/index.ts` if that keeps existing tests or examples simple, but treat `umkehr/react-rich-text` as the new canonical editor import.
- Remove the editor implementation from `src/react-crdt/react-crdt.tsx`; it should not own DOM editing behavior.

Acceptance:

- `import {RichTextEditor} from 'umkehr/react-rich-text'` works after build.
- Existing `useRichText(...)` API remains intact.
- Package smoke test covers the new export.

## Phase 2: Selection And Mark Helpers

Add DOM selection helpers and render-view mark coverage helpers before changing input behavior.

Files:

- `src/react-rich-text/selection.ts`
- `src/react-rich-text/marks.ts`
- `src/react-rich-text/selection.test.ts`
- `src/react-rich-text/marks.test.ts`

Implement:

- `selectionRangeIn(root: HTMLElement): {start: number; end: number} | null`.
- `selectionInside(root: HTMLElement): boolean`.
- `domPointForTextOffset(root: HTMLElement, offset: number)`.
- `restoreSelection(root: HTMLElement, range: {start: number; end: number})`.
- Use a `TreeWalker` over text nodes so offsets work across split spans and nested `<strong>`, `<em>`, `<code>`, and `<a>`.
- `rangeHasMark(view, range, markType)` returning true only if every selected character has that mark.
- `linkValueForRange(view, range)` or equivalent helper for detecting existing link values in the selected range.

Acceptance:

- Selection offsets are correct across plain text, mixed spans, and nested mark elements.
- Restoring a captured range selects the same text after rerender.
- Mixed selections only count as active for a mark when all selected characters have it.

## Phase 3: Real Text Mutation Commands

Replace the current full-snapshot `onInput` behavior with command translation for ordinary typing and deletion.

Files:

- `src/react-rich-text/diff.ts`
- `src/react-rich-text/RichTextEditor.tsx`
- `src/react-rich-text/RichTextEditor.test.tsx`

Implement:

- Handle `beforeinput` for:
  - `insertText`
  - `insertCompositionText`
  - `deleteContentBackward`
  - `deleteContentForward`
  - `insertFromPaste`
- For insert over a non-collapsed selection, emit `delete(start, end)` then `insert(start, text)`.
- For backspace/delete at a collapsed caret, emit one-character `delete` when in range.
- Prevent default only when the operation was translated and dispatched.
- Track a pending selection restore target after local commands.
- Add an `onInput` fallback that computes a single-contiguous-edit diff between previous `view.plainText` and current `textContent`.
- Keep `commands.replace(...)` only as a last-resort fallback or explicit reset/import path, not for ordinary typing.

Paste behavior:

- Prefer clipboard HTML when available.
- Convert compatible inline HTML to a `RichTextImportSnapshot`:
  - `<strong>` / `<b>` -> `strong: true`
  - `<em>` / `<i>` -> `em: true`
  - `<code>` -> `code: true`
  - `<a href>` -> `link: href`
- For unsupported elements, preserve their text content and compatible marks inherited from ancestors.
- For plain-text paste, emit delete + insert.
- If rich HTML paste is inserted into a non-empty document, either emit `delete` + per-span inserts/marks when feasible, or use `replace` only if preserving marks cannot be done incrementally. Prefer incremental commands for the selected insertion region.

Acceptance:

- Typing `"hello"` publishes five `richText` insert updates, not a whole-document replacement path.
- Backspace/forward delete publish `remove` operations for the intended visible char ids.
- Replacing selected text emits delete + insert.
- Plain paste emits insert operations.
- Compatible HTML paste preserves `strong`, `em`, `code`, and `link` marks in the resulting materialized view.

## Phase 4: Keyboard Formatting

Add keyboard shortcuts that use peritext mark operations.

Files:

- `src/react-rich-text/RichTextEditor.tsx`
- `src/react-rich-text/marks.ts`
- `src/react-rich-text/RichTextEditor.test.tsx`

Implement:

- `Cmd/Ctrl+B` toggles `strong`.
- `Cmd/Ctrl+I` toggles `em`.
- Add shortcut for `code`; use a conservative browser-friendly combination such as `Cmd/Ctrl+Shift+7` only if it does not conflict with tests or local conventions. Otherwise expose code through the toolbar only.
- Do not apply marks for collapsed selections in this phase.
- Toggle rule:
  - if every selected character has the mark, call `commands.unmark(start, end, markType)`;
  - otherwise call `commands.mark(start, end, markType, true)`.
- Restore the selected range after dispatch so the toolbar remains useful.

Acceptance:

- `Cmd+B` over selected text emits `addMark` with `markType: 'strong'`.
- `Cmd+B` again over an entirely bold selection emits `removeMark`.
- `Cmd+I` maps to `em`.
- Collapsed selections do not create pending mark state.

## Phase 5: Floating Toolbar

Build the selection toolbar with inline styles and controls for bold, italic, code, and link.

Files:

- `src/react-rich-text/toolbar.tsx`
- `src/react-rich-text/RichTextEditor.tsx`
- `src/react-rich-text/RichTextEditor.test.tsx`

Implement:

- Show the toolbar only when focus/selection is inside the editor and the selection is non-collapsed.
- Position near `Selection.getRangeAt(0).getBoundingClientRect()`.
- Use inline styles; no new CSS file required.
- Buttons:
  - Bold -> `strong`
  - Italic -> `em`
  - Code -> `code`
  - Link -> prompt or small inline URL input
- Toolbar `onMouseDown` should prevent focus loss.
- Buttons should indicate active state based on the "all selected text has this mark" rule.
- Link behavior:
  - If every selected character has a link mark, allow unlink.
  - Otherwise ask for a URL and apply `link: url`.
  - Keep URL validation modest: trim, ignore empty strings, do not invent normalization beyond what is needed for tests.

Acceptance:

- Toolbar appears for selected editor text and disappears for collapsed/outside selection.
- Toolbar bold/italic/code emit mark/unmark operations.
- Toolbar link can apply and remove a link mark.
- Selection is not lost before toolbar commands run.

## Phase 6: Selection Preservation And Rerender Behavior

Remove behavior that fights browser selection and make rerenders stable.

Files:

- `src/react-rich-text/RichTextEditor.tsx`
- `src/react-rich-text/render.tsx`
- `src/react-rich-text/selection.ts`

Implement:

- Remove the current editor-level `key` derived from `view.plainText` and spans.
- Use stable span rendering keys where possible. Index keys are acceptable for a first pass if selection restoration is offset-based, but avoid forcing the whole contenteditable subtree to remount.
- Use `useLayoutEffect` to restore pending selections after local view updates.
- Avoid restoring selection after remote updates unless the pending restore came from a local editor command.
- Ensure empty editor state still has a valid caret target. This may require a placeholder text node or a minimal child; keep it invisible and avoid polluting copied/editor text.

Acceptance:

- Typing does not reverse characters or jump the caret to the beginning.
- Formatting a selection keeps the selection or caret in an expected position.
- Remote/materialized updates still render correctly.

## Phase 7: Integration Tests And Cleanup

Update tests and examples to use the new module surface.

Files:

- `src/react-crdt/react-crdt.test.tsx`
- `src/react-rich-text/*.test.tsx`
- `src/package-smoke.test.ts`
- Any examples importing `RichTextEditor`

Implement:

- Move editor-specific tests out of `src/react-crdt/react-crdt.test.tsx` where practical.
- Keep one `react-crdt` integration test proving `useRichText` can feed the editor.
- Add package smoke coverage for `umkehr/react-rich-text`.
- Update imports to the new package export.
- Run formatting/typecheck/build/test.

Acceptance:

- `npm run typecheck` passes.
- Targeted tests for `src/react-rich-text` and `src/react-crdt` pass.
- `npm run build` passes.
- `npm run test` passes if runtime is reasonable.

## Follow-Up Work

These are intentionally outside this task unless they block implementation:

- Optimize `src/peritext` hot paths called out in `.tasks/042-peritext-notes/task.md`.
- Add collapsed-selection pending marks.
- Add richer HTML import/export beyond compatible inline marks.
- Replace `prompt`-style link entry with a richer toolbar popover if the editor becomes product UI instead of a test/exercise surface.
- Add Playwright coverage if the editor lands in an example app with realistic browser selection behavior.
