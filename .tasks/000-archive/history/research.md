# Server branch history research

This document looks at how to turn the server-mode history prototype into collaborative, branchable CRDT history for `examples/react-crdt/src/lib/server` and `examples/react-crdt-server`.

The requested behavior is:

- Users can move their view to an earlier point in document history, create a new branch, and keep editing from there.
- Users on the main branch should not see branch edits reflected in their active UI.
- Other users should learn that a branch exists and be able to switch to it.
- A branch can later be merged into another branch.
- Merge should show a preview and let the user revert selected changes. Revert means appending fresh CRDT updates, not deleting or rewriting old updates.

## Current Architecture

### Server document log

The Bun server is intentionally simple today:

- `examples/react-crdt-server/src/store.ts` stores one append-only `messages` table per `docId`.
- `documents` tracks `docId`, `schemaFingerprint`, and `nextMessageIndex`.
- `messages` are keyed by `(docId, messageIndex)` and have a unique `(docId, hlcTimestamp)`.
- `appendUpdate` assigns the next monotonically increasing server `messageIndex`.
- `listAfter(docId, lastSeenMessageIndex, excludeOrigin)` returns all messages after a linear cursor.
- `examples/react-crdt-server/src/index.ts` broadcasts every appended update to every connected client on the same `docId`, except the originating actor.

There is no branch identity in the server schema, protocol, or broadcast filter. The current `docId` effectively means "the whole shared timeline".

### Browser replica

The server-mode client stores a local durable replica in IndexedDB:

- `PersistedServerReplica` contains one `CrdtLocalHistory`, one `lastSeenMessageIndex`, and one flat `changes` array.
- `ServerChange` stores `{docId, timestamp, origin, source, update, recorded, messageIndex?, receivedAt}`.
- `useServerSync` maintains refs for the current CRDT history, last seen server message index, pending/local/remote changes, WebSocket state, presence, and statuses.
- Local edits enter through `SyncedTransport.publish`, become local `ServerChange`s, persist locally, and upload as `clientUpdate`.
- Remote updates arrive as `serverUpdates`, are stored in `changesRef`, then delivered to the React CRDT provider with `transport.receive(update)`.
- The active provider receives one `initial` history and updates internally. If the `initial` prop changes to a different object, the provider replaces its internal history and notifies subscribers.

Branch switching can therefore be implemented by replacing the mounted history object, but `useServerSync` must also swap its active branch state. It is not enough for `ServerHistoryView` to render a preview.

### History prototype

`ServerHistoryView` currently derives a preview by replaying `sync.changesStore` from `createInitialCrdtHistory(app)` through the selected timestamp. It is useful for debugging, but it has important limitations:

- It assumes one globally sorted timeline.
- It sorts local changes by HLC timestamp, while server catch-up uses server `messageIndex`.
- It only previews JSON state and does not affect the active editor.
- It cannot express branch ancestry, branch tips, merge bases, or per-branch sync cursors.

For server-backed branches, client materialization should not sort events by HLC timestamp. The server-assigned branch event index should be the canonical order for replay, history UI, branch creation points, and merge checkpoints. HLC timestamps remain CRDT payload metadata used by `applyCrdtUpdate` to resolve field-level conflicts.

### CRDT and undo/revert primitives

The CRDT layer is append-friendly:

- `CrdtUpdate` is one of `set`, `delete`, or `setOrder`.
- `applyCrdtUpdate` merges updates using HLC timestamps and can queue pending updates whose parents are missing.
- `applyRemoteHistoryUpdate` applies a CRDT update to `CrdtLocalHistory.doc` and leaves local undo/redo stacks intact.
- Local undo/redo already works by emitting fresh CRDT updates from stored before/after CRDT effects. It does not rewrite old updates.

This is the right conceptual model for merge reverts: a revert should be a normal branch edit with fresh timestamps that restores selected prior metadata/value state.

## Important Semantics

### Branches are named update streams, not separate documents

A branch should be a named update stream for a shared logical document. The document content for a branch is the result of replaying the branch's inherited base plus the updates recorded on that branch.

That implies a branch needs:

- stable branch id;
- display name;
- source branch id, if created from another branch;
- fork point, usually a branch-scoped server event index or equivalent branch tip marker;
- current branch tip marker;
- created/updated metadata;
- optionally owner and description.

Unlike Git, this does not require precise per-update parentage inside a branch. CRDT updates already carry conflict behavior through timestamps, CRDT paths, tombstones, and pending-update handling. The branch layer mostly needs to decide which update streams are visible in a given view, not reconstruct a full operation ancestry graph.

Within a server branch, event order should be the server-assigned `eventIndex`, not HLC timestamp order. This gives every client the same replay order, the same branch-point labels, and the same merge preview boundaries even when actors' HLC timestamps interleave differently from server arrival order.

### Branch subscribers and branch awareness are separate

The task says users on main should receive updates about another branch, but should not see those changes in main. That suggests two event classes:

- Branch metadata events: branch created, branch renamed, branch tip changed, branch deleted/archived.
- Branch content events: actual CRDT updates for the branch a user is actively mirroring/subscribed to.

For usability and efficiency, clients can always subscribe to branch metadata for a `docId`, while only mirroring content for selected branches.

### "Merge" should be an explicit branch operation

A merge is not just "make target look like source", because users need a preview and selective reverts. It should have a durable operation identity:

- source branch id;
- target branch id;
- source branch tip being merged;
- target branch tip used for preview;
- target branch event that records the merge inclusion;
- actor and timestamps.

This identity matters when the source branch receives more updates while a user is previewing or merging.

## Approach 1: Branches As Separate `docId`s

The smallest implementation is to encode branches as separate documents, for example `docId = "${baseDocId}@${branchId}"`.

Creating a branch:

1. Rebuild a snapshot/history at the selected point.
2. Create a new branch document id.
3. Store that snapshot locally and optionally on the server.
4. Send future edits to the branch document id.

Merging:

1. Load source branch tip and target branch tip.
2. Compute a preview by applying source updates or a diff-derived set of updates to target.
3. Apply generated CRDT updates to target.

Pros:

- Minimal changes to the current server broadcast logic.
- Existing `lastSeenMessageIndex` cursor model still works per branch document.
- Active UI isolation is easy because WebSocket messages are already filtered by `docId`.

Cons:

- It treats branches as separate documents, so the server cannot naturally answer "what branches exist for this document?" without a separate branch table anyway.
- Efficient storage is poor unless branch creation stores only fork metadata and inherited updates are addressed externally.
- Merge ancestry is ad hoc.
- Branch updates can duplicate a large prefix or require custom snapshot bootstrapping.
- Cross-branch presence, branch lists, and merge previews all become awkward bolt-ons.

Verdict: acceptable for a throwaway prototype, but it works against the requested Git-like model and does not answer the storage/open sync questions cleanly.

## Approach 2: Add `branchId` To The Existing Linear Log

This preserves the current append-only server message table but scopes messages by branch. A slightly better version renames these rows to branch events so merge markers can live in the same ordered stream:

```sql
branches(docId, branchId, name, sourceBranchId, forkEventIndex, createdAt, updatedAt)
branch_events(docId, branchId, eventIndex, kind, payloadJson, createdAt)
```

Each branch has its own linear cursor. Clients subscribe to one active branch and only receive events for that branch. Branch creation records a `forkEventIndex` in the source branch.

Creating a branch:

1. User selects a change in the current branch history.
2. Client sends `createBranch` with source branch id and selected source `eventIndex`.
3. Server creates a branch row.
4. Client materializes the new branch by replaying source-branch events through `forkEventIndex`, then applying new branch events.

Merging:

1. Compute source changes since the fork point.
2. Apply those updates to the target branch preview.
3. Append a merge marker and any generated revert updates to the target branch.

Pros:

- A manageable migration from the existing design.
- Easy for clients on main to avoid seeing branch edits.
- Easy to add branch list and active branch controls.
- Server branch cursors remain useful within each branch.

Cons:

- A single `forkEventIndex` is not enough by itself to avoid redundant work after repeated merges between the same branches.
- If a branch has already merged another branch, "changes since fork" needs merge records to stay well-defined.
- Applying a source branch inclusion to target can miss intent if target lacks parent updates referenced by CRDT paths, or can silently queue pending updates.
- Selecting a historical point by HLC timestamp is less robust than selecting a branch-scoped server event index.

Verdict: a good production-shaped direction if branch operations are explicit. It fits the CRDT model better than a Git-style per-update DAG because the branch layer controls visibility and merge checkpoints, while the CRDT layer handles update application.

## Approach 3: Branch Event Logs With Merge Inclusions

This keeps each branch as a linear event stream. Most events are CRDT updates; merge events are durable inclusions of another branch through a stable point.

```ts
type Branch = {
    docId: string;
    branchId: string;
    name: string;
    createdFrom?: BranchForkPoint;
    tipEventIndex: number;
    createdAt: string;
    updatedAt: string;
};

type BranchForkPoint = {
    branchId: string;
    eventIndex: number;
};

type BranchEvent =
    | {
          kind: 'update';
          docId: string;
          branchId: string;
          eventIndex: number;
          origin: string;
          hlcTimestamp: HlcTimestamp;
          receivedAt: string;
          update: CrdtUpdate;
      }
    | {
          kind: 'merge';
          mergeId: string;
          docId: string;
          branchId: string;
          eventIndex: number;
          sourceBranchId: string;
          sourceThroughEventIndex: number;
          actor: string;
          createdAt: string;
      };
```

The target branch does not copy source updates. A merge event means "when materializing this target branch, include the source branch through this source event index at this point in the target event stream." Any user-selected reverts are just normal `update` events that follow the merge event in the target branch.

If the server wants a separate relational shape, the same model can be split into tables:

```ts
type BranchUpdateEvent = {
    docId: string;
    branchId: string;
    eventIndex: number;
    updateJson: string;
};

type BranchMergeEvent = {
    docId: string;
    branchId: string;
    eventIndex: number;
    sourceBranchId: string;
    sourceThroughEventIndex: number;
    actor: string;
    createdAt: string;
};
```

The server does not need to know parentage for every update in a branch. A merge event freezes the source tip that was previewed. Repeated merges can include the same source prefix again; CRDT application should discard duplicate timestamps, and the materializer can later optimize by remembering already-applied branch ranges.

Pros:

- Matches the CRDT nature of the system: branch visibility is external to CRDT conflict resolution.
- Keeps the existing branch-local cursor model.
- Can identify the exact source tip used for a merge, even if source receives new updates later.
- Supports "branch was created from this historical branch tip" without copying snapshots.
- Supports future operations like branch delete/archive, merge history, and partial mirroring.

Cons:

- Materializing a branch now means interpreting merge events, not just replaying one flat update list.
- Repeated merges between two branches need either idempotent replay or range bookkeeping to avoid redundant work.
- If source updates depend on branch-only CRDT paths absent from target, applying them to target can still leave pending updates.

Verdict: this is the strongest model for this project. It keeps branch metadata explicit, avoids copying updates across branches, and does not pretend CRDT update streams need Git-like ancestry inside each branch.

## Approach 4: Snapshot-Backed Branch Tips With Incremental Logs

This combines either Approach 2 or 3 with periodic snapshots:

- Updates remain append-only and branch-addressed.
- Branch creation stores a fork point such as `{branchId, eventIndex}`.
- The server can occasionally store compacted branch snapshots.
- Clients materialize a branch from the newest usable snapshot, then replay remaining branch updates.

Pros:

- Avoids a full realized copy for every branch tip.
- Avoids replaying an unbounded root-to-tip log.
- Matches the existing local-first snapshot replay code shape.

Cons:

- Requires metadata to know which branch point a snapshot includes.
- Snapshot validation and schema fingerprinting need the same care as local-first migration.
- Compaction policy is a separate product/infra decision.

Verdict: not necessary for the first branch milestone, but the branch metadata should not prevent this. Store fork/tip event indexes from the start.

## Recommended Direction

Use branch-aware event logs. Avoid a per-update DAG unless a later requirement appears that cannot be expressed with branch-local event indexes, fork points, and merge inclusion events.

### Phase 1: Branch-aware server log

Add server concepts:

- default branch, probably `main`;
- `branches` table keyed by `(docId, branchId)`;
- branch update events and branch merge events;
- per-branch `eventIndex` or global event id plus branch-scoped indexes;
- branch metadata messages over WebSocket.

Protocol additions:

```ts
type ClientServerMessage =
    | ExistingMessages
    | {
          kind: 'branchSubscribe';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          lastSeenEventIndex: number;
      }
    | {
          kind: 'createBranch';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          sourceBranchId: string;
          forkEventIndex: number;
          name: string;
      }
    | {
          kind: 'mergeBranch';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          targetBranchId: string;
          targetAtEventIndex: number;
          sourceBranchId: string;
          sourceThroughEventIndex: number;
      }
    | {
          kind: 'clientUpdate';
          version: 3;
          actor: string;
          userId: string;
          docId: string;
          branchId: string;
          schemaFingerprint: string;
          hlcTimestamp: HlcTimestamp;
          update: CrdtUpdate;
      };
```

Clients should keep:

- branch metadata store;
- active branch id;
- per-branch local replica state;
- per-branch last seen cursor;
- pending uploads tagged with branch id.

`PersistedServerReplica` likely becomes document-level state with a map:

```ts
type PersistedServerReplica<TState> = {
    docId: string;
    storageVersion: 3;
    protocolVersion: 3;
    schemaFingerprint: string;
    activeBranchId: string;
    branches: Record<string, PersistedServerBranch<TState>>;
    updatedAt: string;
};

type PersistedServerBranch<TState> = {
    branchId: string;
    history: CrdtLocalHistory<TState>;
    lastSeenEventIndex: number;
    events: ServerBranchEvent[];
    mirrored: boolean;
};
```

Switching branches should:

1. pause or retarget active branch subscription;
2. persist current branch history;
3. ensure the target branch is materialized locally;
4. set active branch id and replace `currentHistory`;
5. trigger provider replacement via its `initial` prop;
6. request sync for the selected branch cursor.

### Phase 2: Branch creation from selected history point

The history UI should stop selecting by HLC timestamp and select by branch-scoped server event index or explicit local pending change id. A branch point needs to be unambiguous.

For recorded changes:

- use `eventIndex` on the active branch.
- create the branch with `forkEventIndex`.
- materialize initial branch history by replaying active branch changes through that index.

For pending local changes:

- either disallow branch creation until pending uploads are acknowledged;
- or allow a local-only branch whose fork point includes pending local changes, then upload branch creation after those changes are recorded.

The simpler first behavior is to disable branch creation from unrecorded changes and show why.

### Phase 3: Merge preview

For a constrained first merge, define:

- source branch tip = source branch current recorded event index at the time preview starts;
- target branch tip = target branch current recorded event index at the time preview starts;
- pending source or target edits are not included unless explicitly flushed/acknowledged first.

Preview algorithm:

1. Materialize target history at the target tip.
2. Identify source branch changes since the source branch fork point or since the last merge base recorded between source and target.
3. Apply those source CRDT updates to a copy of the target history with `applyRemoteHistoryUpdate`.
4. Track skipped or still-pending updates. Surface them in the UI because the preview may be incomplete.
5. Compute a value/meta diff between target preview before and after merge.
6. Let the user mark individual changed paths as reverted.

Accept algorithm:

1. Append one `merge` event to the target branch that includes the frozen source branch tip.
2. Generate fresh CRDT updates for selected reverts using current target+merge preview state.
3. Append those revert updates as ordinary target-branch `update` events after the merge event.

The target branch does not copy source updates. Materializing the target branch interprets the merge event by applying the source branch through the recorded source event index, then applies the target branch's later update events. If the same source update is encountered again through repeated merges, CRDT timestamp rules should make it idempotent; a later optimization can skip already-applied branch ranges.

### Phase 4: Selective revert generation

The undo code already has the right pattern but its helpers are local-command-private. For merge reverts, we likely need a reusable CRDT helper:

```ts
function createRestoreUpdates<TState>({
    before,
    after,
    paths,
    clock,
}: {
    before: CrdtDocument<TState>;
    after: CrdtDocument<TState>;
    paths: CrdtPathSegment[][];
    clock: hlc.HLC;
}): {updates: CrdtUpdate[]; clock: hlc.HLC};
```

Conceptually:

- `before` is the target state before merge preview.
- `after` is the merged preview.
- selected revert paths should restore metadata/value from `before` into `after` using fresh timestamps.
- if a selected path did not exist before, emit a delete.
- if a selected path was deleted by merge, restore prior meta/value.
- array order reverts need order metadata, not just item values.

This is more robust than diffing JSON alone because CRDT paths and array item ids are needed for stable revert updates.

## Sync Policy Recommendation

Use three levels:

- Always sync branch metadata for the current `docId`.
- Mirror content for the active branch.
- Optionally mirror content for explicitly subscribed branches.

This matches the user's "remote branches I have not mirrored locally" intuition. The UI can show remote branches immediately without downloading all branch contents.

Initial policy:

- active branch is always mirrored;
- branch list is always live;
- non-active branches show remote tip metadata but no local preview until opened;
- merge preview fetches the needed source branch content on demand.

## Storage Efficiency

Do not store a full realized snapshot for every branch tip as the primary representation. Store:

- branch metadata;
- append-only branch events;
- local materialized cache for mirrored branches;
- optional snapshots for acceleration.

The browser can cache `CrdtLocalHistory` for active/mirrored branches because that is an implementation cache. The server should treat snapshots as optional acceleration, not the source of truth.

For the first milestone, storing one local `CrdtLocalHistory` per mirrored branch is acceptable. It answers UI responsiveness and keeps implementation smaller. The server can stay update-log-first.

## Risks

- CRDT updates are not operation-intent-rich enough to merge like Git text merges. Applying source updates to a divergent target is LWW/path-based CRDT composition, not a semantic three-way merge.
- HLC timestamp ordering is not branch topology. Use branch-scoped server event indexes for branch points and merge checkpoints.
- Pending local changes make branch creation and merge previews ambiguous. The first version should require clean recorded branch tips for branch/merge operations.
- Provider branch replacement is feasible, but `useServerSync` must update `historyRef`, `changesRef`, `lastSeenRef`, stores, and active branch id together.
- Undo/revert helpers are currently not exposed as a general "restore selected CRDT paths" API.
- Existing protocol version is `2`; branch work is a protocol and storage breaking change.

## Open Questions

- Should branch names be globally unique per document, or can multiple branches share a display name with stable ids underneath?
  - unique per document, but they should be renamable, so we want a stable id
- Is `main` special, or just the first branch?
  - yeah let's always call the default branch 'main'
- Who can create, rename, archive, or merge branches?
  - anyone for now
- Are branches collaborative workspaces where multiple users can edit the same branch concurrently?
  - definitely
- Should branch presence be per active branch only, or should users see who is viewing/editing each branch in the branch list?
  - ooh yeah let's show it for all branches (local&remote)
- Should branch creation from pending local changes be blocked, or should the app support local-only branches?
  - branch creation should definitely work while offline
- During merge preview, should the source tip be frozen automatically, or should users explicitly choose "merge source at event X"?
  - the user should have the option between a live merge, where the "source" branch is frozen but the "target" branch is not, or a frozen merge, which creates a new branch off of the target branch at a certain tip, and then merges into that new branch
- Should target pending changes block merge, or can merge preview include local unrecorded target changes?
  - should not block merge
- Should clients materialize merge events themselves, or should the server expand merge inclusions when streaming a branch?
  - not sure what's best here
- How should the UI present CRDT conflicts or pending updates that could not apply because their parents are absent on the target?
  - if we're applying events in relative causal order, I don't think that's possible
- What granularity should selective revert support: whole update, changed normal path, todo row, or arbitrary CRDT path?
  - not sure about this. I think I want maybe the list of changed crdt paths to be displayed in a sidebar, and the user can check/uncheck them to see what reverting that change would look like in the UI
- Do merge reverts need to be individually undoable as local commands in the target branch undo stack?
  - no. post-merge, the undo stack should probably reset
- How much branch content should be mirrored automatically for offline use?
  - all local branches should be persisted
- When should server snapshots be introduced, and are they trusted server state or just cache artifacts?
  - let's hold off on snapshots for now


## Suggested First Milestone

Build a branch-aware version of the current server mode with deliberately narrow semantics:

- one default `main` branch;
- branch metadata synced to all clients for a `docId`;
- active branch content synced only for the active branch;
- branch creation only from recorded active-branch history points;
- local IndexedDB cache per mirrored branch;
- switch branch by replacing provider initial history;
- merge preview only between clean recorded branch tips;
- selective revert tracked at changed-path granularity;
- merge accept appends a merge event plus generated revert update events to the target branch;
- branch/merge operations disabled while the active branch has pending uploads.

That path keeps the implementation aligned with the current architecture while making the major semantic decisions explicit and testable.
