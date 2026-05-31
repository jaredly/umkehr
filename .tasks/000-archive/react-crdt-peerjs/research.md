# PeerJS mode for the React CRDT example

This document explores adding a PeerJS-backed mode to `examples/react-crdt`.

The goal is not to make PeerJS part of umkehr's public API. The goal is to make the example app demonstrate the same `SyncedTransport` contract over a real peer-to-peer data channel, while keeping the local two-replica simulator available for deterministic testing.

## Current example shape

The example currently has three useful boundaries:

- `createSyncedContext` in `umkehr/react-crdt` owns local CRDT history, local undo/redo, path subscriptions, preview state, and applies remote CRDT updates.
- `SyncedTransport` is the adapter boundary:

```ts
type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
};
```

- `useDemoSync` is a local in-memory router that creates one `DemoTransport` per side, optionally queues updates while sync is paused, and delivers updates to the other local side.

That means PeerJS should be a replacement for the transport/router layer, not something `TodoPanel`, `ProvideTodos`, or `src/react-crdt` knows about.

## PeerJS facts that matter

PeerJS creates a `Peer` object that can connect to other peers and listen for connections. A peer can be created with an explicit ID, or the signaling server can assign one. Peer IDs are for brokering connections and should not be treated as durable user identity. Source: <https://peerjs.com/client/api/peer>

Data connections are created with `peer.connect(id)` or accepted via the peer's `connection` event. Source: <https://peerjs.com/client/getting-started>

`DataConnection.send(data)` can send objects, strings, blobs, and other serializable data. PeerJS uses BinaryPack by default; the connection option can select `binary`, `binary-utf8`, `json`, or `none`. Source: <https://peerjs.com/client/api/data-connection>

Data connections have `open`, `data`, `close`, and `error` events, plus an `.open` boolean and `.bufferSize` for queued outgoing messages. Source: <https://peerjs.com/client/api/data-connection>

PeerJS needs a PeerServer for signaling. The default host is `0.peerjs.com`, but the docs explicitly support running a self-hosted PeerServer. Source: <https://peerjs.com/client/getting-started>

## Product shape

Add a mode switch in the example:

- Local mode: current side-by-side simulator.
- PeerJS mode: one active local replica connected to one or more remote browser tabs/devices.

PeerJS mode should prioritize manual, inspectable behavior:

- show my PeerJS broker ID;
- input for a remote PeerJS broker ID;
- connect/disconnect button;
- connection status list;
- optional local "pause outgoing" toggle for testing delayed delivery;
- optional "copy invite URL" that includes `?peer=<myPeerId>`.

The side-by-side local simulator should remain because it is still the best debugging surface for deterministic CRDT behavior, undo/redo, and rendering issues.

## Recommended architecture

Create a separate PeerJS transport hook:

```ts
type PeerStatus =
    | {state: 'initializing'}
    | {state: 'ready'; peerId: string}
    | {state: 'error'; message: string};

type PeerConnectionStatus = {
    peerId: string;
    open: boolean;
    queued: number;
    error?: string;
};

function usePeerJsSync(options?: PeerJsOptions): {
    transport: SyncedTransport;
    status: PeerStatus;
    connections: PeerConnectionStatus[];
    connect(peerId: string): void;
    disconnect(peerId: string): void;
    destroy(): void;
};
```

This hook should create exactly one `SyncedTransport` for the local replica. The transport's `publish(updates)` sends an envelope to every open PeerJS data connection. The transport's `subscribe(receive)` registers listeners that are called when inbound update envelopes arrive.

Keep this hook outside `src/react-crdt`; it belongs in the example. If it proves useful later, it can become a documented recipe or a separate adapter package.

## Message envelope

Do not send raw `CrdtUpdate` values directly. Use an explicit envelope with a version field:

```ts
type PeerMessage =
    | {
          kind: 'hello';
          version: 1;
          actor: string;
          docId: string;
      }
    | {
          kind: 'updates';
          version: 1;
          actor: string;
          docId: string;
          batchId: string;
          updates: CrdtUpdate[];
      };
```

Reasons:

- `docId` lets us reject accidental cross-document connections.
- `version` gives us room to change the protocol.
- `actor` helps with status/debugging and can be separate from the PeerJS broker ID.
- `batchId` gives us a future place for dedupe or acknowledgements.

For the first implementation, no ack protocol is necessary. WebRTC data channels are ordered/reliable by default in modern browsers, and the CRDT update format is idempotent enough for duplicate delivery to be tolerable in most cases. If duplicate delivery creates visible issues, add a small received-batch LRU keyed by `{actor, batchId}`.

## Clock ownership

The PeerJS transport should own the HLC, just like the local demo transport does.

- `tick()` calls `hlc.inc(clock, Date.now())`.
- inbound messages should advance the local HLC from the latest timestamp in the received updates before notifying subscribers.

This preserves the `src/react-crdt` rule: React knows that it has a transport, but it does not know remote update mechanics or clock internals.

There is duplicated timestamp extraction today between `createDemoTransport` and any future PeerJS transport. That should probably become a CRDT helper:

```ts
export function latestCrdtUpdateTimestamp(update: CrdtUpdate): HlcTimestamp | undefined;
export function latestCrdtUpdateBatchTimestamp(updates: CrdtUpdate[]): HlcTimestamp | undefined;
```

Then both transports can update clocks consistently.

## Connection model options

### Option 1: Pairwise manual connection

Each browser has one PeerJS ID. User A copies their ID to user B. User B connects. Both peers then exchange CRDT updates.

Pros:

- simplest implementation;
- matches PeerJS docs directly;
- no room/session server required beyond PeerServer signaling;
- good for proving the transport boundary.

Cons:

- awkward for more than two users;
- no automatic discovery;
- no persistence or catch-up after both peers disconnect.

Verdict: best first implementation.

### Option 2: Star topology with one host

One peer is the host. Everyone connects to the host. The host forwards updates to every other connected peer.

Pros:

- supports small groups;
- simple mental model for users;
- avoids a full mesh of connections.

Cons:

- host becomes a relay and availability bottleneck;
- forwarding remote updates requires careful dedupe;
- "host left" behavior needs product decisions.

Verdict: useful later, but not necessary for the first PeerJS mode.

### Option 3: Full mesh

Every peer connects to every other peer and broadcasts updates to all open connections.

Pros:

- no special host;
- any peer can leave without taking the room down.

Cons:

- discovery still requires an out-of-band member list;
- duplicate delivery becomes normal;
- connection count grows quickly.

Verdict: overkill for this example.

## UI architecture options

### Option A: Separate routes/modes

Use one top-level mode:

- `LocalSimulatorApp`
- `PeerJsApp`

Pros:

- keeps the side-by-side local code clean;
- PeerJS app can have a single `ProvideTodos`;
- avoids mixing simulator queue controls with network connection controls.

Cons:

- a little more component structure.

Verdict: recommended.

### Option B: Embed PeerJS in the existing side-by-side shell

One side is local, the other side is "remote network".

Pros:

- fewer top-level files;
- keeps the visual side-by-side shape.

Cons:

- misleading, because the remote peer is not actually rendered locally;
- increases confusion around who owns which transport.

Verdict: avoid.

## Persistence and initial document

The PeerJS mode needs a clear initial document story.

For the first implementation, require all peers to start from the same initial `CrdtLocalHistory` created by `createInitialHistory()`. That is acceptable for the example because the initial history is hard-coded and deterministic.

Do not try to solve late join document sync in the first pass. A late peer with an empty or older history would need either:

- snapshot transfer;
- retained update log transfer;
- both, plus validation and doc identity checks.

That is a different feature from live update transport.

Open detail: the app should make it explicit that PeerJS mode is "connect two tabs opened from the same demo build", not a durable room system.

## Validation

Inbound PeerJS messages are untrusted network data. Before calling the `SyncedTransport` subscriber:

- validate the envelope shape;
- reject wrong `version`;
- reject wrong `docId`;
- validate each CRDT update using the existing CRDT update validator;
- ignore empty update batches.

This likely means adding a small protocol validator in the example:

```ts
function parsePeerMessage(input: unknown): PeerMessage | null;
```

The CRDT update validator already uses the typia-generated schema pattern, so the example should reuse that instead of trusting PeerJS payloads.

## Dependency and local server

Add `peerjs` to `examples/react-crdt/package.json`.

Default implementation can use the public PeerServer for convenience, but the UI/config should make this easy to change:

```ts
type PeerJsOptions = {
    peerId?: string;
    peerOptions?: PeerOptions;
    docId: string;
};
```

For robust local testing, consider a later script that starts a local PeerServer. That would require the `peer` server package or PeerJS server package and is not needed for the first pass.

## Error handling

Handle these states in the UI:

- PeerJS unavailable or browser incompatible.
- Peer ID unavailable/already taken.
- PeerServer network error.
- remote peer unavailable.
- data connection open/close/error.
- inbound message rejected.

Do not let connection errors throw through React render. Store them in the PeerJS sync hook's external state and render them in a compact status panel.

## Performance and rerendering

The PeerJS transport should avoid React state updates for every CRDT update. The transport can maintain connections/listeners in refs or a small external store.

React state should be reserved for:

- peer readiness/status;
- connection list changes;
- queued outgoing count if we add a pause toggle;
- user-visible errors.

Document changes should continue to flow through `ProvideTodos` path subscriptions, not through the app shell.

This is also a good time to refactor the existing local simulator hook toward the same shape: stable transports plus a small `useSyncExternalStore` subscription for sync controls. That would address the current concern that queued-count changes rerender the whole example shell.

## Proposed first implementation

1. Add a mode switch with `local` and `peerjs`.
2. Rename the current app body to `LocalSimulatorApp`.
3. Add `PeerJsApp` with one `ProvideTodos`, one `TodoPanel`, and PeerJS connection controls.
4. Add `usePeerJsSync` that returns a stable `SyncedTransport` plus status/actions.
5. Add `PeerMessage` envelope parsing and CRDT update validation.
6. Add `peerjs` dependency to the example package.
7. Keep PeerJS transport code under `examples/react-crdt/src/peerjs/`.
8. Build and manually test two tabs:
   - tab A shows peer ID;
   - tab B connects to tab A;
   - edits on A appear on B;
   - edits on B appear on A;
   - local undo/redo broadcasts to the other tab;
   - disconnect/reconnect does not crash.

## Open questions

- Should PeerJS mode support only one remote peer initially, or multiple open connections?
- Should outgoing updates while disconnected be dropped, queued, or shown as "not connected" errors?
- Should the peer actor ID be stable in `localStorage`, or generated per page load?
- Should the demo expose PeerJS server options in the UI, env vars, or hard-coded config?
- Do we want a snapshot/catch-up protocol after the live transport works?
- Should the current local simulator's sync state be moved to an external store before adding PeerJS, so both modes share the same render architecture?

## Recommendation

Implement the smallest useful PeerJS mode first:

- one local replica per browser tab;
- manual pairwise connect by PeerJS ID;
- validate and send `PeerMessage` envelopes over DataConnection;
- no late-join catch-up;
- no host/star/full-mesh routing;
- status UI for peer ID, remote ID, connection state, and errors.

This proves the important architecture: `umkehr/react-crdt` stays transport-agnostic, PeerJS is just another `SyncedTransport`, and CRDT document updates still bypass the app shell.

## Feedback

- host-star is what I want for now, to test more-than-2 situations
- let's have the host be the only one to create the document. upon connection of a client, it sends over the current full document. this means that non-hosts also don't persist the document to local storage, for simplicity.
- routing: yeah option A is great. let's have a #hash for simple persistant routing.
- outgoing updates while disconnected should be queued. we want to be able to test this scenario.
- small external store refactor sounds great
