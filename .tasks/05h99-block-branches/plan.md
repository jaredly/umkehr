# Plan: Generalized Branch Machinery for Block CRDT

## Decisions

- Publish the reusable branch machinery from the `umkehr` package, not just inside examples.
- Store block branch update events as command-level `Op<M>[]` batches, not one event per op.
- Give branch update events an explicit `eventId`; do not derive identity from block op timestamps.
- Support block merge review at per-block granularity.
- Do not require per-character or per-small-change review.
- "Revert" in block merge review means revert the whole changed block.
- Keep branch merge events outside block CRDT document state as sync/history metadata.
- Add engine-specific validators for server/protocol payloads.
- Version standalone block CRDT documents by block-CRDT package/document format version.
- Pending block ops should behave like JSON CRDT pending updates from the branch user's point of view.
- Undo/redo integration is in scope for the initial branch work.
- Presence/status APIs can be generalized later and should not block this task.

## Phase 1: Generic Branch Core

Goal: move the document-engine-independent branch event graph into `src/branches`.

Tasks:

- Add a new package module, likely `src/branches/`.
- Define generic types:
  - `Branch`
  - `BranchEvent<TUpdate>`
  - `UpdateEvent<TUpdate>`
  - `MergeEvent`
  - `PersistedBranch<THistory, TUpdate>`
  - `BranchAdapter<THistory, TUpdate>`
  - merge impact and stale review metadata types
- Use explicit `eventId` on update events.
- Keep `eventIndex` as the branch-ordering mechanism.
- Port generic materialization from `examples/react-crdt/src/lib/server/materialize.ts`:
  - branch base replay from `sourceBranchId` / `forkEventIndex`;
  - recursive merge event replay;
  - cycle/stack protection;
  - "apply update once" by `eventId`;
  - source update collection through a merge event index;
  - merged-source coverage and merge impact.
- Do not include JSON CRDT path preview/revert in the generic core.
- Add exports in `src/branches/index.ts` and `package.json` as `umkehr/branches`.

Tests:

- Use a tiny fake adapter with numeric/string state to test:
  - main branch replay;
  - branch fork replay;
  - merge event replay;
  - merge through an older event index;
  - duplicate update event id is applied once;
  - recursive merge source coverage;
  - merge impact for already-merged / no-effect source updates.

## Phase 2: Generic Stale Review

Goal: extract the 5-minute old-pending manual review model without JSON dependencies.

Tasks:

- Move/adapt `staleReview.ts` logic into `src/branches/staleReview.ts`.
- Preserve `DEFAULT_OLD_PENDING_REVIEW_THRESHOLD_MS = 5 * 60 * 1000`.
- Parameterize review construction on the generic branch adapter.
- Keep these operations generic:
  - `pendingEventsForBranch`;
  - `oldestPendingAt`;
  - `hasOldPending`;
  - `serverMoved`;
  - `blockedBranchesForReview`;
  - `buildStaleMergeReview`.
- Model the four review histories generically:
  - base;
  - server;
  - client;
  - result.
- Add helpers for completing review:
  - accept/replay local pending events on top of server;
  - fork local pending events to a new branch;
  - discard pending local events.

Tests:

- Port existing stale review unit coverage to the generic module.
- Add tests for:
  - old pending local events plus advanced server tip blocks upload;
  - auto-merge policy never blocks;
  - young pending events do not block;
  - unchanged server tip does not block;
  - accept/fork/discard review transitions preserve event ordering.

## Phase 3: JSON CRDT Adapter and Example Compatibility

Goal: keep the existing React CRDT server behavior working while moving reusable logic out of the example.

Tasks:

- Add a JSON adapter under `src/crdt/branches.ts` or `src/crdt/branchAdapter.ts`.
- Map:
  - `THistory = CrdtLocalHistory<TState>`;
  - `TUpdate = CrdtUpdate`;
  - initial history from app initial CRDT document/history;
  - apply update via `applyRemoteHistoryUpdate`;
  - event id via `latestCrdtUpdateTimestamp`.
- Move or wrap `MergeImpact` and source coverage through the generic core.
- Keep JSON path-level merge preview in the React example or a JSON-specific module:
  - `CrdtPathSegment[][]`;
  - `pathLabel`;
  - `createRestoreUpdates`;
  - JSON path-level reverted keys.
- Update `examples/react-crdt/src/lib/server/*` imports to use the generic branch core where feasible.
- Keep protocol, IndexedDB persistence, schema migration, presence, and UI store code in the example for now.
- Preserve existing public behavior and storage shape unless a small compatibility shim is required.

Tests:

- Run existing server unit tests:

```sh
npm exec vitest -- run examples/react-crdt/src/lib/server
```

- Run targeted E2E if available/time allows:

```sh
cd examples/react-crdt && pnpm test:e2e -- tests/server/server-branches.spec.ts
```

## Phase 4: Block Branch Adapter

Goal: provide first-class branch materialization for block CRDT using command batches.

Tasks:

- Add `src/block-crdt/branches.ts`.
- Define:

```ts
export type BlockCrdtUpdate<M extends TimestampedBlockMeta> = {
    eventId: string;
    ops: Op<M>[];
};
```

or equivalent, as long as the event id is explicit and stable.

- Use `CachedState<M>` as the initial block history type unless undo integration requires a wrapper immediately.
- Accept a state-dependent config hook:

```ts
configFor?(history: CachedState<M>): VirtualBlockParentConfig<M>
```

- Apply batches with `applyMany` or `applyRemoteMany`.
- Decide the missing-dependency behavior to match JSON CRDT user expectations:
  - materialization should not silently drop valid pending dependencies;
  - if branch event order is invalid, fail loudly in tests/development;
  - server sync can queue/retry remote batches if needed later.
- Validate updates:
  - event id is non-empty;
  - `ops` is an array;
  - every op passes `validateOp`;
  - optional document/block CRDT version matches.
- Add helper exports:
  - create block branch adapter;
  - create block update batch with event id;
  - event-id validation helper.
- Add package export as `umkehr/block-crdt/branches`.

Tests:

- Create an initial block state.
- Create main and a feature branch.
- Apply text insert batches to each.
- Materialize each branch independently.
- Merge feature into main through a specific event index.
- Verify resulting visible text/block outline.
- Verify command batches remain atomic branch events.
- Verify invalid op payloads are rejected by the validator.

## Phase 5: Block Undo/Redo Integration

Goal: make block branch history compatible with local undo/redo from the start.

Tasks:

- Define a block branch local history wrapper if `CachedState<M>` alone is insufficient, for example:

```ts
type BlockBranchHistory<M> = {
    state: CachedState<M>;
    commands: BlockBranchCommand<M>[];
    undoStack: string[];
    redoStack: string[];
};
```

- Store enough command metadata per local batch:
  - command id / event id;
  - actor;
  - before state or sufficient before snapshot for `planUndoOps`;
  - applied op batch;
  - intent: normal / undo / redo.
- Reuse `planUndoOps(before, current, batch, {actor, ts})` for undo planning.
- Decide whether redo stores original ops or replans from command metadata.
  - Prefer replanning or guarded replay if current block state can diverge.
- Make undo/redo append normal forward branch update events with new event ids.
- Ensure undo/redo events participate in:
  - branch materialization;
  - merge events;
  - stale review pending event queues;
  - fork/discard/accept review transitions.
- Keep undo stacks local to an actor/session, matching current block-rich-text behavior.

Tests:

- Undo a local text insert on a branch and materialize the branch.
- Redo the undone insert.
- Merge a branch containing undo/redo events into main.
- Create stale review with pending undo events and accept/fork them.
- Verify undo does not undo remote/user events from another actor.
- Cover unsupported undo plan behavior: no branch event should be appended if `planUndoOps` is incomplete.

## Phase 6: Per-Block Merge Preview and Revert

Goal: support block-native selective merge review at the requested granularity.

Tasks:

- Define stable block merge change keys:

```ts
type BlockMergeChangeKey =
    | {kind: 'block'; blockId: string};
```

Start intentionally coarse. A block key covers text, metadata, style, marks, moves, split/join impact, deletion, and insertion for that block.

- Add a block changed-key collector for an op batch:
  - `block` op -> inserted block id;
  - `block:delete`, `block:move`, `block:meta`, `block:style` -> target block id;
  - `char`, `char:move`, `char:delete` -> owning/materialized block id before/after as appropriate;
  - `mark` -> covered blocks if cheaply available, otherwise owning blocks from visible ranges;
  - `split-record` / `join-record` -> affected left/right blocks.
- Deduplicate keys by stable block id.
- Add labels from current preview state, with fallback to block id suffix.
- Implement "revert this block" for preview.
  - First option: create a block restore batch that makes the preview block match the target-before block for that block id.
  - Inserted block in source but absent in target-before should become a block delete batch.
  - Deleted block in source but present in target-before should restore the block and visible text as block undo already does.
  - Text changes should restore visible text for that block, likely by deleting current visible chars and inserting target-before text.
  - Metadata/style should restore target-before values with fresh timestamps.
- Prefer helper reuse from `src/block-crdt/undo.ts` where possible, but expose new block-restore helpers only if they are generally useful.
- Treat complex split/join/move edge cases conservatively:
  - if a block-level revert cannot be planned completely, mark it unsupported rather than generating partial updates.
- Make accepted merge append:
  - the merge event;
  - any block-revert batches selected in the preview.

Tests:

- Merge preview lists one changed key for a text-only edit in a block.
- Reverting that key restores target-before visible text for that block.
- Source-inserted block can be reverted by deleting the inserted block.
- Source-deleted block can be reverted/restored or reports unsupported explicitly.
- Block metadata/style changes can be reverted.
- Split/join/move cases have focused tests for the supported behavior and explicit unsupported coverage for the rest.

## Phase 7: Branch Server Protocol Generalization

Goal: make branch sync/storage usable by both JSON CRDT and block CRDT.

Tasks:

- Introduce an engine id, likely:
  - `json-crdt`;
  - `block-crdt`.
- Add document format/version metadata:
  - keep existing JSON schema version/fingerprint for JSON documents;
  - add block CRDT package/document format version for block documents.
- Make update event payloads generic JSON with:
  - `engine`;
  - `eventId`;
  - `update`.
- Add server-side engine validators:
  - JSON CRDT validator wraps current `createCrdtUpdateValidator`;
  - block CRDT validator validates block update batches.
- Keep server storage generic:
  - branches;
  - branch events;
  - merge events;
  - documents with app/engine/version metadata.
- Do not include presence generalization in this phase.
- Keep current JSON migration support working.
- For block CRDT, either:
  - reject unsupported migration/version mismatches with a clear state; or
  - define a simple version compatibility rule for equal block CRDT document version.

Tests:

- Protocol parsing accepts valid JSON updates under JSON engine.
- Protocol parsing accepts valid block batch updates under block engine.
- Protocol parsing rejects mismatched engine/update shapes.
- Server store persists and returns opaque block update payloads.
- Branch creation, update append, merge append, and event listing work for block documents.
- Existing JSON server tests continue passing.

## Phase 8: Block Rich Text Integration

Goal: wire the generic branch machinery into a real block CRDT consumer without overgeneralizing UI concerns.

Tasks:

- Decide whether to integrate into `examples/block-rich-text` directly or create a smaller branch-focused block example.
- Replace or augment the two-replica queue runtime with branch-aware state:
  - active branch id;
  - branch list;
  - branch event log;
  - local pending events;
  - stale review state.
- Use block command batches as branch update events.
- Add UI controls:
  - branch list/switch;
  - create branch;
  - merge branch;
  - merge preview with per-block toggles;
  - stale review actions: accept, fork, discard.
- Preserve existing editing behavior, retained selections, and undo/redo controls.
- Defer presence/status generalization; keep any remote cursor/status UI local to the example if needed.

Tests:

- Component/unit tests for branch switching and merging in the example runtime.
- Existing block-rich-text editing tests should continue passing.
- Add at least one integration test for:
  - create branch;
  - edit both branches;
  - merge feature into main;
  - per-block revert in merge preview;
  - undo after branch switch or merge.

## Phase 9: Documentation and Exports

Goal: make the new API understandable and stable enough to consume.

Tasks:

- Update `package.json` exports:
  - `./branches`;
  - `./crdt/branches`;
  - `./block-crdt/branches`.
- Add docs:
  - generic branch concepts;
  - JSON adapter usage;
  - block adapter usage;
  - event id policy;
  - block CRDT document version policy;
  - limitations of per-block revert.
- Update `Readme.md` or docs index with links.
- Add migration notes for example code that previously imported server branch helpers directly.

Verification:

```sh
npm run typecheck
npm exec vitest -- run src/branches src/crdt src/block-crdt
npm exec vitest -- run examples/react-crdt/src/lib/server
npm exec vitest -- run examples/block-rich-text/src
npm run typecheck:examples
```

## Suggested Implementation Order

1. Build `src/branches` with fake-adapter tests.
2. Port stale review into `src/branches`.
3. Adapt JSON server materialization to use the generic core and prove no behavior changed.
4. Add the block branch adapter with command batches and explicit event ids.
5. Add block undo/redo branch history.
6. Add per-block merge preview/revert.
7. Generalize server protocol/storage.
8. Integrate the block-rich-text example.
9. Finish docs and package exports.

## Out of Scope for Initial Implementation

- Generalized presence/status APIs.
- Per-character or per-change block merge review.
- Full block CRDT schema migration machinery beyond package/document version compatibility.
- Moving all React/WebSocket/IndexedDB sync code into `src/`.
- Rewriting the JSON CRDT migration UI.
