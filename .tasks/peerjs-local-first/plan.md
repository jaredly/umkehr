# PeerJS local-first implementation plan

This plan turns `examples/react-crdt` PeerJS mode into a real local-first example while keeping the reusable `umkehr` packages free of PeerJS, IndexedDB, and room-specific assumptions.

The immediate milestone is durable host-star sync with persisted replicas, retained update batches, and duplicate rejection. Version-vector catch-up, mesh, and compaction build on that foundation.

## Decisions from research

- `CrdtLocalHistory` may be treated as a public serializable structure for this example.
- HLC actor/counter parsing may be treated as stable enough for version-vector helpers.
- CRDT update origin can be derived from update timestamps for now. Keep network batch `origin` too, because it is useful for dedupe, forwarding, and UI diagnostics.
- Do not attempt schema migrations in this pass. Reject incompatible persisted documents and require reset/replacement.
- If a peer reconnects after the room compacted beyond its retained log, do not replace state automatically. Let the user preview replaying local edits with new timestamps, then choose discard or rebase.
- A tiny IndexedDB dependency is acceptable. Prefer `idb` unless the project already adopts another browser storage helper.

## Target architecture

Keep this split:

- `examples/react-crdt/src/lib/peerjs/*`: generic PeerJS local-first sync infrastructure.
- `examples/react-crdt/src/lib/crdtApp.ts`: generic app contract.
- `examples/react-crdt/src/apps/*`: app-specific schema, validation, initial document, and panel rendering.
- `src/crdt/*`: small generic CRDT helpers only when they are not PeerJS or IndexedDB specific.

The PeerJS layer should own:

- durable replica identity;
- durable document state;
- retained update batches;
- received-batch dedupe;
- version-vector sync;
- snapshot/log catch-up;
- PeerJS connection routing and forwarding;
- local-first diagnostics in the example UI.

## New shared types

Add generic sync types under `examples/react-crdt/src/lib/peerjs/localFirstTypes.ts`:

```ts
export type VersionVector = Record<string, HlcTimestamp>;

export type ReplicaIdentity = {
    replicaId: string;
    createdAt: string;
};

export type PersistedReplica<TState> = {
    docId: string;
    storageVersion: 1;
    protocolVersion: 2;
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

Use `history`, not only `document`, because reload-stable undo/redo is part of the desired example behavior.

## Phase 1: IndexedDB persistence and stable identity

Add dependency:

- `examples/react-crdt/package.json`: add `idb`.

Add storage module:

- `examples/react-crdt/src/lib/peerjs/persistence.ts`

Responsibilities:

- open an IndexedDB database such as `umkehr-react-crdt-peerjs-local-first`;
- create object stores for `identity`, `replicas`, `batches`, and `receivedBatches`;
- expose `loadOrCreateIdentity()`;
- expose `loadReplica(docId)`, `saveReplica(replica)`, `clearReplica(docId)`;
- expose `appendBatch(batch)`, `listBatches(docId)`, `countBatches(docId)`;
- expose `hasReceivedBatch(docId, origin, batchId)` and `markReceivedBatch(...)`;
- expose a reset helper for UI/testing.

Indexes:

- `replicas` keyed by `docId`;
- `batches` keyed by `${docId}:${origin}:${batchId}`;
- `batches` indexed by `docId`;
- `receivedBatches` keyed by `${docId}:${origin}:${batchId}`.

Add schema fingerprinting:

- create a stable stringify helper for app schema and components;
- compute `schemaFingerprint` from `app.schema.schemas[0]`, `app.schema.components`, and `app.tagKey`;
- if persisted fingerprint does not match, surface an incompatible-state UI and require reset.

Change `PeerJsApp`:

- stop generating `actor` from role;
- load stable identity before mounting the provider;
- use `identity.replicaId` as `actor`;
- load persisted `CrdtLocalHistory` for the app `docId`;
- if no persisted history exists and role is host, create initial history and persist it;
- if no persisted history exists and role is client, keep the current "waiting for snapshot" flow;
- pass a save callback into `Provider` so local history changes can be persisted.

Acceptance criteria:

- Host reload keeps actor id, document, undo/redo stacks, and visible todos.
- Client reload keeps actor id and its local document once it has joined.
- Role changes do not change actor id.
- Incompatible persisted schema blocks automatic load and offers reset.

## Phase 2: retained batches and duplicate rejection

Update the transport flow so every update batch has durable identity before network send.

Protocol changes in `examples/react-crdt/src/lib/peerjs/protocol.ts`:

- bump `PEER_PROTOCOL_VERSION` to `2`;
- add `vector` to `hello`;
- add `origin` and `vectorAfter` to `updates`;
- validate `origin`, `batchId`, and `vectorAfter`;
- keep `batchId` stable when forwarding.

Transport changes in `usePeerJsSync.ts`:

- replace `createUpdatesMessage(actor, docId, updates)` with a function that receives a durable `PersistedBatch`;
- local `publish(updates)` should:
  - compute batch timestamps and vector;
  - append the batch to IndexedDB;
  - persist the updated replica vector/history;
  - send the persisted batch to connected peers;
- inbound `updates` should:
  - validate the message;
  - reject if `{docId, origin, batchId}` was already received;
  - apply updates locally;
  - mark batch as received;
  - append the batch to the retained log;
  - persist replica state;
  - forward the same batch if this peer is acting as host.

Important forwarding rule:

- do not create a new batch id when forwarding;
- do not change `origin`;
- do not forward back to the same connection.

Add a small in-memory recent-batch LRU:

- key: `${docId}:${origin}:${batchId}`;
- purpose: avoid repeated IndexedDB reads under forwarding loops;
- persisted `receivedBatches` remains authoritative across reload.

Acceptance criteria:

- Delivering the same network batch twice does not append or apply it twice.
- Host forwarding preserves the original client `origin` and `batchId`.
- A reloaded peer does not re-accept already received batches.

## Phase 3: CRDT/HLC vector helpers

Add helpers in `src/crdt` only if they are generic:

- parse packed HLC into actor/node id and comparable components;
- derive origin actor from `CrdtUpdate`;
- compute all timestamps in a `CrdtUpdate`;
- compute `batchTimestampRange(updates)`;
- merge and compare version vectors.

Suggested exports:

```ts
export function crdtUpdateTimestamps(update: CrdtUpdate): HlcTimestamp[];
export function crdtUpdateActors(update: CrdtUpdate): string[];
export function mergeVersionVector(a: VersionVector, b: VersionVector): VersionVector;
export function vectorDominates(a: VersionVector, b: VersionVector): boolean;
```

If `VersionVector` stays example-only, keep vector merge/compare in `lib/peerjs/vector.ts` and export only timestamp extraction from `src/crdt`.

Vector update policy:

- inspect every timestamp in a batch, not just the max;
- advance `vector[actor]` when the timestamp is newer;
- derive actor from the HLC timestamp actor segment;
- for a normal local command batch, all timestamps should belong to the local actor.

Acceptance criteria:

- Unit tests cover `set`, `delete`, and `setOrder` timestamp extraction.
- Unit tests cover vector merge/dominance with multiple actors.

## Phase 4: reconnect catch-up over host-star

Add messages:

```ts
type SyncRequest = {
    kind: 'syncRequest';
    version: 2;
    actor: string;
    docId: string;
    vector: VersionVector;
};

type SyncResponse = {
    kind: 'syncResponse';
    version: 2;
    actor: string;
    docId: string;
    since: VersionVector;
    batches: PersistedBatch[];
    requiresSnapshot?: boolean;
};
```

Connection flow:

1. On `open`, both peers send `hello` with vector.
2. On receiving `hello`, send `syncRequest` with local vector.
3. On receiving `syncRequest`, query retained batches not dominated by the request vector.
4. Send `syncResponse` with missing batches.
5. Receiver applies each batch through the same dedupe path as live `updates`.
6. After applying response batches, send a reciprocal `syncRequest` if local vector advanced.

Keep the current host-star UX:

- clients still connect to a host PeerJS id;
- host still forwards live batches;
- clients do not need to discover each other yet.

But make clients capable of answering sync requests on any direct connection. That lets Phase 5 mesh reuse the same protocol.

Acceptance criteria:

- Peer A edits offline, reconnects, and Peer B catches up from retained batches.
- Peer B edits offline, reconnects, and Peer A catches up from retained batches.
- Reconnect does not require receiving a full snapshot if retained logs are sufficient.

## Phase 5: snapshot policy for late join and compacted peers

Extend snapshot messages:

```ts
type SnapshotMessage<TState> = {
    kind: 'snapshot';
    version: 2;
    actor: string;
    docId: string;
    document: CrdtDocument<TState>;
    compactedThrough: VersionVector;
};
```

Rules:

- If the receiver has no local persisted replica, accept a validated snapshot.
- If the receiver has a local persisted replica with matching schema, prefer local state and request missing batches.
- If the sender cannot provide missing batches because compaction removed them, enter a recoverable state.
- Do not automatically replace local state when local state has offline edits.

Add recoverable UI state:

- `kind: 'needs-rebase-or-discard'`;
- show local vector, remote compacted frontier, retained local batch count;
- actions:
  - discard local copy and accept remote snapshot;
  - preview replay/rebase local edits.

Rebase preview scope:

- Use retained local batches after the receiver's last shared/compacted frontier.
- Recreate updates with fresh timestamps where possible.
- Apply them to the remote snapshot in memory.
- Show before/after document preview.
- Only persist after user confirms.

For the first implementation, the preview can be limited to the todo app and displayed as current todos versus rebased todos. Keep the protocol generic, but the preview UI may use `app.renderPanel` or app-specific display.

Acceptance criteria:

- New client can join from snapshot.
- Existing persisted client does not silently overwrite local state.
- If missing logs are unavailable, user must explicitly discard or rebase.

## Phase 6: UI diagnostics

Update `PeerJsControls` and related state stores to show:

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

Add controls:

- reset local replica;
- export local state as JSON;
- import local state from JSON with validation;
- manually request sync from connected peers;
- later: compact retained log.

Acceptance criteria:

- A developer can tell whether a peer is using persisted state or waiting for a snapshot.
- Duplicate rejection, retained batch count, and pending count are visible enough to debug protocol mistakes.

## Phase 7: optional mesh

Only start this after dedupe and reconnect catch-up are working.

Add membership message:

```ts
type PeerMember = {
    peerId: string;
    actor: string;
    role: PeerRole;
    vector: VersionVector;
};

type MembersMessage = {
    kind: 'members';
    version: 2;
    actor: string;
    docId: string;
    members: PeerMember[];
};
```

Behavior:

- host sends membership updates to clients;
- clients optionally connect directly to other clients;
- every direct connection runs the same `hello` and `syncRequest` flow;
- live batches can be forwarded over mesh after dedupe;
- preserve original `origin` and `batchId`;
- never forward a batch back to the connection it arrived on.

UI:

- add "mesh enabled" toggle;
- show direct versus host-routed connections.

Acceptance criteria:

- Three peers converge if the host leaves after direct connections are established.
- Duplicate forwarding in mesh does not grow retained logs or reapply updates.

## Phase 8: compaction

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

Add focused tests around pure helpers first:

- protocol v2 validation;
- schema fingerprint stability;
- HLC timestamp actor extraction;
- version-vector merge/dominance;
- batch range calculation;
- duplicate batch key handling.

Add browser/storage tests where feasible:

- persisted identity survives reload;
- persisted history survives reload;
- retained batches survive reload;
- duplicate received batch is ignored after reload.

Add PeerJS behavior tests if the example test setup supports it. If not, extract the sync state machine from `usePeerJsSync` enough to test without real PeerJS:

- local publish appends batch before send;
- inbound batch applies, persists, and forwards once;
- reconnect sync request returns missing batches;
- compacted-missing-log path enters `needs-rebase-or-discard`.

## Suggested file map

- `examples/react-crdt/src/lib/peerjs/localFirstTypes.ts`: durable sync types.
- `examples/react-crdt/src/lib/peerjs/persistence.ts`: IndexedDB wrapper.
- `examples/react-crdt/src/lib/peerjs/vector.ts`: version-vector helpers if kept example-local.
- `examples/react-crdt/src/lib/peerjs/schemaFingerprint.ts`: stable app schema fingerprinting.
- `examples/react-crdt/src/lib/peerjs/recentBatchCache.ts`: in-memory dedupe LRU.
- `examples/react-crdt/src/lib/peerjs/protocol.ts`: v2 message envelope and validators.
- `examples/react-crdt/src/lib/peerjs/usePeerJsSync.ts`: persisted batch send/receive, sync requests, forwarding.
- `examples/react-crdt/src/lib/peerjs/PeerJsApp.tsx`: loading persisted state and recoverable states.
- `examples/react-crdt/src/lib/peerjs/PeerJsControls.tsx`: diagnostics and reset/export/import controls.
- `src/crdt/history.ts` or a new `src/crdt/vector.ts`: generic timestamp extraction helpers if promoted.

## First implementation slice

Implement these together:

1. Add `idb` and IndexedDB persistence.
2. Persist stable replica identity and `CrdtLocalHistory`.
3. Persist retained local and remote batches.
4. Add protocol v2 `origin`, `vector`, and `vectorAfter`.
5. Reject duplicate received batches.
6. Preserve batch identity when forwarding.
7. Show identity, persistence state, vector, retained batch count, and pending count in the UI.
8. Add unit tests for vector helpers and duplicate handling.

Stop there before mesh or compaction. That slice changes the example from "network demo" to "reload-safe local-first replica" while keeping the routing model understandable.
