# Server branch history plan

This plan implements Approach 3 from `research.md`: branch event logs with merge inclusions.

The implementation should preserve the current CRDT semantics: branch order is server-assigned `eventIndex`; HLC timestamps remain CRDT payload metadata for field-level conflict resolution. Branches are collaborative workspaces, `main` is the default branch, branch names are unique per document but backed by stable ids, and all local branches should be persisted for offline use.

## Target model

### Server branch data

Replace the single document message log with document-level branches and branch event streams.

Core tables:

```sql
documents (
    docId text primary key,
    schemaFingerprint text not null
);

branches (
    docId text not null,
    branchId text not null,
    name text not null,
    nameKey text not null,
    sourceBranchId text,
    forkEventIndex integer,
    nextEventIndex integer not null,
    createdAt text not null,
    updatedAt text not null,
    primary key (docId, branchId),
    unique (docId, nameKey)
);

branch_events (
    docId text not null,
    branchId text not null,
    eventIndex integer not null,
    kind text not null,
    origin text,
    hlcTimestamp text,
    receivedAt text not null,
    payloadJson text not null,
    primary key (docId, branchId, eventIndex)
);
```

Event payloads:

```ts
type ServerBranchEvent =
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

Important invariants:

- Event order is `eventIndex`, never HLC timestamp sort.
- `main` is created automatically for each document.
- `update` event uniqueness should prevent duplicate CRDT updates within a branch, likely with `(docId, branchId, hlcTimestamp)` where `hlcTimestamp` is present.
- `merge` events do not copy source updates into the target branch.
- Revert/compensation operations are ordinary target-branch `update` events after a `merge` event.
- Snapshots are explicitly out of scope for the first implementation.

### Client persisted data

Move from one replica per document to a document replica with branch entries.

```ts
type PersistedServerReplica<TState> = {
    docId: string;
    storageVersion: 3;
    protocolVersion: 3;
    schemaFingerprint: string;
    activeBranchId: string;
    branches: Record<string, PersistedServerBranch<TState>>;
    branchList: ServerBranch[];
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

Local branch creation must work offline. Offline-created branches should be persisted locally with a client-generated stable `branchId`, a unique local name, a source branch id, and a fork event index. When the client reconnects, it publishes the branch creation before publishing events on that branch.

Offline update and merge events need provisional local ordering until the server assigns canonical `eventIndex` values. The client should keep local sequence ids for pending events, then reconcile them to server event indexes on ack. Rendered history can show pending events after the last acknowledged event, but persisted materialization should prefer server `eventIndex` whenever it exists.

## Phase 1: Server event log

1. Add server types for `ServerBranch`, `ServerBranchEvent`, update events, merge events, and branch summaries.
2. Update `ServerStore` schema:
   - migrate `documents` to remove `nextMessageIndex` dependency or ignore it for v3;
   - add `branches`;
   - add `branch_events`;
   - create `main` automatically in `ensureDocument`.
3. Add store methods:
   - `ensureDocument(docId, schemaFingerprint)`;
   - `ensureMainBranch(docId)`;
   - `listBranches(docId)`;
   - `createBranch({docId, sourceBranchId, forkEventIndex, name})`;
   - `renameBranch(...)`;
   - `appendUpdateEvent(...)`;
   - `appendMergeEvent(...)`;
   - `listEventsAfter(docId, branchId, afterEventIndex)`;
   - `listEventsThrough(docId, branchId, throughEventIndex)`.
4. Preserve user login and presence storage as-is.
5. Update `/debug` to show branches and recent branch events.

Verification:

- Unit-test store branch creation, duplicate branch names, event index assignment, update idempotency, merge event append, and `main` auto-creation.

## Phase 2: Protocol v3

Introduce protocol version `3` for branch events.

Client messages:

```ts
type ClientServerMessage =
    | {kind: 'hello'; version: 3; actor: string; userId: string; docId: string; schemaFingerprint: string}
    | {kind: 'branchSubscribe'; version: 3; actor: string; userId: string; docId: string; branchId: string; lastSeenEventIndex: number}
    | {kind: 'createBranch'; version: 3; actor: string; userId: string; docId: string; sourceBranchId: string; forkEventIndex: number; branchId?: string; name: string}
    | {kind: 'clientUpdate'; version: 3; actor: string; userId: string; docId: string; branchId: string; schemaFingerprint: string; hlcTimestamp: HlcTimestamp; update: CrdtUpdate}
    | {kind: 'mergeBranch'; version: 3; actor: string; userId: string; docId: string; targetBranchId: string; targetAtEventIndex: number; sourceBranchId: string; sourceThroughEventIndex: number}
    | {kind: 'presenceHello'; version: 3; actor: string; userId: string; docId: string; color: string};
```

Server messages:

```ts
type ServerClientMessage =
    | {kind: 'hello'; version: 3; docId: string; branches: ServerBranch[]}
    | {kind: 'branchSnapshot'; version: 3; docId: string; branches: ServerBranch[]}
    | {kind: 'branchUpdate'; version: 3; docId: string; branch: ServerBranch}
    | {kind: 'branchEvents'; version: 3; docId: string; branchId: string; events: ServerBranchEvent[]}
    | {kind: 'ack'; version: 3; docId: string; branchId: string; hlcTimestamp?: HlcTimestamp; eventIndex?: number; branchIdCreated?: string}
    | ExistingPresenceAndErrorMessages;
```

Server behavior:

- Broadcast branch metadata changes to all connected clients for the document.
- Broadcast branch content events only to clients subscribed to that branch.
- Presence should include the active branch id so every client can show who is viewing/editing each branch.
- Duplicate live sessions should continue to be rejected.

Verification:

- Protocol parse tests for every new message.
- Server integration smoke test with two clients on different branches: branch metadata reaches both; branch update events only reach subscribed clients.

## Phase 3: Branch materialization helper

Add a client-side helper in `examples/react-crdt/src/lib/server`:

```ts
function materializeBranch<TState>({
    app,
    branches,
    branchId,
    throughEventIndex,
}: {
    app: AppDefinition<TState>;
    branches: Record<string, PersistedServerBranch<TState>>;
    branchId: string;
    throughEventIndex?: number;
}): CrdtLocalHistory<TState>;
```

Rules:

- Replay events by ascending server `eventIndex`.
- For `update`, apply `applyRemoteHistoryUpdate`.
- For `merge`, recursively materialize/apply the source branch through `sourceThroughEventIndex` at that point.
- Track applied update HLC timestamps during one materialization pass to avoid redundant repeated-merge work.
- Reset undo/redo stacks after branch switches and after merge accept.

Open design choice:

- Start with client-side materialization. Keep the server protocol able to later expand merge inclusions if that becomes simpler for sync.

Verification:

- Tests for event-index ordering vs HLC timestamp ordering.
- Tests for merge event inclusion without copying updates.
- Tests for repeated merge idempotency.

## Phase 4: Client sync state

Refactor `useServerSync` around active branch state.

State changes:

- Replace `changesRef` with per-branch event refs.
- Replace `lastSeenRef` with per-branch `lastSeenEventIndex`.
- Track `activeBranchId`.
- Track branch metadata in an external store.
- Track pending local branch creations separately from pending update events.
- Track pending local update events by branch id.

Transport behavior:

- `transport.publish(updates)` appends pending local update events to the active branch only.
- `flushPending` must create offline-created branches before flushing their update events.
- `receiveServerEvents(branchId, events)` stores events in event-index order and only applies them to the mounted provider if `branchId === activeBranchId`.
- `switchBranch(branchId)` persists the current branch, materializes the target branch, replaces `currentHistory`, updates active branch presence, and subscribes to the target branch.

Offline behavior:

- Branch creation works offline.
- Offline branch edits are stored locally.
- Reconnect creates the branch remotely, then uploads its pending update events.
- Merge accept while offline can append a local merge event and local revert update events, then flush later.

Verification:

- Browser-side tests for switching active branch without applying non-active branch edits.
- Persistence tests for local branch creation and reload.
- Reconnect tests for pending branch creation followed by pending updates.

## Phase 5: Branch UI

Replace the debug-only `ServerHistoryView` with a branch/history panel.

Controls:

- Branch list with unique branch names and stable branch ids.
- Default `main` branch always visible.
- Active branch selector.
- Branch creation from a selected event index.
- Rename branch.
- Branch presence: show viewers/editors for all local and remote branches.
- History timeline ordered by server `eventIndex`, not HLC timestamp.

UI states:

- Show pending/offline local branches.
- Show unmirrored remote branches in the list.
- Opening a remote branch mirrors it locally.
- Disable or explain actions when required source branch content is not available yet.

Verification:

- Manual two-browser test:
  - create branch from main;
  - edit branch;
  - main viewer sees branch exists but not branch edits;
  - switch to branch and see edits;
  - reload preserves local branches.

## Phase 6: Merge preview and accept

Implement two merge modes:

- Live merge: source branch tip is frozen at preview start; target branch continues to move. Preview recomputes against the latest target branch state.
- Frozen merge: create a new branch from the target branch at a selected target event index, then merge into that new branch.

Preview:

1. Freeze `sourceBranchId` and `sourceThroughEventIndex`.
2. Determine target basis:
   - live: current target branch state, updated as target changes and including local pending target events;
   - frozen: selected target event index on the new branch.
3. Materialize target basis.
4. Apply source branch through `sourceThroughEventIndex`.
5. Compute changed CRDT paths and show them in a sidebar.
6. Allow users to check/uncheck paths to preview generated revert updates in the main UI.

Accept:

1. Preserve any existing pending target update events before the merge event.
2. Append a `merge` event to the target branch.
3. Append generated revert updates as normal `update` events after the merge event.
4. Reset the target branch undo stack.
5. Persist and sync the target branch.

Conflict/pending behavior:

- Pending target changes should not block merge.
- Applying events in server event order should provide relative causal order.
- Still surface any CRDT pending updates if they appear, but treat that as an implementation bug or malformed branch inclusion until proven otherwise.

Verification:

- Tests for live merge target movement.
- Tests for frozen merge branch creation.
- Tests for selective path revert generation.
- Manual test for merge into `main` from a branch with another user editing the target.

## Phase 7: Cleanup and compatibility

1. Bump server/browser protocol and IndexedDB storage versions.
2. Provide a clean migration path:
   - existing v2 replicas can be discarded/reinitialized for the example, or
   - map existing document messages to `main` update events.
3. Update README/manual testing notes for server branch mode.
4. Keep snapshots out of scope.
5. Keep full branch authorization out of scope; anyone can create, rename, archive, and merge for now.

## Test matrix

- Server store:
  - auto-create `main`;
  - unique branch names per doc;
  - branch rename;
  - branch create from source event index;
  - append update events in contiguous event indexes;
  - append merge events;
  - list events after index.
- Protocol:
  - parse/validate branch messages;
  - reject invalid actor/user id pairs;
  - reject invalid branch ids or event indexes.
- Client materialization:
  - server event order beats HLC timestamp order;
  - merge event includes source branch without copying updates;
  - repeated merge replay is idempotent;
  - undo stack resets after branch switch and merge accept.
- Sync:
  - active branch receives content events;
  - non-active branches receive metadata/presence but not applied content;
  - offline branch creation persists and flushes after reconnect.
- UI:
  - branch list and active branch switch;
  - history event selection;
  - branch presence across all branches;
  - live merge preview;
  - frozen merge preview;
  - selective CRDT-path revert preview.
