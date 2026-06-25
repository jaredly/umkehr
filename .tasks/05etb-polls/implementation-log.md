# Implementation Log: In-Document Poll Blocks

## 2026-06-25

- Started Phase 1: CRDT block metadata custom merge semantics.
- Existing worktree was already dirty before this task; this implementation is scoped to poll-related files and task notes.
- Added `mergeBlockMeta` support to the CRDT apply config. Default behavior remains block metadata LWW.
- Wired custom metadata merge through both `block:meta` ops and duplicate `block` ops.
- Added focused tests for default-safe custom merges, including stale incoming metadata that still contributes mergeable fields.
- Verification: `npm exec vitest -- run src/block-crdt/index.test.ts` passed.
- Added poll metadata types, default rating poll metadata, poll vote validation, result helpers, and poll metadata merge helpers.
- Added shared `richTextCrdtConfig` for block-rich-text so remote sync, history replay, and undo derivation can use annotation virtual parents plus poll metadata merge semantics.
- Added basic poll support to block type conversion, toolbar options, document import/export, history validation, and clipboard metadata validation.
- Verification: `npm run build` in `examples/block-rich-text` passed. The command prints `Error connecting to agent: Operation not permitted` before running, but TypeScript and Vite completed successfully.
- Added per-editor normalized user id state and header inputs. Defaults are `ulrich` and `uwe`; input changes are normalized with `trim().toLowerCase()`.
- Threaded `userId` into the block render context for poll controls.
- Verification: `npm run build` in `examples/block-rich-text` passed with the same harmless pre-command agent warning.
- Implemented rating poll rendering for `poll` blocks with `kind: 'rating'`. The block text remains the editable question and the rating controls render below it as non-editable UI.
- Added a rating vote command that writes only the current user's vote entry, defaults to allowing vote changes, records poll-specific undo metadata, and derives result percentages after the current user has voted.
- Added poll-vote undo/redo handling. Issue encountered: generic whole-block metadata undo is not enough because poll metadata merge keeps the newest per-user vote by inner vote timestamp. Workaround/solution: poll vote commands store `{blockId, userId, before, after}` and undo/redo writes a fresh per-user vote or tombstone with newer timestamps.
- Added focused tests for poll vote merging and result derivation.
- Verification: `npm exec vitest -- run src/block-crdt/index.test.ts examples/block-rich-text/src/pollBlocks.test.ts` passed.
- Verification: `npm run build` in `examples/block-rich-text` passed with the same harmless pre-command agent warning.
- Added a `Rating polls` document fixture covering empty, voted, and locked rating polls.
- Added document import/export coverage for poll metadata and persisted votes.
- Added history replay coverage for concurrent offline poll votes from different users; replay preserves both votes after reconnect.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/undoHistory.test.ts examples/block-rich-text/src/history.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/pollBlocks.test.ts src/block-crdt/index.test.ts` passed.
- Issue: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` failed only the existing performance-budget test `selects a block in the many blocks fixture in less than 50ms`; the measured time was ~339ms. Rerunning just that test also failed at ~373ms. The other 222 app tests passed in the full run.
