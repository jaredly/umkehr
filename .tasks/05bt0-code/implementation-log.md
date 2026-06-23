# Implementation Log: Inline Code Mark

## 2026-06-22 20:25 CDT

Started implementation from `plan.md`.

### Phase 1: Shared Inline Code Model

- Added `CODE_MARK` and code mark helper APIs in `inlineMarks.ts`.
- Reused `normalizeCodeLanguage` from `syntaxHighlight.ts` so inline code language aliases match existing code block behavior.
- Added range helpers for contiguous inline code marks, including bare code and normalized language comparison.
- Added unit coverage for bare code ranges, language ranges, alias normalization, unknown languages, and selected-range language consistency.

Issues/workarounds:

- Bare code has an empty language string, while a missing code mark also has no language. Range extension must check `isCodeMarkValue` before merging, otherwise adjacent unmarked text could be mistaken for bare code.

Validation:

- `npm exec vitest -- --run examples/block-rich-text/src/inlineMarks.test.ts` passed.

### Phase 2: Commands and Collapsed Typing

- Added main-editor code mark commands for toggling bare code, setting language, clearing language, and removing code.
- Added multi-selection wrappers for code marks and generalized the link range-command runner into a reusable range mark command runner.
- Widened retained inline mark sessions from `BooleanInlineMark` to bare inline marks so collapsed cursor typing can create retained bare `code` marks.
- Added a Code toolbar button and `runCodeToggle` path.
- Updated active inline mark derivation so selected/pending code marks affect toolbar pressed state.

Issues/workarounds:

- Language-specific code is intentionally not part of pending collapsed typing. Collapsed typing starts as bare code; language assignment remains range/popover-based.

Validation:

- `npm exec vitest -- --run examples/block-rich-text/src/inlineMarks.test.ts` passed.
- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.

### Phase 3: Rendering and Inline Syntax Highlighting

- Added `.markCode` rendering to static and editable run render paths.
- Added `data-code-*` span attributes for hover/edit targeting.
- Added range-scoped inline syntax highlighting for language-specific code marks.
- Inline syntax ranges are appended after block-level syntax ranges so language-specific inline code can override block-level classes within that marked range.
- Added inline code CSS.

Issues/workarounds:

- Avoided `Array.prototype.findLast` in syntax range lookup to keep compatibility with the existing TypeScript target.

Validation:

- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.

### Phase 6: Markdown Backtick Shortcuts

- Added typed inline backtick shortcut support to `insertTextWithMarkdownShortcuts`.
- Typing a closing backtick now converts `` `text` `` to `text` with a bare `code` mark, deletes both delimiters, and restores the caret after the marked text.
- Annotation body typing uses the same shortcut path only for typed backticks, preserving body-specific insertion behavior for normal text.

Issues/workarounds:

- Pasted inline backtick conversion was not added. Existing paste markdown support is line/prefix-oriented, and safely deleting multiple inline delimiters after paste would need a separate offset-planning pass. Typed shortcuts are implemented now; paste conversion can be a follow-up if required.

Validation:

- `npm exec vitest -- --run examples/block-rich-text/src/blockCommands.test.ts` passed.
- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.

### Phase 5: Annotation Body Editing Parity

- Added annotation-body commands for toggling code, setting code language, clearing code language, and removing code.
- Added annotation-body code hover/edit popovers by reusing the main code popover components.
- Added local annotation-body pending/retained bare-code typing state.
- Added Cmd/Ctrl+E as a code shortcut in annotation bodies and the main editor.
- Routed toolbar Code clicks to annotation body range selections when an annotation body selection is active.

Issues/workarounds:

- Annotation bodies do not use the main editor's retained inline mark session map. A local retained session list was added inside `AnnotationBodyBlock` for collapsed body code typing.
- Toolbar Code can toggle annotation body range selections, but collapsed annotation-body pending code is handled by the body-local Cmd/Ctrl+E shortcut because the toolbar cannot directly own that local pending state.

Validation:

- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.

### Phase 4: Main Editor Hover and Language Popover

- Added main-editor code hover state, floating edit popover, and hover action popover.
- Reused the link popover shell styling and positioning helpers.
- Added Apply, Clear language, and Remove code actions.
- Added code hover/click detection in `RichTextEditableSurface`.
- Replaced the link-specific retained range conversion helper with a generic range helper shared by link and code edits.

Issues/workarounds:

- The click-away cleanup had existing link-specific logic. Code popover cleanup was added in the same places to avoid stale hover timers/popovers.

Validation:

- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.

### Phase 7: Verification and Fixes

- Added UI coverage for range code toggling, collapsed pending code typing, hover language editing, syntax highlighting, and clearing language.
- Fixed a stale render-cache bug: `serializeRuns` did not include `run.marks.code`, so the editor could keep rendering a bare code span after the command state had changed to a language-specific code mark.
- Adjusted the code language popover to pass its target ranges through Apply/Clear/Remove callbacks instead of rereading range state at action time.
- Matched the code language popover input behavior to the existing link popover pattern.

Issues/workarounds:

- The hover language command produced the correct state immediately, but the UI test exposed stale DOM because code marks were missing from the render serialization key.
- Pasted inline backtick conversion remains intentionally out of scope for this pass; typed backtick conversion is covered.

Validation:

- `npm exec vitest -- --run examples/block-rich-text/src/App.test.tsx -t "edits inline code language"` passed.
- `npm exec vitest -- --run examples/block-rich-text/src/inlineMarks.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/syntaxHighlight.test.ts` passed.
- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.
- `npm exec vitest -- --run examples/block-rich-text/src/App.test.tsx` passed.
- `npm exec vitest -- --run examples/block-rich-text/src` passed: 12 files, 369 passed, 1 skipped.
