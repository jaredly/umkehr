# Research: Generalized Branch Machinery for Block CRDT

## Goal

Make the branch/merge/stale-review machinery from the JSON CRDT server mode available to block CRDT users without forcing block documents through the JSON CRDT stack.

The immediate user-facing behavior to preserve is:

- named branches with a main branch;
- creating a branch from the active branch at a known event index;
- switching branches by rematerializing the selected branch;
- merging another branch through a selected event index;
- detecting old pending local changes when the server branch has moved;
- requiring a manual stale merge/review once pending local changes are more than the configured threshold out of sync, currently 5 minutes by default.

The likely shape is not "teach `CrdtUpdate` about blocks." It is to extract the event-graph / branch-log machinery behind an adapter interface, then provide one adapter for `umkehr/crdt` and one for `umkehr/block-crdt`.

## Current JSON CRDT Branch System

The current branch system lives in the React CRDT example, not in `src/`.

Important files:

- `examples/react-crdt/src/lib/server/types.ts`
- `examples/react-crdt/src/lib/server/materialize.ts`
- `examples/react-crdt/src/lib/server/staleReview.ts`
- `examples/react-crdt/src/lib/server/useServerSync.ts`
- `examples/react-crdt/src/lib/server/protocol.ts`
- `examples/react-crdt/src/lib/server/persistence.ts`
- `examples/react-crdt-server/src/types.ts`
- `examples/react-crdt-server/src/store.ts`
- `examples/react-crdt-server/src/index.ts`

The core persisted concepts are:

```ts
type ServerBranch = {
    docId: string;
    branchId: string;
    name: string;
    sourceBranchId?: string;
    forkEventIndex?: number;
    tipEventIndex: number;
    createdAt: string;
    updatedAt: string;
};

type ServerBranchEvent =
    | {kind: 'update'; branchId: string; eventIndex: number; update: CrdtUpdate; ...}
    | {kind: 'merge'; branchId: string; eventIndex: number; sourceBranchId: string; sourceThroughEventIndex: number; ...};
```

Local replicas additionally track:

- `history: CrdtLocalHistory<TState>`;
- `lastSeenEventIndex`;
- `undoCheckpointEventIndex`;
- `events`;
- `recorded` on events that have been acknowledged by the server.

`materializeServerBranch` is the heart of branch playback. It starts from the app's initial CRDT history, recursively applies the source branch up to the fork point, then applies update events and merge events in event-index order. Merge events are not stored as copied updates; a merge event references `sourceBranchId` and `sourceThroughEventIndex`, and materialization recursively applies that source branch.

The server is comparatively generic. SQLite stores branch event payloads as JSON, branches as `(docId, branchId)`, and merge events as references. The server does not materialize JSON documents to process ordinary branch writes. It does validate protocol shape and schema metadata, but the branch graph itself is not inherently JSON-specific.

## Stale Review Behavior

The old-pending manual review logic is mostly independent of document type.

`examples/react-crdt/src/lib/server/staleReview.ts` defines:

- `DEFAULT_OLD_PENDING_REVIEW_THRESHOLD_MS = 5 * 60 * 1000`;
- `pendingEventsForBranch`;
- `oldestPendingAt`;
- `hasOldPending`;
- `serverMoved`;
- `blockedBranchesForReview`;
- `buildStaleMergeReview`.

A branch is blocked for manual review when all of these are true:

1. policy is `{kind: 'manual-review'}`;
2. the branch has unrecorded local events;
3. the oldest pending event is at least the threshold age;
4. the server's `tipEventIndex` is greater than the local branch's `lastSeenEventIndex`.

`buildStaleMergeReview` builds four histories:

- `baseHistory`: recorded server state at the client's last seen event index;
- `serverHistory`: recorded server state at the current server tip;
- `clientHistory`: base plus pending local events;
- `resultHistory`: server tip plus pending local events.

This model is adapter-friendly. The only hard dependency is how to apply update events to a history.

## JSON-Specific Parts

The current code is generic in `TState`, but not generic in CRDT operation type.

JSON-specific dependencies:

- event updates are `CrdtUpdate`;
- histories are `CrdtLocalHistory<TState>`;
- `materializeServerBranch` starts with `createInitialCrdtHistory(app)` and applies updates with `applyRemoteHistoryUpdate`;
- merge preview uses JSON CRDT paths:
  - `CrdtPathSegment[][]`;
  - `getMetaAtPath`;
  - `materialize(meta)`;
  - synthetic restore updates via `{op: 'set' | 'delete', path, ts}`;
- protocol parsing validates updates with `createCrdtUpdateValidator(schema, {leafPlugins})`;
- presence/status overlays use JSON normal paths for todo/whiteboard UI affordances;
- migrations are schema-fingerprint based and replay JSON CRDT history through app migration code.

The branch graph itself is not the problem. The merge preview/revert UI is where the JSON model leaks the most.

## Current Block CRDT Shape

Block CRDT exports the primitives needed for a branch adapter:

- `State<M>` and `CachedState<M>` in `src/block-crdt/types.ts`;
- `Op<M>` in `src/block-crdt/types.ts`;
- `apply`, `applyMany`, `applyRemote`, `applyRemoteMany` in `src/block-crdt/apply.ts`;
- `validateOp` and `maxLamportCounterForOp` in `src/block-crdt/ops.ts`;
- `initialState` / `initialStateWithMeta` in `src/block-crdt/initialState.ts`;
- HLC-compatible timestamps as plain strings on block meta/order, char parent move versions, deletes, joins, marks, and style patches. Plain character insert ops are primarily Lamport-id based, so a block update event cannot assume every op has its own HLC timestamp.

The rich text demo currently has a small local two-replica runtime in `examples/block-rich-text/src/blockEditorRuntime.ts`:

- each replica stores `state: CachedState<RichBlockMeta>`;
- local changes produce `Array<Op<RichBlockMeta>>`;
- offline changes are queued as op batches;
- remote batches are applied with `applyMany(replica.state, ops, richTextCrdtConfig(replica.state))`;
- clocks are advanced by scanning timestamps in the full state.

This demo runtime is useful as the first block adapter sketch, but it has no branch log, persisted event indices, merge events, stale review, or server protocol.

## Proposed Extraction Boundary

Extract a branch-log core that is generic over document engine:

```ts
type BranchAdapter<THistory, TUpdate> = {
    createInitialHistory(): THistory;
    applyUpdate(history: THistory, update: TUpdate): THistory;
    applyUpdates?(history: THistory, updates: TUpdate[]): THistory;
    sameContents?(left: THistory, right: THistory): boolean;
    updateEventId?(update: TUpdate): string | undefined;
    validateUpdate?(input: unknown): TUpdate | null;
};
```

Then generic branch code can own:

- `Branch`;
- `UpdateEvent<TUpdate>`;
- `MergeEvent`;
- `BranchEvent<TUpdate>`;
- persisted branch metadata;
- `materializeBranch`;
- `eventsForBranchThrough`;
- `mergeSourceUpdatesForBranchThrough`;
- stale review metadata and state transitions;
- `blockedBranchesForReview`;
- generic branch switching and merge-event append logic.

The JSON CRDT adapter would map:

- `THistory = CrdtLocalHistory<TState>`;
- `TUpdate = CrdtUpdate`;
- `createInitialHistory = createInitialCrdtHistory(app)`;
- `applyUpdate = applyRemoteHistoryUpdate`;
- `updateEventId = latestCrdtUpdateTimestamp`.

The block CRDT adapter would map:

- `THistory = CachedState<M>` or a small wrapper such as `{state: CachedState<M>; undo?: ...}`;
- `TUpdate = Op<M>` or `Op<M>[]`.

There is a design choice here: store each block op as its own branch update event, or store a local command's op batch as one branch update event. For rich-text editing, batches are probably the right user-level event because a split/join/insert command can require multiple ops and should be reviewed, merged, and possibly undone as one unit. The generic adapter can support this by making `TUpdate` an opaque update payload; for block rich text, `TUpdate = Op<M>[]`.

## Merge Preview for Blocks

The current JSON merge preview has path-level revert:

- collect changed CRDT paths for source branch updates;
- build a merged preview;
- let the user toggle paths;
- create restore updates from the target-before document for reverted paths.

That does not translate directly to block CRDT. Block operations target logical block and character ids, not JSON paths. A block merge preview probably needs a block-native "change unit" abstraction.

Possible block change units:

- block inserted;
- block deleted/restored;
- block moved;
- block metadata changed;
- block style changed;
- text changed in block;
- mark changed;
- split/join changed block structure.

A minimal first version can skip path-level revert for blocks and still support branch merging:

- build `before`, `merged`, and `preview` histories;
- compute merge impact by applying source updates and checking whether state changed;
- allow accepting the whole merge through an event index;
- leave selective per-block/per-change revert for a later task.

If selective review is required in the first pass, add an adapter hook:

```ts
type MergePreviewAdapter<THistory, TUpdate, TChangeKey> = {
    changedKeysForUpdate(historyBefore: THistory, historyAfter: THistory, update: TUpdate): TChangeKey[];
    labelChangeKey(key: TChangeKey, history: THistory): string;
    createRevertUpdates(before: THistory, keys: TChangeKey[], clock: unknown): TUpdate[];
};
```

For blocks, `TChangeKey` should probably be a discriminated stable id, not an offset:

```ts
type BlockMergeChangeKey =
    | {kind: 'block'; blockId: string}
    | {kind: 'text'; blockId: string}
    | {kind: 'mark'; markId: string}
    | {kind: 'structure'; blockId: string; reason: 'split' | 'join' | 'move'};
```

The harder part is `createRevertUpdates`. Reverting block text or structural operations is not the same as restoring JSON metadata at a path. It may require block-specific inverse planning using tombstones, current visible text, retained char ids, split/join records, and style/meta LWW timestamps. That is why whole-merge accept is a safer first milestone.

## Server Protocol Implications

The existing server protocol bakes in JSON CRDT vocabulary:

- `clientUpdate.update: CrdtUpdate`;
- `parseServerMessage` validates with JSON schema and leaf plugins;
- migration protocol assumes schema fingerprint migrations over JSON CRDT app state.

For reusable branches, the protocol should make event payloads opaque to the branch server or tagged by engine:

```ts
type EngineId = 'json-crdt' | 'block-crdt';

type BranchUpdateEvent<TUpdate = unknown> = {
    kind: 'update';
    engine: EngineId;
    update: TUpdate;
    updateEventId: string;
    // existing doc/branch/event metadata...
};
```

The server can keep enforcing:

- document id;
- app id / engine id;
- schema or format version;
- unique update event id per branch;
- monotonic event indices;
- branch existence;
- merge source existence.

Update validation should move to an engine-specific validator registered by the app/server deployment. For block CRDT, validation can start with `validateOp` for each op in a batch plus an explicit branch-event id supplied by the sync layer. Full semantic validation still happens when applying with `applyRemoteMany`, because some dependencies can be missing until earlier ops arrive.

## Package/API Placement

Recommended package layout:

- `src/branches/`
  - generic branch types;
  - materialization;
  - stale review;
  - merge-source coverage and impact;
  - tests with a tiny fake adapter.
- `src/crdt/branches.ts` or `src/crdt/branchAdapter.ts`
  - JSON CRDT adapter.
- `src/block-crdt/branches.ts`
  - block CRDT adapter.
- optional later: `src/react-branches/`
  - React hooks/stores for branch sync without tying to JSON app definitions.

`package.json` would need exports such as:

- `umkehr/branches`;
- `umkehr/crdt/branches`;
- `umkehr/block-crdt/branches`.

Do not move the whole current `examples/react-crdt/src/lib/server/useServerSync.ts` into `src/` as-is. It mixes reusable logic with:

- browser WebSocket lifecycle;
- IndexedDB persistence;
- demo user identity;
- presence;
- todo/whiteboard status overlays;
- schema migration UI;
- React external stores.

Extract the branch model first. Then decide whether a generic React/server sync layer is worth productizing.

## Block CRDT API Gaps That Would Help

These are not blockers for generic branch logs, but they would make block branch UX cleaner:

1. `eventIdForBlockUpdate(ops, fallback)` or a documented recommendation that branch layers generate explicit event ids for block op batches.
   - Plain `char` insert ops do not carry HLC timestamps, so "latest op timestamp" is not enough for all block updates.
   - Branch event identity needs a stable id per op batch.

2. `applyBlockUpdate(history, update, config)` wrapper.
   - If block branch updates are op batches, callers should not repeat `applyMany(state, ops, richTextCrdtConfig(state))` everywhere.

3. Opaque block update validation.
   - `validateOp` exists, but branch protocol needs a batch-level validator and event-id policy.

4. A documented JSON serialization contract for `Op<M>` batches and `State<M>`.
   - `Lamport` arrays and LSEQ ids are JSON-compatible, but this should be explicit if branch events are persisted outside the example.

5. Optional block diff/change-key helpers.
   - Useful for merge preview labels and selective review.
   - Should operate on stable block/char/mark ids, not visible offsets.

## Implementation Strategy

Suggested phases:

1. Extract generic branch model and materialization from `examples/react-crdt/src/lib/server/materialize.ts`.
   - Keep JSON behavior unchanged via a JSON adapter.
   - Add adapter-level tests for recursive branch materialization and merge source coverage.

2. Extract stale review from `examples/react-crdt/src/lib/server/staleReview.ts`.
   - Parameterize on `THistory` / `TUpdate`.
   - Preserve the 5-minute default and existing behavior.

3. Add a block branch adapter.
   - Use `CachedState<M>` plus `Op<M>[]` batches.
   - Apply with `applyMany` and caller-provided `VirtualBlockParentConfig`.
   - Provide timestamp extraction for batches.

4. Add a focused non-React block branch test.
   - Create main.
   - Fork a branch.
   - Edit text on both sides.
   - Materialize each branch.
   - Merge branch into main.
   - Verify convergence and that merge events apply source updates through the selected event index.

5. Add stale review tests against the block adapter.
   - Pending local batch older than 5 minutes plus advanced server tip should block.
   - Completing review should replay pending ops on top of server state or fork them into a new branch.

6. Only after the model is stable, consider a block-rich-text demo/server integration.
   - The example can initially support whole-branch merge accept without selective per-block revert.

## Risks

- Selective merge review is much harder for block CRDT than JSON CRDT because there is no simple "restore value at path" operation.
- Block op batches need a reliable event id. Picking the first or last op timestamp may have edge cases when a command emits multiple timestamps.
- Block CRDT remote application can return pending/invalid for missing dependencies. Branch materialization currently assumes events are sorted well enough to apply strictly.
- Virtual parent config can be state-dependent (`richTextCrdtConfig(state)`), so the block adapter may need `configFor(history)` rather than a static config object.
- Existing server migration support is JSON-app-specific. Block branch support can avoid migration initially, but the protocol should not pretend the current schema migration flow is reusable as-is.
- Undo checkpoints in the JSON branch system reset `CrdtLocalHistory` after merge. Block undo/redo has separate docs and APIs; branch extraction should not assume JSON undo internals.

## Open Questions

1. Should block branch update events store a single `Op<M>` per event, or an `Op<M>[]` command batch per event?
   - Recommendation: batch per user command for useful history/review semantics.
   - yes

2. What should the canonical event timestamp be for an op batch?
   - Options: last timestamp when present, first timestamp when present, or explicit `eventId` generated by the branch layer.
   - Recommendation: use an explicit branch-layer event id because character insert batches may not include any HLC timestamp.

    - let's make an eventId

3. Is whole-branch merge accept enough for the first block CRDT release, or is selective per-block/per-change revert required?
   - Recommendation: ship whole-branch merge first, then design block-native selective review.

    - per-block merge, not per-change
    - reverse should also be 'revert this whole block'. smaller changes not necessary

4. Should branch machinery live in the published `umkehr` package, or remain example/internal until block server UX exists?

    - umkehr package

5. Should the generalized server accept opaque update JSON, or should it require an engine-specific validator on the server process?
   - Recommendation: keep the storage/protocol generic, but allow engine validators so bad payloads are rejected early.

    - validators sound nice

6. How should schema/version compatibility work for standalone block CRDT documents?
   - Block metadata types can evolve independently from JSON CRDT app schemas.

    - let's version the block-crdt package

7. How should pending block ops be handled when strict application reports missing dependencies?
   - The current branch materializer assumes event order is sufficient; block remote ops may need a pending queue or `applyRemoteMany` loop.

    - it should behave the same as the json crdt

8. Does block branch history need undo/redo integration immediately, or can branches and undo remain separate at first?

    - yes, undo/redo integration

9. Should branch merge events be represented inside block CRDT state, or remain outside as sync/history metadata?
   - Recommendation: keep them outside. They describe event-log provenance, not document content.

    - outside

10. Can presence/status APIs be generalized later, or should block users provide their own presence layer?
    - Recommendation: do not include presence in the first branch extraction.

    - we'll generalize it later

## Recommendation

Start by extracting the branch event graph and stale-review logic behind a small adapter interface. Keep JSON merge path preview as a JSON-specific extension. For block CRDT, implement branch creation, switching, materialization, merge events, and stale old-pending review using op batches as opaque updates. Defer selective block merge revert until there is a stable block-native change-key and inverse-update design.
