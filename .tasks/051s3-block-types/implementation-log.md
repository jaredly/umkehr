# Implementation Log

## 2026-06-13

- Started phases 1-3 implementation.
- Found core `block-crdt` already has generic metadata types and `initialStateWithMeta`, so the example can carry its own metadata union without core changes.
- Added the example-local `RichBlockMeta` union plus metadata constructors/predicates.
- Switched the demo runtime to `initialStateWithMeta('doc', paragraphMeta('00000'))`.
- Added block metadata commands on top of `setBlockMetaOps`, including multi-selection wrappers.
- Added toolbar block-type controls, todo/code/callout inline controls, code Enter/Tab behavior, and grouped subtree rendering for blockquote/callout.
- Added command/history/undo/UI coverage for rich metadata, metadata undo/redo, code Enter/Tab, and grouped blockquote rendering.
- Issue encountered: tests that used static metadata timestamps newer than replica clock timestamps caused later todo toggles/undo ops to be ignored by LWW as designed. Fixed the tests to use replica-style timestamp ordering.
- Verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src`
  - `npm run typecheck`
  - `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts examples/block-rich-text/src`
  - `npm run build`
- Follow-up issue: `preventDefault()` on native `<select>` controls made the block type menu unusable, and removing it from the inline callout menu exposed editor-level mouse capture/focus interference. Fixed inline code/callout controls by stopping event propagation without preventing default behavior, and added a callout kind dropdown regression test.
- Follow-up issue: code language edits were routed through the normal edit-command path, which restores the text caret after every command and stole focus from the language input after each typed character. Fixed by adding a block-control command path for inline metadata controls that does not schedule text selection restore, and by targeting the specific block instead of the current text selection.
- Follow-up issue: code blocks with trailing newline text did not visibly show the final blank line, and there was no keyboard path to leave a code block. Added a display-only trailing-newline marker, made normal Enter on a trailing blank line remove that trailing newline and create a following paragraph, and kept Shift+Enter as a forced newline inside code.
- Follow-up issue: the first trailing-newline marker was visual-only and did not create a selectable DOM position after the newline; restored carets landed before the line break. Replaced it with a real `<br>` plus zero-width sentinel target, and updated DOM selection mapping to ignore sentinel text for logical offsets while restoring the final offset inside the sentinel.
- Follow-up issue: the `<br>` version over-rendered the trailing code newline as two blank lines because `white-space: pre-wrap` already creates the visual line for the model newline. Removed the `<br>` and kept only the zero-width sentinel after the newline as the selectable final caret target.
- Follow-up issue: undoing the code-block double-Enter exit restored the deleted newline as a fresh replacement char, so the previous newline-insert command then looked like it had no live original char to undo and became blocked. Updated the undo planner to delete a visible replacement char at the same insertion parent when undoing an inserted char whose original id is already tombstoned, and added a regression for undoing exit followed by undoing the newline insert.
