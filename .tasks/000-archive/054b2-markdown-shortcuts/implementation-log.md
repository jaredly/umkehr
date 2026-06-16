# Implementation Log: Markdown Shortcuts For Lists

## 2026-06-16

- Started implementation from `plan.md`.
- Noted existing unrelated working tree changes; this task will only touch markdown shortcut files and tests.
- Phase 1: added `insertTextWithMarkdownShortcuts` in `blockCommands.ts`.
  - It wraps raw insertion, only checks single-space input, only converts paragraph blocks, deletes the prefix, and appends a block metadata update.
  - No issues encountered in this phase.
- Phases 2-3: added `insertTextWithMarkdownShortcutsEverywhere` and wired ordinary typed text through it in `App.tsx`.
  - Paste remains on the existing paste path, as planned.
  - Active pending inline marks keep the newer retained-mark insertion path; ordinary typed text and non-caret fallback use markdown-aware insertion.
- Phase 4: added command-level tests for accepted shortcuts, rejected markers, non-paragraph blocks, table-cell paragraphs, and peer application of generated ops.
- Issue encountered: the table-cell shortcut test initially used a fresh timestamp context after creating the table. The prefix deletion applied, but the metadata update had an older timestamp than the existing paragraph meta and was ignored by CRDT conflict resolution.
  - Workaround/fix: use one monotonic `CommandContext` for table creation and subsequent typing in that test.
- Phase 5: added an `App.test.tsx` regression test for `beforeinput` typing of `- ` and cross-replica marker rendering.
- Verification:
  - `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts` passed: 90 tests.
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed: 114 tests.
  - `npm --prefix examples/block-rich-text run build` passed, including `tsc --noEmit` and Vite build.
- Known caveat: active pending inline marks keep the existing retained-mark insertion path. Markdown shortcuts are wired for ordinary typed text and non-caret replacement fallback; shortcut conversion while a pending inline mark is actively being extended was left unchanged to avoid interfering with the newer retained mark session logic.
- Follow-up change: `[ ] `, `[x] `, and `[X] ` now also convert unordered bullet list items into todos. Paragraph todo shortcuts still work. Ordered list items intentionally remain literal for todo shortcuts.
