# Implementation Log

## 2026-06-27

- Started implementation from `plan.md`.
- Baseline `git status --short` was clean.
- Baseline search confirmed `kanban` references are concentrated in block-rich-text source, tests, fixtures, CSS, and task notes.
- Phase 1 source changes: introduced `columns` metadata with `display`, added `columns` and `card-columns` menu values, renamed the conversion command to `convertBlockToColumns`, and gated card context helpers to `display: 'cards'`.
- Phase 2 source changes: document import/export, raw history validation, clipboard validation, and fixtures now use canonical `columns`; old `kanban` compatibility was intentionally removed.
- Phase 3 source changes: rendering now routes `columns` blocks through renamed `Columns*` components, branches on `display`, adds a block-options display selector, and renames rendered CSS/data attributes to `columns*`.
- Phase 4 source changes: drag/drop now uses `columns*` selectors; card-mode behavior remains specialized, and block-mode column placement uses column/container background hits to avoid blocking normal nested row drops.
- Workaround: block-mode columns need both horizontal column placement and normal nested block movement. The first implementation avoids treating every point inside a column as a column-drop target so inner block rows can still use generic drop behavior.
- Phase 5 source/test changes: updated document, fixture, clipboard, history, command, and DOM tests for `columns`; added DOM coverage for default block columns and switching to cards through block options.
- Verification:
  - `npm run build` passed. It prints a non-fatal `Error connecting to agent: Operation not permitted` before the npm script, then `tsc` and Vite complete successfully.
  - Focused non-DOM tests passed: `documentFormat`, `documentFixtures`, `clipboard`, `history`, and `blockCommands` (302 tests).
  - `App.test.tsx` passed (248 passed, 1 skipped).
  - Full `vitest --run` initially hit a timing-sensitive existing perf threshold in `typingPerf.test.ts` (140.8ms vs 120ms), then `typingPerf.test.ts` passed when rerun in isolation.
- Follow-up styling change: block-mode columns no longer use board chrome. Card mode keeps the bordered/tinted board styling; block mode now uses a plain wrapping grid with no background, border, or horizontal scrolling.
- Follow-up verification:
  - `npm exec vitest -- --run src/App.test.tsx` passed (248 passed, 1 skipped).
  - `npm run build` passed with the same non-fatal agent message before the npm script.
