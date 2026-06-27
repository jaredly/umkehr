# Implementation Log: Block Branch Machinery

## Progress

- Started Phase 1 by adding a generic `src/branches` module for branch event types, materialization, merge source collection, and merge impact.
- Added fake-adapter tests for branch replay, fork replay, merge replay, duplicate event ids, source update collection, merged-source coverage, and merge impact.
- Verified `npm exec vitest -- run src/branches/index.test.ts` passes.
- Started Phase 2 by extracting generic stale review helpers.
- Added generic stale-review helpers and tests for stale detection, review history construction, accept, fork, and discard.
- Verified `npm exec vitest -- run src/branches` passes.
- Added `umkehr/branches` package export.
- Added initial JSON CRDT branch adapter at `src/crdt/branches.ts` plus `umkehr/crdt/branches` export.
- Verified `npm run typecheck` passes after the new generic/JSON modules.
- Started Phase 4 block adapter work before fully migrating the existing React server path, to validate the adapter interface against block CRDT.
- Corrected the generic adapter API to pass `{recordHistory}` into `applyUpdate`. This preserves the existing JSON behavior where source updates pulled in through merge events affect document contents but do not become target-branch undo history.
- Migrated `examples/react-crdt/src/lib/server/materialize.ts` so `materializeServerBranch` delegates to the generic branch core through the JSON adapter while keeping JSON path-level merge preview local.
- Verified `npm exec vitest -- run examples/react-crdt/src/lib/server/materialize.test.ts` passes after the migration.
- Verified broader React server helper coverage with `npm exec vitest -- run examples/react-crdt/src/lib/server`.
- Added `src/block-crdt/branches.ts` with:
  - `BlockCrdtUpdate` command batches with explicit `eventId`;
  - block branch adapter for `CachedState<M>`;
  - block update event creation;
  - batch validation using `validateOp`;
  - package export as `umkehr/block-crdt/branches`.
- Added block branch tests for materializing command batches, merge events, command-batch atomicity, and validation.
- Added reusable block branch undo/redo helpers:
  - `createBlockBranchHistory`;
  - `appendBlockBranchCommand`;
  - `undoBlockBranchCommand`;
  - `redoBlockBranchCommand`.
- Added undo/redo tests covering forward undo/redo batches and actor-local undo stack behavior.
- Verified targeted coverage with `npm exec vitest -- run src/branches src/block-crdt/branches.test.ts examples/react-crdt/src/lib/server`.
- Verified `npm run typecheck` passes.
- Verified `npm run typecheck:examples` passes after package export and example import changes.

## Issues / Notes

- While implementing the generic branch core, I found that a plain `applyUpdate(history, update)` adapter API would incorrectly add merge-source updates to JSON target undo history. The adapter now receives `{recordHistory}` so adapters can distinguish direct branch replay from base/merge materialization.
- Block undo/redo tests initially used toy timestamps like `u1` / `r1`; block delete conflict resolution compares timestamp strings, so redo did not win over undo. Tests now use padded increasing timestamps like existing block CRDT undo tests.
- Phase 6 per-block merge preview/revert is not implemented yet. The block adapter and undo/redo history are in place, but block-native changed-key collection and block restore planning still need dedicated work.
- Phase 7 server protocol generalization is not implemented yet beyond the package-level JSON adapter and generic branch materialization. The existing React server protocol still uses JSON CRDT-shaped messages.
- Phase 8 block-rich-text UI integration is not implemented yet.
