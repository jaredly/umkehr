# Plan: Inline Code Mark

## Decisions From Research

- Inline code is a mark type named `code`.
- Code marks are non-stacking. Do not add `code` to `markBehavior` as `stacking`; rely on default last-writer-wins mark resolution.
- Code marks may be bare or language-specific:
  - bare code: `data: undefined`, materialized as `marks.code === true`
  - language code: `data: string`, materialized as `marks.code === '<language>'`
  - remove code: `remove: true`
- Language UI is a free-text input.
- Normalize known language aliases before writing (`ts` -> `typescript`, `js` -> `javascript`, etc.), but allow unknown language strings to be stored.
- Clearing language writes a bare code mark and keeps inline code styling.
- Collapsed cursor code typing should be supported.
- Inline code should be allowed inside code blocks.
- Code marks should be editable inside annotation bodies.
- Markdown shortcuts should support inline backtick code.

## Phase 1: Shared Inline Code Model

Files:

- `examples/block-rich-text/src/inlineMarks.ts`
- `examples/block-rich-text/src/inlineMarks.test.ts`
- `examples/block-rich-text/src/syntaxHighlight.ts`

Tasks:

1. Add `CODE_MARK = 'code'`.
2. Add helpers for code mark values:
   - `isCodeMarkValue(value): value is true | string`
   - `codeLanguageFromMarkValue(value): string`
   - `normalizeStoredCodeLanguage(input): string | undefined`
3. Add range helpers parallel to links:
   - `codeRangeAroundOffset(...)`
   - `codeRangeAroundOffsetInRuns(...)`
   - `codeLanguageForSelectionSegments(...)`
4. Code range equality should compare normalized language values so adjacent `ts` and `typescript` ranges can merge if old data exists. New writes should store normalized values where known.
5. Unit test:
   - bare code ranges
   - language code ranges
   - adjacent same-language runs split by bold/italic
   - adjacent different-language runs
   - unknown languages
   - alias normalization

Notes:

- Keep `BooleanInlineMark` separate from code. Code needs valued mark behavior and hover language editing.

## Phase 2: Commands and Collapsed Typing

Files:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/App.tsx`
- command tests as appropriate, likely `blockCommands.test.ts` and/or `multiSelectionCommands.test.ts`

Tasks:

1. Add main-editor commands:
   - `setCodeMark(state, selection, language, context)`
   - `clearCodeLanguage(state, selection, context)`
   - `removeCodeMark(state, selection, context)`
2. Generalize `setValuedMark` or add a small code-specific helper so a non-remove op can be written with `data: undefined`.
3. Add multi-selection wrappers:
   - `setCodeMarkEverywhere`
   - `clearCodeLanguageEverywhere`
   - `removeCodeMarkEverywhere`
4. Generalize retained inline mark sessions enough to support bare code from a collapsed cursor.
   - Current retained sessions are typed as `BooleanInlineMark`.
   - Introduce a broader retained mark type for marks that can be open-ended with no data, such as `bold`, `italic`, `strikethrough`, and bare `code`.
   - Keep language-specific code editing range-based; collapsed typing starts as bare code.
5. Add `runCodeToggle` in `App.tsx`.
   - Collapsed selection: toggle pending bare code on/off, using retained mark sessions like bold.
   - Range selection fully covered by code: remove code.
   - Range selection not fully covered by code: apply bare code.
6. Update pending active mark derivation so the toolbar reflects pending/selected code state.
7. Tests:
   - range apply/remove bare code
   - collapsed toggle then type creates code mark over typed text
   - toggling pending code off closes the retained open mark
   - code can coexist with bold/italic/strikethrough/link
   - overlapping code language writes are non-stacking and LWW per character

## Phase 3: Rendering and Inline Syntax Highlighting

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- possibly a focused helper/test file if rendering range logic is extracted

Tasks:

1. Add `.markCode` rendering in both paths:
   - `applyRunClasses`
   - `renderStaticRuns`
2. Add data attributes to editable spans:
   - `data-code-language`
   - `data-code-start-offset`
   - `data-code-end-offset`
3. Add inline code CSS:
   - monospace font
   - subtle background and border
   - small horizontal padding
   - readable combinations with link, strikethrough, retained selection, and syntax token classes
4. Add range-scoped syntax highlighting.
   - Keep existing block-level code highlighting.
   - Add inline syntax ranges for contiguous code mark ranges with a string language.
   - Highlight only the code range's own text, then map token offsets back to block offsets.
   - Bare code and unsupported/plain languages should render `.markCode` without syntax token classes.
5. Decide conflict behavior when a code block also contains language-specific inline code.
   - Requirement says allow inline code inside code blocks.
   - Preferred implementation: inline language-specific code may override the block-level syntax classes for that marked range; bare code inside a code block keeps block-level syntax classes plus `.markCode`.
6. Tests:
   - inline JavaScript gets syntax classes only inside the code mark
   - surrounding prose is not highlighted
   - bare code has `.markCode` and no inline syntax classes
   - code block highlighting still works
   - inline code inside a code block is allowed and renders predictably

## Phase 4: Main Editor Hover and Language Popover

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`

Tasks:

1. Add `CodePopoverState`:
   - `ranges`
   - `language`
   - `top`
   - `left`
2. Add code hover state and hide timer, parallel to link hover state.
3. Add trigger helpers:
   - `codeTriggerFromEvent`
   - `codeRangeFromTrigger`
4. Extend `RichTextEditableSurface` mouse handling:
   - detect code hover enter/leave
   - keep existing link and annotation hover behavior intact
5. Add popovers:
   - hover popover showing language or a no-language state, with an Edit button
   - floating edit popover with free-text language input
   - actions: Apply, Clear language, Remove code
6. Main editor apply behavior:
   - Apply: normalize known aliases, store normalized language or unknown trimmed value
   - Clear language: write bare `code`
   - Remove code: write remove mark
7. Tests:
   - hover opens code actions
   - edit `ts` stores/renders as `typescript`
   - edit unknown language stores unknown value and falls back to plain rendering
   - clear language keeps `.markCode`
   - remove code removes `.markCode`
   - hover range covers adjacent code runs with same normalized language

## Phase 5: Annotation Body Editing Parity

Files:

- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/App.test.tsx`

Tasks:

1. Add annotation body code commands:
   - `setAnnotationBodyCodeMark`
   - `clearAnnotationBodyCodeLanguage`
   - `removeAnnotationBodyCodeMark`
2. Add annotation body collapsed typing support for bare code.
   - `AnnotationBodyBlock` currently has its own local selection state and command runner.
   - It does not use the main editor's retained inline mark session map.
   - Add a small local pending/retained code path for annotation body typing, or generalize reusable retained mark helpers so both editors can use them.
3. Add annotation body code hover and language popover.
   - Reuse the generic code popover components from Phase 4 if practical.
   - Keep body link hover/popover behavior working.
4. Add keyboard/UI entry points for annotation bodies.
   - At minimum, support the same keyboard shortcut used in the main editor for code if one is introduced.
   - If code is only available from the main toolbar, make sure active annotation body selections route toolbar code actions to annotation body commands, similar to existing annotation creation behavior.
5. Tests:
   - apply code in annotation body
   - hover/edit language in annotation body
   - collapsed typing in annotation body creates bare code
   - clear language and remove code in annotation body
   - body links and annotation popovers still work

## Phase 6: Markdown Backtick Shortcuts

Files:

- `examples/block-rich-text/src/markdownShortcuts.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/annotations.ts`
- related tests

Tasks:

1. Add inline backtick shortcut handling for normal typing.
   - When a closing backtick is typed, detect a matching earlier backtick in the same block before the caret.
   - Convert `` `code` `` to `code` marked with bare `code`.
   - Delete the delimiter backticks.
   - Preserve caret at the end of the marked code text.
2. Keep scope intentionally narrow:
   - single-line only
   - no conversion inside an existing code mark unless tests show a useful behavior
   - no language parsing from backticks; language remains hover-editable
3. Add pasted markdown shortcut support if it fits the existing pasted-line shortcut mechanism.
   - Existing paste shortcuts are prefix/block-oriented.
   - Inline backtick paste conversion may need a separate pass over touched lines.
4. Add annotation body support for the same inline backtick shortcut.
   - Annotation bodies use `replaceAnnotationBodySelection` and `pasteAnnotationBodyTextWithMarkdownShortcuts`, so this needs body-specific wiring.
5. Tests:
   - typing closing backtick converts inline code
   - no conversion without a matching opening backtick
   - conversion works with emoji/grapheme offsets
   - paste conversion for one or more inline code spans if implemented
   - annotation body backtick conversion

## Phase 7: Verification and Cleanup

Commands:

- `npm exec vitest -- --run examples/block-rich-text/src/inlineMarks.test.ts`
- `npm exec vitest -- --run examples/block-rich-text/src/syntaxHighlight.test.ts`
- `npm exec vitest -- --run examples/block-rich-text/src/blockCommands.test.ts`
- `npm exec vitest -- --run examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `npm exec vitest -- --run examples/block-rich-text/src/App.test.tsx`

Tasks:

1. Run focused tests after each phase where practical.
2. Run the full block-rich-text test set before finishing.
3. Start the local Vite dev server and manually verify:
   - main editor range code
   - main editor collapsed code typing
   - hover language editing
   - syntax highlighting
   - annotation body code editing
   - inline code inside code blocks
   - backtick shortcut
4. Check desktop and narrow viewport layout for popover/input overflow.

## Suggested Implementation Order

1. Shared model/helpers.
2. Main editor commands plus collapsed bare code typing.
3. Rendering and syntax highlighting.
4. Main editor popovers.
5. Annotation body parity.
6. Markdown shortcut support.
7. Final verification.

This order keeps the data model stable before UI work, then gets the main editor working before duplicating/adapting the behavior for annotation bodies.
