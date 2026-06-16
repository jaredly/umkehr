# Implementation Log: Retained Inline Format

## Phase 1: Command Support

- Started by adding command-level support for inserting text with pending boolean inline marks.
- Added `insertTextWithMarks` and `insertTextWithMarksEverywhere`.
- Added command tests for single and multi-selection marked inserts.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts`; both files passed.

## Phase 2: Pending UI State

- Starting `App.tsx` wiring for transient pending marks.
- Added local `pendingInlineMarks` state in `BlockEditor`.
- Routed collapsed-caret bold, italic, and strikethrough toggles through transient pending state.
- Kept range selections on the existing document mark path and clear pending marks when a range/selection movement occurs.
- Wired normal document and table-row text insertion through pending-mark insertion.

## Phase 3: Toolbar State

- Added toolbar active state derived from both pending marks and actual formatted runs at the primary selection.
- Added `aria-pressed` to bold, italic, and strikethrough buttons.
- Added pressed button styling in `style.css`.

## Phase 4: Tests And Verification

- Added UI tests for collapsed-caret pending bold, toggling pending bold off, clearing on caret movement, `Ctrl+B`, pending italic/strikethrough, and toolbar pressed state from actual marks.
- Ran `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`; passed.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/App.test.tsx`; passed with 3 files / 210 tests.
- Ran `npm run build` in `examples/block-rich-text`; `tsc` and `vite build` passed. A non-fatal `Error connecting to agent: Operation not permitted` line appeared before npm script output, but the build exited successfully.
- Added a perf regression test in `typingPerf.test.ts` for pasting 2000 chars, bolding the first 10 chars, then calculating toolbar active marks at the end of the block in under 10ms.
- Optimized collapsed-caret toolbar mark lookup to inspect runs directly instead of creating a per-character mark array.
- Ran `npm exec vitest -- run examples/block-rich-text/src/typingPerf.test.ts`; passed.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/typingPerf.test.ts`; passed with 4 files / 216 tests and 1 skipped test.
- Ran `npm run build` in `examples/block-rich-text`; passed with the same non-fatal `Error connecting to agent: Operation not permitted` line before npm script output.
- Reproduced the app-level slow path: 400-char paste, pending bold on, then 20 synchronous `beforeinput` insertions took about 2.5s before optimization.
- Added a UI perf regression test for that path and fixed it by batching same-tick insert-text `beforeinput` events only while pending inline marks are active.
- Kept normal unstyled text insertion immediate after an initial broad batching attempt delayed an existing code-block formatting test.
- Added command/materialization perf coverage for 20 pending-bold inserts after a 400-char paste.
- Ran `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`; passed with 114 tests.
- Ran `npm exec vitest -- run examples/block-rich-text/src/typingPerf.test.ts`; passed with 8 tests and 1 skipped test.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/typingPerf.test.ts`; passed with 4 files / 219 tests and 1 skipped test.
- Ran `npm run build` in `examples/block-rich-text`; passed with the same non-fatal `Error connecting to agent: Operation not permitted` line before npm script output.

## Issues / Workarounds

- Pending marks are intentionally scoped to the main editor surfaces. Annotation body editors still use their existing range-only mark commands.
- Pending marks are cleared on explicit selection changes and navigation commands, but not after text insertion, matching conventional typing-style behavior.
