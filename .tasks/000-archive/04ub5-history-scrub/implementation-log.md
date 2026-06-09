# Implementation Log: Block Rich Text History Scrub

## 2026-06-08

- Started implementation from `plan.md`.
- Current code differs from the original research in two important ways:
  - `Replica.selection` is now a `RetainedSelectionSet`.
  - Selection-only actions are still expressed as `MultiCommandResult` values with `ops: []`; history must treat these as transient UI state, not replay history.
- Added `examples/block-rich-text/src/history.ts` with replay, branching, serialization, import validation, final snapshots, and actor-clock advancement.
- Added `examples/block-rich-text/src/history.test.ts` covering replay, offline queues, scrubbing, branching, import/export, removed op validation, join/move op replay, and clock freshness.
- Test issue: insert ops did not expose the command timestamp because `charOp()` currently stores `parent.ts: ''` despite accepting a `ts` parameter. Worked around the clock freshness assertion by checking the replayed clock directly and using a split op, which does carry HLC strings.
- Replaced `App`'s direct demo state with replay-derived history state, added transient selection overlays, and added scrub/import/export/reset controls.
- Added App tests for scrubbing backward/forward, branching after editing from the past, keeping selection-only captures out of history, and invalid import behavior.
- Verification: `npm exec vitest examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/App.test.tsx` passed with 56 tests.
- Verification: `npm run build` in `examples/block-rich-text` passed. The command printed `Error connecting to agent: Operation not permitted` before running the build, but the TypeScript/Vite build completed successfully.
- Verification: `npm exec vitest examples/block-rich-text/src` passed with 110 tests.
- Added keystroke recording as non-replay history metadata. Keystrokes are exported/imported with the action history and are branch-trimmed when editing from the past, but they do not become scrubber steps.
- Added a collapsed `Keystrokes` log panel showing recent keydown records by sequence, editor, key combo, and action index.
- Added tests for keystroke branch trimming, export/import, and the collapsed UI log.
- Verification: `npm exec vitest examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/App.test.tsx` passed with 57 tests.
- Verification: `npm exec vitest examples/block-rich-text/src` passed with 111 tests.
- Verification: `npm run build` in `examples/block-rich-text` passed again with the same non-fatal `Error connecting to agent: Operation not permitted` prefix.
