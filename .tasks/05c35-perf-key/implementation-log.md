# Implementation Log: Keypress Performance Monitor

## Progress

- Started implementation from `plan.md`.
- Phase 1 complete: added transient perf sample state in `EditorApp`, bounded to the latest 60 samples and kept separate from persisted history.
- Phase 2 complete: added the fixed top-right monitor UI with latest duration, latest label, capped bars, and fast/medium/slow threshold colors.
- Phase 3/4 complete: instrumented `beforeinput`, jsdom `input` fallback, paste, and default-prevented `keydown` work in `RichTextEditableSurface`; threaded timing through normal blocks, table row headers, and annotation body editors.
- Phase 5 complete: added focused monitor tests for empty state, printable input, handled keydown, paste, sample capping, and history/export isolation.
- Follow-up complete: added timing for mouseup-driven selection updates. These samples are labeled `Selection click`, and the monitor header now says `Event ms` because it covers input and selection events.
- Follow-up complete: added displayable-key-to-React-commit timings. Printable `insertText` events now also create `Render <key>` samples after the next React layout commit, using the same input-event start timestamp as the synchronous key sample.
- Verification passed:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
  - `npm exec vitest -- run examples/block-rich-text/src/typingPerf.test.ts`
- Browser smoke test skipped per user direction.

## Issues / Workarounds / Bugs

- The worktree already contained unrelated inline embed changes in `App.tsx`; perf edits were kept additive and did not revert those changes.
- Initial typecheck command used the wrong `npm exec` argument order and treated `tsconfig.json` as a source file. Reran as `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit`.
- TypeScript caught a duplicate `onInputMeasured` property in the render context object; removed the duplicate.
- App test fixes:
  - tightened the duration query because `/ms$/` also matched the static `Input ms` label.
  - used `window.HTMLAnchorElement` in the export test because `HTMLAnchorElement` is not installed as a Node global in this test environment.
  - added `vi.restoreAllMocks()` to test cleanup so URL/anchor spies cannot leak after failures.
- Browser smoke attempt notes before skipping:
  - the in-app browser surface was unavailable in this session (`iab` not available).
  - `pnpm exec playwright` could not run because the `playwright` command was not installed.
  - a sandboxed headless Chrome screenshot did not produce an image; the escalated retry was interrupted when the user said to skip smoke tests.
- Selection timing note: only the root `mouseup` selection-capture path is measured. Keyboard-driven selection capture via `keyup` remains unmeasured so typing/navigation samples are not conflated with click selection timings.
- Render timing note: displayable text input now produces two samples: the existing synchronous key/input duration (`a`, `b`, etc.) and a render-finished duration (`Render a`, `Render b`, etc.). Delete, paste, shortcuts, and selection clicks remain synchronous-only.
