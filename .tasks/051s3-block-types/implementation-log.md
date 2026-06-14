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
