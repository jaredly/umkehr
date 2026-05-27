# Local-first mode implementation plan

This plan adds a new `local-first` mode to `examples/react-crdt`. It should live alongside the existing `solo`, `local`, and `peerjs` modes. Do not turn the current `peerjs` mode into the local-first implementation; keep `peerjs` as the simpler network transport demo.

The new mode should demonstrate a real local-first browser replica: durable identity, durable CRDT history, retained update batches, dedupe, reconnect catch-up, and eventually mesh sync and compaction.

## Current refactor shape

The example now has useful runtime boundaries:

- `examples/react-crdt/src/lib/crdtApp.ts` defines `AppDefinition`, `CrdtRuntime`, and `HistoryRuntime`.
- `examples/react-crdt/src/App.tsx` chooses between `SoloApp`, `LocalSimulatorApp`, and `PeerJsApp`.
- `examples/react-crdt/src/lib/useHashMode.ts` owns hash routing.
- `examples/react-crdt/src/lib/ModeTabs.tsx` renders the mode switch.
- `examples/react-crdt/src/lib/solo/*` owns the non-CRDT history demo.
- `examples/react-crdt/src/lib/local/*` owns the in-memory two-replica simulator.
- `examples/react-crdt/src/lib/peerjs/*` owns the current simple PeerJS host/client demo.
- `examples/react-crdt/src/apps/*` owns app-specific schema, validation, initial state, and panels.

The local-first work should slot into that structure as a separate runtime shell:

- `examples/react-crdt/src/lib/local-first/*`

Use the existing `CrdtRuntime<TState>` and `AppDefinition<TState>` contracts so the mode remains app-generic.

## Product scope

Add a fourth mode:

- hash: `#local-first`
- tab label: `Local-first`
- component: `LocalFirstApp`

The current modes should keep their semantics:

- `solo`: single-replica undo/history demo.
- `local`: deterministic side-by-side in-memory CRDT simulator.
- `peerjs`: simple host/client PeerJS snapshot and live-update demo.
- `local-first`: persistent local-first replica with PeerJS connectivity and retained logs.

The new mode can reuse PeerJS as a signaling/data-channel mechanism, but its sync protocol, storage, and UI should live under `lib/local-first`, not mutate the existing `lib/peerjs` protocol in place.

## Decisions from research

- `CrdtLocalHistory` may be treated as a public serializable structure for this example.
- HLC actor/counter parsing may be treated as stable enough for version-vector helpers.
- CRDT update origin can be derived from update timestamps for now. Keep network batch `origin` too for dedupe, forwarding, and diagnostics.
- Do not attempt schema migrations in this pass. Reject incompatible persisted documents and require reset/replacement.
- If a peer reconnects after the room compacted beyond its retained log, do not replace state automatically. Let the user preview replaying local edits with new timestamps, then choose discard or rebase.
- A tiny IndexedDB dependency is acceptable. Prefer `idb` unless the project adopts another browser storage helper first.

## Routing and shell changes

Update mode routing:

- `examples/react-crdt/src/lib/useHashMode.ts`
  - change `AppMode` to `'solo' | 'local' | 'peerjs' | 'local-first'`;
  - parse `#local-first`;
  - keep unknown hashes falling back to `local`.
- `examples/react-crdt/src/lib/ModeTabs.tsx`
  - add a `Local-first` tab;
  - keep `PeerJS` tab pointing to the current simple mode.
- `examples/react-crdt/src/App.tsx`
  - import `LocalFirstApp` from `./lib/local-first/LocalFirstApp`;
  - render it when `mode === 'local-first'`;
  - pass `defaultApp` and `defaultCrdtRuntime`, matching `PeerJsApp` and `LocalSimulatorApp`.

Acceptance criteria:

- `#peerjs` still renders the existing `PeerJsApp`.
- `#local-first` renders the new local-first shell.
- The new tab does not affect `solo` or `local`.

## Local-first file map

Create these files:

- `examples/react-crdt/src/lib/local-first/LocalFirstApp.tsx`
- `examples/react-crdt/src/lib/local-first/LocalFirstControls.tsx`
- `examples/react-crdt/src/lib/local-first/useLocalFirstSync.ts`
- `examples/react-crdt/src/lib/local-first/protocol.ts`
- `examples/react-crdt/src/lib/local-first/types.ts`
- `examples/react-crdt/src/lib/local-first/persistence.ts`
- `examples/react-crdt/src/lib/local-first/vector.ts`
- `examples/react-crdt/src/lib/local-first/schemaFingerprint.ts`
- `examples/react-crdt/src/lib/local-first/recentBatchCache.ts`

Keep `examples/react-crdt/src/lib/peerjs/*` as the existing toy/simple PeerJS mode. If useful, later extract tiny shared utilities into `examples/react-crdt/src/lib/network/*`, but do not start by coupling the two modes.

Consider generic library helpers only for CRDT/HLC operations:

- timestamp extraction from `CrdtUpdate`;
- HLC actor extraction;
- timestamp range helpers.

Do not move IndexedDB, PeerJS, rooms, or local-first protocol envelopes into `src/crdt`.

## Core local-first types

Add these under `lib/local-first/types.ts`:

```ts
export type LocalFirstRole = 'host' | 'client';

export type VersionVector = Record<string, HlcTimestamp>;

export type ReplicaIdentity = {
    replicaId: string;
    createdAt: string;
};

export type PersistedReplica<TState> = {
    docId: string;
    storageVersion: 1;
    protocolVersion: 1;
    schemaFingerprint: string;
    replicaId: string;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
    updatedAt: string;
};

export type PersistedBatch = {
    docId: string;
    batchId: string;
    origin: string;
    updates: CrdtUpdate[];
    minTs?: HlcTimestamp;
    maxTs?: HlcTimestamp;
    vectorAfter: VersionVector;
    receivedAt: string;
};

export type ReceivedBatch = {
    docId: string;
    origin: string;
    batchId: string;
    receivedAt: string;
};
```

Use `history`, not only `document`, so reload-stable undo/redo is part of the mode.

## Phase 1: persistent local replica

Add dependency:

- `examples/react-crdt/package.json`: add `idb`.

Implement `lib/local-first/persistence.ts`:

- open an IndexedDB database such as `umkehr-react-crdt-local-first`;
- create stores for `identity`, `replicas`, `batches`, and `receivedBatches`;
- expose `loadOrCreateIdentity()`;
- expose `loadReplica(docId)`, `saveReplica(replica)`, `clearReplica(docId)`;
- expose `appendBatch(batch)`, `listBatches(docId)`, `countBatches(docId)`;
- expose `hasReceivedBatch(docId, origin, batchId)` and `markReceivedBatch(...)`;
- expose reset/export/import helpers for UI/testing.

Indexes:

- `replicas` keyed by `docId`;
- `batches` keyed by `${docId}:${origin}:${batchId}`;
- `batches` indexed by `docId`;
- `receivedBatches` keyed by `${docId}:${origin}:${batchId}`.

Implement `schemaFingerprint.ts`:

- stable stringify the app schema root, components, and `tagKey`;
- store fingerprint in `PersistedReplica`;
- reject incompatible persisted documents and show a reset path.

Implement `LocalFirstApp` first without networking:

- load stable identity before mounting `runtime.Provider`;
- use `identity.replicaId` as `transport.actor`;
- load persisted `CrdtLocalHistory` for `runtime.docId`;
- if none exists, create one with `createInitialCrdtHistory(app)` and persist it;
- pass a `save(history)` callback to `runtime.Provider`;
- render `app.renderPanel({actor, editor, title})`;
- show persistence status in `LocalFirstControls`.

For this first slice, a no-op transport is acceptable except for HLC ticking:

- `publish(updates)` should append local batches and persist state;
- `subscribe()` can register listeners for later remote delivery;
- `tick()` should use a durable actor id.

Acceptance criteria:

- `#local-first` opens a single editable replica.
- Reload preserves actor id, document state, and undo/redo stacks.
- Role and PeerJS concepts are not required for offline editing.
- Incompatible schema blocks automatic load and offers reset.

## Phase 2: retained batches and dedupe

Still before full reconnect sync, make every local and remote batch durable.

Implement `vector.ts`:

- extract all timestamps from a `CrdtUpdate`;
- derive actor from HLC timestamp actor segment;
- compute batch `minTs` and `maxTs`;
- advance a vector from all update timestamps in a batch;
- compare vectors with `dominates`;
- merge vectors.

Implement `recentBatchCache.ts`:

- small in-memory LRU keyed by `${docId}:${origin}:${batchId}`;
- use it as a fast path before IndexedDB `receivedBatches`.

Local publish path:

- create a `PersistedBatch` with `origin = replicaId`;
- compute timestamp range and `vectorAfter`;
- append the batch to IndexedDB before network send;
- persist the updated replica vector/history;
- keep the batch id stable forever.

Inbound batch path:

- reject duplicate `{docId, origin, batchId}` using LRU plus IndexedDB;
- apply updates through the synced provider listener path;
- mark batch as received;
- append the original batch to the retained log;
- persist replica state and vector;
- never re-origin a forwarded batch.

Acceptance criteria:

- Local edits create retained batches.
- Duplicate batch delivery is ignored.
- Reloaded replicas still reject already received batches.
- Batch origin and batch id survive forwarding.

## Phase 3: local-first PeerJS protocol

Implement a separate protocol in `lib/local-first/protocol.ts`.

Do not bump or replace `lib/peerjs/protocol.ts`.

Messages:

```ts
type LocalFirstMessage<TState> =
    | {
          kind: 'hello';
          version: 1;
          actor: string;
          peerId?: string;
          docId: string;
          role: LocalFirstRole;
          vector: VersionVector;
      }
    | {
          kind: 'updates';
          version: 1;
          actor: string;
          docId: string;
          batch: PersistedBatch;
      }
    | {
          kind: 'syncRequest';
          version: 1;
          actor: string;
          docId: string;
          vector: VersionVector;
      }
    | {
          kind: 'syncResponse';
          version: 1;
          actor: string;
          docId: string;
          since: VersionVector;
          batches: PersistedBatch[];
          requiresSnapshot?: boolean;
      }
    | {
          kind: 'snapshot';
          version: 1;
          actor: string;
          docId: string;
          document: CrdtDocument<TState>;
          compactedThrough: VersionVector;
      };
```

Validation:

- validate envelope version, doc id, actor, and vector shapes;
- validate update batches with `createCrdtUpdateValidator(app.schema)`;
- validate snapshots with the same CRDT metadata checks as the current `peerjs` protocol, adapted locally;
- validate schema fingerprint at the persistence layer before accepting persisted state.

Acceptance criteria:

- Protocol validation is independent from current PeerJS mode.
- Invalid messages are rejected without changing local state.

## Phase 4: host/client connectivity in local-first mode

Implement `useLocalFirstSync.ts` with PeerJS internally.

It should return:

```ts
type LocalFirstSync<TState> = {
    transport: SyncedTransport;
    stateStore: ExternalStore<LocalFirstSyncState>;
    connectionsStore: ExternalStore<LocalFirstConnectionInfo[]>;
    persistenceStore: ExternalStore<LocalFirstPersistenceState>;
    connect(peerId: string): void;
    disconnect(peerId: string): void;
    requestSync(peerId?: string): void;
    resetLocalReplica(): Promise<void>;
};
```

Connection behavior:

- role can remain `host`/`client` for invite UX, but both roles are durable replicas;
- host does not own the only valid document state;
- each peer sends `hello` with its vector on open;
- each peer sends `syncRequest` after hello;
- live updates are sent as persisted batches;
- host may forward batches to other connected clients, preserving origin and batch id.

Initial local-first UX:

- if no invite is present, default to host role and show an invite PeerJS id;
- if `?peer=...` is present, default to client role and auto-connect when ready;
- unlike the current `peerjs` mode, a client with persisted state should mount immediately and sync when connected;
- a client without persisted state may accept a snapshot from the connected peer.

Acceptance criteria:

- Host-star networking works in `#local-first`.
- Both host and client can edit offline before connecting.
- Reconnection exchanges missing retained batches rather than requiring a fresh snapshot.
- Existing `#peerjs` behavior remains unchanged.

## Phase 5: reconnect catch-up

Sync flow:

1. On `open`, both peers send `hello` with vector.
2. On receiving `hello`, send `syncRequest` with local vector.
3. On receiving `syncRequest`, query retained batches not dominated by the request vector.
4. If logs are available, send `syncResponse` with missing batches.
5. Receiver applies each batch through the same dedupe path as live `updates`.
6. If applying response batches advances the local vector, optionally send another `syncRequest`.

Retained batch query:

- a batch is missing if the request vector does not dominate all actors/timestamps in that batch;
- inspect every update timestamp, not only batch max;
- if logs before `compactedThrough` are needed but missing, return `requiresSnapshot`.

Acceptance criteria:

- Peer A edits offline, reconnects, and Peer B catches up from retained batches.
- Peer B edits offline, reconnects, and Peer A catches up from retained batches.
- Reconnect does not require a full snapshot when retained logs are sufficient.

## Phase 6: snapshot and compacted-peer policy

Snapshot rules:

- If receiver has no local persisted replica, accept a validated snapshot.
- If receiver has a local persisted replica with matching schema, prefer local state and request missing batches.
- If sender cannot provide missing batches because compaction removed them, enter a recoverable state.
- Never silently replace local state when local state has offline edits.

Recoverable state:

- `kind: 'needs-rebase-or-discard'`;
- show local vector, remote compacted frontier, and retained local batch count;
- actions:
  - discard local copy and accept remote snapshot;
  - preview replay/rebase local edits with new timestamps.

Rebase preview:

- use retained local batches after the receiver's last shared/compacted frontier;
- recreate updates with fresh timestamps where possible;
- apply them to the remote snapshot in memory;
- show before/after preview;
- persist only after user confirmation.

For the first implementation, the preview may be todo-specific in presentation, but the sync state should remain generic.

Acceptance criteria:

- New replica can bootstrap from snapshot.
- Existing persisted replica does not get overwritten by snapshot.
- Missing-log situations require explicit discard or rebase.

## Phase 7: UI diagnostics

Implement `LocalFirstControls.tsx`.

Show:

- stable replica id;
- transient PeerJS id;
- role;
- document id;
- schema fingerprint prefix;
- persistence load/save/error status;
- local vector summary;
- retained batch count;
- received batch count;
- pending update count from `history.doc.pending.length`;
- connected peers with PeerJS id, actor id, role, vector, open state, queued outgoing count, and last sync time.

Controls:

- host/client role switch for invite UX;
- connect to peer id;
- copy invite URL for `#local-first?peer=...` or equivalent current URL shape;
- manually request sync;
- reset local replica;
- export local state as JSON;
- import local state as JSON with validation;
- later: compact retained log.

Acceptance criteria:

- A developer can tell whether the replica is loaded from persistence, waiting for snapshot, or syncing.
- Duplicate rejection, retained batch count, and pending count are visible enough to debug protocol mistakes.

## Phase 8: optional mesh

Only start after host-star local-first sync is stable.

Add membership message:

```ts
type MembersMessage = {
    kind: 'members';
    version: 1;
    actor: string;
    docId: string;
    members: Array<{
        peerId: string;
        actor: string;
        role: LocalFirstRole;
        vector: VersionVector;
    }>;
};
```

Behavior:

- host shares connected member list;
- clients optionally connect directly to other clients;
- every direct connection runs the same `hello` and `syncRequest` flow;
- live batches may be forwarded over mesh after dedupe;
- preserve original `origin` and `batchId`;
- never forward a batch back to the connection it arrived on.

Acceptance criteria:

- Three peers converge if the host leaves after direct connections are established.
- Duplicate forwarding in mesh does not grow retained logs or reapply updates.

## Phase 9: compaction

Add manual sync-log compaction only after vectors and snapshot catch-up are stable.

Compaction flow:

1. Compute a proposed `compactedThrough` vector.
2. Persist current document as the base snapshot/frontier.
3. Delete retained batches dominated by `compactedThrough`.
4. Keep batches after the frontier.
5. Serve snapshot plus post-frontier batches to peers behind the frontier.

Tombstones:

- keep tombstones by default;
- do not implement automatic tombstone GC in the first compaction pass;
- later, only remove tombstones proven stable across the configured active peer set.

Undo/redo:

- keep local undo/redo compaction separate from sync-log compaction;
- initially cap persisted local undo commands, for example to the latest 100;
- if future tombstone compaction removes metadata that undo needs, drop affected undo entries.

Acceptance criteria:

- Manual compaction reduces retained batch count.
- A fresh peer can still join from snapshot plus post-compaction batches.
- A peer behind the frontier is prompted for discard/rebase instead of corrupting local state.

## Tests

Pure helper tests:

- local-first protocol validation;
- schema fingerprint stability;
- HLC timestamp actor extraction;
- version-vector merge/dominance;
- batch range calculation;
- duplicate batch key handling.

Storage tests:

- persisted identity survives reload/open-close;
- persisted `CrdtLocalHistory` survives reload/open-close;
- retained batches survive reload/open-close;
- duplicate received batch is ignored after reload/open-close;
- incompatible schema fingerprint blocks load.

Sync state tests:

- local publish appends batch before send;
- inbound batch applies, persists, and forwards once;
- reconnect sync request returns missing batches;
- compacted-missing-log path enters `needs-rebase-or-discard`.

If real PeerJS tests are too heavy, extract a transport-independent local-first sync state machine and test it without WebRTC.

## First implementation slice

Implement this first:

1. Add `local-first` hash mode and tab.
2. Add `LocalFirstApp` as a single persistent CRDT replica.
3. Add `idb` and IndexedDB persistence.
4. Persist stable replica identity and `CrdtLocalHistory`.
5. Persist retained local batches from local edits.
6. Show identity, persistence state, vector, retained batch count, and pending count in `LocalFirstControls`.
7. Add unit tests for schema fingerprinting and vector helpers.

Stop before PeerJS connectivity in the first slice if needed. The key architectural point is that `local-first` starts as its own durable mode, not as a mutation of the existing `peerjs` demo.

The second slice should add local-first PeerJS connectivity, retained remote batches, duplicate rejection, and reconnect catch-up.
