# PeerJS local-first research

This document looks at turning `examples/react-crdt` PeerJS mode from a networked demo into a more realistic local-first application.

The goal is still example-level code, not a new public PeerJS API in `umkehr`. The example should demonstrate the library's CRDT semantics under conditions a real local-first app has to survive: reloads, offline edits, reconnects, multi-peer fanout, late join, duplicate delivery, stale peers, and storage cleanup.

## Current shape

The example already has useful boundaries:

- `createSyncedContext` in `umkehr/react-crdt` owns local CRDT history, local undo/redo, path subscriptions, preview state, and applying remote CRDT updates.
- `SyncedTransport` is the adapter boundary: an actor id, HLC ticking, publishing local updates, and subscribing to inbound updates.
- `examples/react-crdt/src/peerjs/usePeerJsSync.ts` keeps PeerJS isolated from the reusable React CRDT package.
- `PeerJsApp` has explicit `host` and `client` roles.
- The host creates the initial document and sends a validated snapshot to clients.
- Clients wait for a snapshot, then create local CRDT history from that snapshot.
- The host forwards client update batches to other clients.
- Peer messages are already versioned and validated by `parsePeerMessage`.

That is a good transport demo, but it is not local-first yet.

The current limitations are:

- Clients do not persist their document locally.
- Host state persistence is limited to in-memory state for this mode.
- A reloaded client loses identity, document state, queued updates, and undo/redo stacks.
- The host is an availability bottleneck and routing authority.
- Late join is snapshot-only; there is no retained operation log or incremental catch-up.
- There is no peer-to-peer knowledge of "which updates have you already seen?"
- Duplicate update delivery is probably benign at the CRDT layer, but duplicate network batches are not explicitly tracked.
- Tombstones are kept forever.
- Pending updates are kept forever if their dependencies never arrive.
- There is no migration/version story for persisted CRDT documents.

## What local-first should mean here

For this example, "local-first" should mean:

1. Each browser profile owns a durable replica identity.
2. Each replica persists enough state to reload and keep working without a network.
3. Local edits are accepted immediately and saved before network delivery is required.
4. Peers can reconnect and exchange only the updates the other side is missing.
5. The app can tolerate duplicate, delayed, and out-of-order network messages.
6. A peer can join from either a snapshot or an operation log, depending on what the sender has retained.
7. Long-running documents have a bounded growth strategy for update history, pending updates, and tombstones.

That is bigger than simply saving `history.doc` to `localStorage`. Persistence, sync discovery, causality tracking, and compaction need to be designed together.

## Recommended direction

Use an operation-log-first design with periodic compacted snapshots.

Each client should persist:

- a stable `replicaId`;
- the current `CrdtDocument<State>`;
- local undo/redo stacks if we want reload-stable undo;
- an append-only local operation log of generated update batches;
- a durable received-batch index for network dedupe;
- a version vector summarizing the latest observed timestamp counter per actor;
- a compacted base snapshot plus compaction metadata.

The transport should move from "send every local batch to the host" to "sync missing batches between peers." PeerJS then becomes a connection mechanism, not the source of truth.

The lowest-risk path is:

1. Add durable single-replica persistence.
2. Add retained operation logs and version-vector sync over the existing host-star topology.
3. Add host snapshot-plus-log catch-up for late join.
4. Add optional mesh forwarding after dedupe exists.
5. Add compaction once version vectors and retained logs are in place.

## Durable identity

Do not use the PeerJS broker id as the durable actor id. PeerJS ids are connection rendezvous ids; they can change across reloads and are tied to the signaling server.

Persist a generated actor id instead:

```ts
type ReplicaIdentity = {
    replicaId: string;
    createdAt: string;
};
```

Use that `replicaId` for HLC actor identity and CRDT update authorship. PeerJS ids remain display/connect ids.

Storage key shape:

```ts
umkehr.react-crdt.peerjs.identity.v1
umkehr.react-crdt.peerjs.docs.${docId}.v1
```

This also means role changes should not regenerate the actor. A user who starts as a host, reloads, and joins as a client should still be the same replica.

## Persistence model

`localStorage` is enough for a small example but is not a credible local-first substrate. It is synchronous, string-only, has small quota, and cannot store larger retained logs comfortably.

Use IndexedDB for the local-first mode. Keep a small wrapper in the example rather than adding a dependency unless the wrapper gets too noisy.

Suggested logical stores:

```ts
type PersistedReplica<T> = {
    docId: string;
    protocolVersion: 1;
    schemaFingerprint: string;
    replicaId: string;
    document: CrdtDocument<T>;
    undoStack: LocalCommand[];
    redoStack: LocalCommand[];
    vector: VersionVector;
    compactedThrough?: VersionVector;
    updatedAt: string;
};

type PersistedBatch = {
    docId: string;
    batchId: string;
    origin: string;
    updates: CrdtUpdate[];
    minTs?: HlcTimestamp;
    maxTs?: HlcTimestamp;
    vectorAfter: VersionVector;
    receivedAt: string;
};

type ReceivedBatch = {
    docId: string;
    origin: string;
    batchId: string;
    receivedAt: string;
};
```

Persistence should be on the write path for local edits:

- apply local command in memory;
- append its update batch to IndexedDB;
- persist the new document and vector;
- then publish to connected peers.

Remote updates should follow the same durability rule:

- validate message;
- reject duplicate batch id if already received;
- apply updates;
- append retained batch if accepted;
- persist document and vector;
- notify React subscribers.

For the example, persisting immediately after every batch is acceptable. A production app would batch writes, but the example should prefer obvious correctness.

## Version vectors

The CRDT uses HLC timestamps shaped like packed strings. A version vector can summarize "latest contiguous-ish knowledge by actor" if we can parse actor/counter from the HLC.

The minimum useful vector:

```ts
type VersionVector = Record<string, HlcTimestamp>;
```

On each update, extract the latest timestamp in the batch with `latestCrdtUpdateBatchTimestamp`, then advance the vector for that timestamp's actor if newer.

This is not a full causal frontier for every object path. It is a practical sync summary for retained batches if every batch has a single max timestamp and retained logs are queried by timestamp. Because a batch can contain multiple updates from one local actor today, this works well for local command batches. If future code accepts mixed-origin batches, vector calculation should inspect every update timestamp, not only the max.

Protocol additions:

```ts
type PeerMessage =
    | {kind: 'hello'; version: 2; actor: string; docId: string; role: PeerRole; vector: VersionVector}
    | {kind: 'syncRequest'; version: 2; actor: string; docId: string; vector: VersionVector}
    | {kind: 'syncResponse'; version: 2; actor: string; docId: string; since: VersionVector; batches: PersistedBatchHeader[]}
    | {kind: 'updates'; version: 2; actor: string; docId: string; batchId: string; updates: CrdtUpdate[]; vectorAfter: VersionVector}
    | {kind: 'snapshot'; version: 2; actor: string; docId: string; document: CrdtDocument<State>; compactedThrough: VersionVector};
```

On connection:

1. Both peers send `hello` with actor id and vector.
2. Each peer asks for batches missing from its vector.
3. If the sender no longer has all required batches because of compaction, it sends a snapshot plus batches after the snapshot frontier.
4. Receiver validates and applies snapshot/log data, then sends its own missing batches.

The example does not need a perfect anti-entropy protocol. It needs enough structure to show that reconnect is state-based, not role-based.

## Host-star versus mesh

The current host-star topology is the right first base for local-first persistence because it limits discovery complexity. But it should stop treating the host as the only durable source of document truth.

### Keep host-star initially

Pros:

- Smallest change from current `usePeerJsSync`.
- Easy invite UX.
- Host can still help late joiners with snapshots.
- Dedupe and version-vector sync can be developed with one routing path.

Cons:

- Offline clients cannot discover each other through the app.
- If the host disappears, connected clients lose the relay path.
- Host identity is overloaded with "person who started the room."

Recommended first pass: keep host-star, but make every peer persist and serve sync state. Clients can reconnect to the same host and catch up from their own local state.

### Add optional mesh after dedupe

Mesh should only happen after batch ids, vectors, and retained logs exist. Without those, mesh creates duplicate fanout and hard-to-debug loops.

Suggested mesh behavior:

- host still bootstraps membership;
- host shares a list of connected PeerJS ids and stable actor ids;
- clients may open direct connections to each other;
- every peer sends `hello` and `syncRequest` on every connection;
- update forwarding uses batch-id dedupe and a small "seen recently" cache;
- do not forward a batch back to the connection it arrived on.

This is still not fully decentralized discovery. It is a small-room browser mesh, which is appropriate for an example.

## Snapshot and log catch-up

Snapshots are useful for fast join and compaction, but raw snapshots are dangerous if they silently discard local state.

Rules:

- A new empty replica can accept a snapshot directly.
- A non-empty replica should only accept a snapshot if the snapshot's `compactedThrough` dominates the replica's `compactedThrough` and the receiver has no unacknowledged local updates outside that frontier.
- If there are local updates the snapshot does not include, the receiver should apply those retained local batches on top of the snapshot.
- If the receiver cannot prove that is safe, show a recoverable conflict state rather than replacing the document.

For the example, use a simpler policy:

- if no local persisted document exists, accept snapshot;
- if a local document exists for the same `docId` and schema fingerprint, prefer local document and request missing batches;
- if the sender cannot provide missing batches, offer a "replace local copy from peer" button in the UI, but do not do it automatically.

## Dedupe and idempotency

CRDT update application already discards many stale updates by timestamp/version checks. That helps, but the network layer should still dedupe whole batches.

Keep:

- `receivedBatches` persisted in IndexedDB, keyed by `${docId}:${origin}:${batchId}`;
- an in-memory LRU for recent batches to avoid frequent IndexedDB lookups while mesh fanout is hot;
- `batchId` generated at the origin and preserved by forwarders.

Do not generate a new `batchId` when forwarding a batch. Forwarding should keep origin identity intact.

## Pending updates

`CrdtDocument.pending` currently queues updates whose dependencies have not arrived. That is necessary for out-of-order delivery, especially with mesh and log catch-up.

Local-first needs guardrails:

- persist pending updates as part of the document;
- expose pending count in the PeerJS UI;
- periodically retry pending after any accepted update or snapshot;
- cap or mark very old pending updates if dependencies never arrive;
- include pending updates in diagnostics so protocol bugs are visible.

Do not compact away retained batches that might satisfy pending updates on another peer unless the compaction snapshot includes the missing dependency state.

## Tombstones

Current metadata uses `TombstoneMeta` for deletes. Tombstones preserve delete causality: a stale set must not resurrect a value after a newer delete. That means tombstone compaction cannot be a local-only garbage collection pass unless all relevant peers have observed the delete.

Safe tombstone removal requires a stability frontier:

```ts
stableVector = min(allKnownPeerVectors)
```

A tombstone at timestamp `t` is removable only if every active/retained peer vector dominates `t` for that actor, and no retained update can reference the tombstoned object as a parent.

In an example app with intermittent browser peers, "all known peers" is fuzzy. Recommended policy:

- keep tombstones by default;
- add a manual "compact now" action that explains it requires all peers to have synced;
- compact against a configured active peer set, not every actor ever seen;
- store `compactedThrough` with the snapshot;
- after compaction, peers behind `compactedThrough` must catch up from a snapshot, not old updates.

This avoids pretending automatic tombstone GC is trivial.

## History compaction

There are two histories to distinguish:

- CRDT sync history: retained update batches used for peer catch-up.
- Local undo/redo history: `undoStack` and `redoStack` used for user commands.

They have different compaction rules.

For sync history:

- periodically write a compacted snapshot of `CrdtDocument<State>`;
- record `compactedThrough`;
- delete retained batches dominated by `compactedThrough`;
- keep batches after `compactedThrough`;
- serve snapshot plus post-snapshot batches to peers behind the frontier.

For local undo/redo:

- local commands reference pre/post metadata and timestamps;
- remote edits can block undo/redo;
- retaining undo forever can keep old metadata alive;
- compacting undo should be independent of sync compaction.

Example policy:

- persist undo/redo initially for reload behavior;
- add a command limit, for example latest 100 local commands;
- clear redo on new local edit as today;
- clear undo entries that refer to compacted-away tombstones or objects if compaction becomes aggressive.

## UI changes

A more real local-first PeerJS mode should surface state that matters:

- stable replica id;
- transient PeerJS id;
- document id and schema version/fingerprint;
- local persistence status;
- local vector summary;
- retained batch count;
- pending update count;
- connected peers with actor id, PeerJS id, vector, open/closed state, queued outgoing count, and last sync time;
- controls for export/import, reset local replica, and manual compaction.

Avoid making this a production collaboration UI. It should be an inspectable engineering example that shows how local-first sync behaves.

## Implementation plan

### Phase 1: durable single-replica state

- Add `examples/react-crdt/src/peerjs/persistence.ts` backed by IndexedDB.
- Persist stable actor identity.
- Persist host and client `CrdtLocalHistory`.
- Load persisted state before mounting `ProvideTodos`.
- Save after every local and remote batch.
- Show persistence status in `PeerJsControls`.

This phase makes reload work, but does not solve reconnect catch-up beyond the current snapshot behavior.

### Phase 2: retained batches and dedupe

- Introduce `PersistedBatch` and `ReceivedBatch`.
- Append local update batches before publishing.
- Append accepted remote batches before forwarding.
- Reject duplicate `{origin, batchId}`.
- Preserve origin batch id when forwarding.
- Add tests around duplicate delivery and reload.

This phase makes forwarding safer and prepares for mesh.

### Phase 3: version-vector sync

- Add vector calculation helpers.
- Persist vector with the document.
- Include vector in `hello`.
- Add `syncRequest` and `syncResponse`.
- On reconnect, exchange missing retained batches.
- Keep host-star routing, but make clients capable of serving missing batches too.

This phase turns reconnect into true incremental sync.

### Phase 4: late join snapshots

- Store compacted/base snapshot metadata.
- Let new peers accept an initial snapshot.
- Let existing peers prefer local state and request missing batches.
- If missing batches are unavailable, require explicit user replacement.

This phase fixes the "new client only" snapshot assumption.

### Phase 5: optional mesh

- Add peer membership messages from host.
- Let clients connect directly.
- Run the same vector sync on every connection.
- Forward batches with dedupe and no re-originating.
- Add UI to disable mesh for debugging.

This phase makes the example less host-dependent while keeping host bootstrap.

### Phase 6: compaction

- Add manual sync-log compaction.
- Write snapshot and `compactedThrough`.
- Delete dominated retained batches.
- Keep tombstones unless the active peer stability frontier proves removal is safe.
- Add diagnostics for peers that are too far behind and need snapshot catch-up.

This phase controls growth without hiding the hard parts.

## Library versus example boundaries

Keep these in the example:

- PeerJS connection management;
- IndexedDB schema;
- room/invite UX;
- mesh membership;
- protocol message envelope;
- document-specific schema fingerprinting.

Consider moving these to `src/crdt` only if they prove generally useful:

- timestamp actor extraction from HLC strings;
- vector helper operations like `dominates`, `merge`, and `min`;
- document traversal helpers for counting pending updates or tombstones;
- optional compaction primitives that work on `CrdtMeta`.

Do not move PeerJS concepts or IndexedDB assumptions into the library.

## Key open questions

- Should `CrdtLocalHistory` be treated as a serializable public data structure, or should the library expose validate/load helpers for persisted histories?
  - public is fine
- Can the HLC actor and counter be parsed as stable public semantics, or should vector support be an explicit library API?
  - yeah we can parse HLC for that
- Should CRDT updates carry origin metadata, or should batch origin stay entirely at the sync protocol layer?
  - origin metadata on CRDT updates works for me. the HLC has an actor (node) id in it- is that all we need?
- How should schema migrations work for persisted CRDT documents?
  - I don't think that's solveable with out a stop-the-world migration, so let's not mess with that right now
- What is the desired UX when a peer has local offline edits but the room has compacted beyond its retained log?
  - on reconnection, allow the user to preview "re-playing the local edits rebased w/ new timestamps", and choose to discard or re-base
- Should the example use raw IndexedDB or add a tiny dependency for ergonomics?
  - a tiny dependency is fine

## Recommended immediate task

Start with Phase 1 and Phase 2 together. Durable state without retained batches still feels fragile, and retained batches without persistence do not survive reload. The first concrete milestone should be:

- stable actor identity in IndexedDB;
- persisted `CrdtLocalHistory`;
- persisted local and remote update batches;
- duplicate batch rejection;
- existing host-star PeerJS UI still working;
- tests for reload and duplicate delivery.

After that, version-vector sync can be added without rewriting persistence again.
