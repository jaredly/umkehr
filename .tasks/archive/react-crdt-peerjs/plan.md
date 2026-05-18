# PeerJS mode implementation plan

This plan adds a PeerJS-backed mode to `examples/react-crdt`.

The example should end up with two modes:

- `#local`: the current side-by-side in-memory simulator.
- `#peerjs`: a real PeerJS-backed host/client room.

The PeerJS mode is intentionally example-only. It should prove that `umkehr/react-crdt` can run over a real transport without teaching the React CRDT package about PeerJS, rooms, snapshots, or network details.

## Goals

- Add a host-star PeerJS mode that supports more than two browser tabs/devices.
- Let the host be the only creator/owner of the initial document.
- Send a full current document from host to each client on connection.
- Keep non-hosts simple: no document persistence and no independent initial document creation.
- Queue outgoing updates while disconnected so delayed delivery can be tested.
- Use `#local` and `#peerjs` hash routing.
- Refactor sync state into small external stores so app shells do not rerender for every sync/status change.

## Non-goals

Do not implement these in this pass:

- durable rooms;
- server-side room membership;
- auth;
- encrypted update payloads;
- host failover;
- client-to-client mesh connections;
- replayable retained update logs;
- offline-first persistence for non-hosts;
- loading arbitrary remote snapshots into the core library API.

## Dependency

Add PeerJS to `examples/react-crdt/package.json`:

```json
"peerjs": "^1.x"
```

Use the public PeerServer defaults for the first pass. Keep the PeerJS options isolated so a local/self-hosted PeerServer can be configured later.

## Routing

Add a tiny hash router:

```ts
type AppMode = 'local' | 'peerjs';

function useHashMode(): [AppMode, (mode: AppMode) => void];
```

Rules:

- `#peerjs` renders PeerJS mode.
- `#local`, empty hash, and unknown hashes render local simulator mode.
- Mode switch buttons update `window.location.hash`.

Suggested file:

- `examples/react-crdt/src/useHashMode.ts`

## App structure

Split the current `App` into route-level components:

```tsx
export function App() {
    const [mode, setMode] = useHashMode();

    return (
        <>
            <ModeTabs mode={mode} setMode={setMode} />
            {mode === 'peerjs' ? <PeerJsApp /> : <LocalSimulatorApp />}
        </>
    );
}
```

Suggested files:

- `examples/react-crdt/src/App.tsx`
- `examples/react-crdt/src/LocalSimulatorApp.tsx`
- `examples/react-crdt/src/PeerJsApp.tsx`
- `examples/react-crdt/src/ModeTabs.tsx`

Keep the existing side-by-side UI in `LocalSimulatorApp`.

## External store refactor

Move sync/status state that is not document state into small external stores.

Use `useSyncExternalStore` for UI subscriptions. Do not use React state for high-frequency transport events unless a visible status actually changed.

Add a reusable minimal store helper:

```ts
export type ExternalStore<T> = {
    getSnapshot(): T;
    setSnapshot(next: T): void;
    subscribe(listener: () => void): () => void;
};

export function createExternalStore<T>(initial: T): ExternalStore<T>;

export function useStore<T>(store: ExternalStore<T>): T;
```

Suggested file:

- `examples/react-crdt/src/store.ts`

Refactor `useDemoSync` so it returns stable values:

```ts
type DemoSync = {
    stateStore: ExternalStore<TransportState>;
    transports: Record<ReplicaId, DemoTransport>;
    toggleSync(): void;
};
```

`LocalSimulatorApp` should not subscribe to queue counts directly. Instead, create a small `LocalSyncControls` component that calls `useStore(sync.stateStore)` and renders `SyncControls`.

This keeps local CRDT edits from causing root shell rerenders, and queued-count changes rerender only the controls.

## Shared transport helpers

Both local demo transport and PeerJS transport need to update HLCs from inbound CRDT update batches.

Add helpers in `src/crdt/history.ts` or a small CRDT utility module:

```ts
export function latestCrdtUpdateTimestamp(update: CrdtUpdate): HlcTimestamp | undefined;

export function latestCrdtUpdateBatchTimestamp(
    updates: readonly CrdtUpdate[],
): HlcTimestamp | undefined;
```

Export them from `src/crdt/index.ts`.

Then replace duplicated timestamp extraction in `examples/react-crdt/src/model.ts`.

## Host/client document model

PeerJS mode has two roles:

```ts
type PeerRole = 'host' | 'client';
```

Host behavior:

- Create the initial `CrdtLocalHistory` with `createInitialHistory()`.
- Own the authoritative current document snapshot for new joins.
- Persisting host state is optional. If existing demo persistence is not already CRDT-aware, skip persistence in this pass.
- On client connection, send a snapshot message containing only the current `CrdtDocument<State>`.
- Never send the host's local undo/redo stacks to clients.
- Receive client updates and apply them locally through the provider transport.
- Forward client updates to every other connected client.

Client behavior:

- Start in a "waiting for snapshot" state.
- Do not create or persist a local document.
- Connect to host by PeerJS ID.
- Once snapshot arrives, wrap the validated document with `createCrdtLocalHistory(snapshot)` and mount `ProvideTodos`.
- Start with empty local undo/redo stacks, even if the host has local undo/redo history.
- Send local updates to host.
- Apply update batches forwarded by host.
- Queue outgoing local updates while disconnected from host.

## Peer protocol

Use explicit versioned messages.

```ts
type PeerMessage =
    | {
          kind: 'hello';
          version: 1;
          actor: string;
          docId: string;
          role: PeerRole;
      }
    | {
          kind: 'snapshot';
          version: 1;
          actor: string;
          docId: string;
          document: CrdtDocument<State>;
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

`docId` can be a hard-coded constant for this example, such as:

```ts
const TODO_DOC_ID = 'umkehr-react-crdt-todos-v1';
```

Do not accept messages with the wrong `version` or `docId`.

## Validation

Network messages are untrusted.

Add protocol parsing:

```ts
function parsePeerMessage(input: unknown): PeerMessage | null;
```

Suggested file:

- `examples/react-crdt/src/peerjs/protocol.ts`

Validation requirements:

- validate envelope shape;
- validate `version`;
- validate `docId`;
- validate CRDT updates with `createCrdtUpdateValidator(schema)`;
- validate full snapshots before mounting `ProvideTodos`.

Snapshot validation is required. Do not mount a client document from an unvalidated snapshot, and do not partially accept or repair invalid snapshots.

Add explicit validators:

```ts
function parsePeerMessage(input: unknown): PeerMessage | null;

function validatePeerSnapshot(input: unknown): CrdtDocument<State> | null;
```

`validatePeerSnapshot` should check:

- top-level document object has `state`, `meta`, `pending`, and `schema`;
- `state` validates with `typia.createValidate<State>()`;
- `meta` validates as a complete `CrdtMeta` tree;
- `pending` is an array of valid pending updates;
- `schema` matches the expected example schema context, including the `type` tag key;
- no local undo/redo history is present in the snapshot envelope.

If the existing CRDT validation module does not expose enough validators for `CrdtDocument`, `CrdtMeta`, or pending updates, add those validators to the CRDT validation surface rather than weakening the PeerJS boundary.

Invalid snapshots should:

- be rejected entirely;
- set a visible protocol error in the PeerJS status store;
- leave the client in the waiting/not-mounted state;
- not call any `SyncedTransport` subscribers.

## PeerJS sync hook

Add PeerJS code under:

- `examples/react-crdt/src/peerjs/usePeerJsSync.ts`
- `examples/react-crdt/src/peerjs/protocol.ts`
- `examples/react-crdt/src/peerjs/types.ts` if useful

Target hook shape:

```ts
type PeerConnectionInfo = {
    peerId: string;
    actor?: string;
    open: boolean;
    role?: PeerRole;
    queuedOutgoing: number;
    error?: string;
};

type PeerSyncState =
    | {kind: 'initializing'; role: PeerRole}
    | {kind: 'ready'; role: PeerRole; peerId: string}
    | {kind: 'waiting-for-snapshot'; role: 'client'; peerId: string; hostPeerId: string}
    | {kind: 'error'; role: PeerRole; message: string};

type PeerJsSync = {
    transport: SyncedTransport;
    stateStore: ExternalStore<PeerSyncState>;
    connectionsStore: ExternalStore<PeerConnectionInfo[]>;
    snapshotStore: ExternalStore<CrdtDocument<State> | null>;
    connect(peerId: string): void;
    disconnect(peerId: string): void;
    flushQueued(peerId?: string): void;
    destroy(): void;
};

function usePeerJsSync(options: {
    role: PeerRole;
    actor: string;
    initialDocument?: CrdtDocument<State>;
    docId: string;
}): PeerJsSync;
```

Implementation notes:

- Create the `Peer` instance in an effect.
- Create a stable `SyncedTransport` in a ref or memo.
- Store connection objects outside React state.
- Use external stores for status snapshots.
- Host listens for inbound connections.
- Client calls `peer.connect(hostPeerId, {serialization: 'json'})`.
- DataConnection `data` event parses messages and routes by kind.
- DataConnection `open` sends `hello`.
- Host sends `snapshot` after connection opens or after receiving client `hello`.
- `transport.publish(updates)` creates an `updates` envelope and sends/queues it.

## Host routing

When host receives client updates:

1. Deliver updates to host local `SyncedTransport` subscribers so the host document updates.
2. Forward the same update batch to every open client connection except the sender.
3. If a client connection is closed, queue that outgoing batch for that connection.

When host receives a new client connection:

1. Track the connection.
2. Send `hello`.
3. Send `snapshot` using the host's latest `CrdtDocument<State>`.

Host needs access to the latest document for snapshots. Use `ctx.useLocalHistory()` in `PeerJsApp`, but pass only `history.doc` into the PeerJS sync hook or snapshot source callback.

Preferred simple shape:

```tsx
function PeerHostDocument({sync}: {sync: PeerJsSync}) {
    const ctx = useTodos();
    const history = ctx.useLocalHistory();
    useEffect(() => sync.setSnapshotDocument(history.doc), [sync, history.doc]);
    return <TodoPanel ... />;
}
```

If adding `setSnapshotDocument` to `PeerJsSync` is cleaner than passing `initialDocument`, update the hook shape accordingly.

## Client snapshot flow

Client cannot mount `ProvideTodos` until it has a host snapshot.

PeerJS client UI states:

- not connected: show host peer ID input;
- connecting/waiting: show spinner/status;
- snapshot received: render `ProvideTodos initial={createCrdtLocalHistory(snapshot)} transport={sync.transport}`.

After snapshot arrives:

- set `snapshotStore` once;
- mount the document UI;
- apply future host update messages through `transport.subscribe` listeners.

Do not overwrite the client's current document with later snapshots unless the user explicitly reconnects/restarts.

## Queuing semantics

Outgoing updates while disconnected should be queued.

Host:

- if a client is disconnected, queue updates destined for that client;
- on reconnect, flush queued updates after sending/confirming snapshot only if it is the same logical client actor.

Client:

- if disconnected from host, queue local updates;
- when reconnected to host, send queued updates after receiving a fresh snapshot or after the old connection reopens.

For the first pass, keep this simpler:

- queue by PeerJS peer ID;
- expose queued counts in the connection status UI;
- provide a manual "Flush queued" action;
- automatic flush on `open` is acceptable if implementation is straightforward.

Because there is no durable identity or catch-up protocol yet, queued updates are best-effort demo behavior, not a guarantee.

## PeerJS UI

Add `PeerJsControls`:

- role selector: Host / Client;
- local peer ID display;
- host peer ID input for client mode;
- connect/disconnect button;
- connection status list;
- queued outgoing counts;
- latest error text;
- optional copy invite URL button.

Suggested file:

- `examples/react-crdt/src/peerjs/PeerJsControls.tsx`

Hash routing can include role and host ID later, but first pass only needs `#peerjs`.

## PeerJsApp component

High-level structure:

```tsx
function PeerJsApp() {
    const [role, setRole] = useState<PeerRole>('host');
    const [hostInitial] = useState(createInitialHistory);
    const sync = usePeerJsSync({
        role,
        actor,
        initialDocument: role === 'host' ? hostInitial.doc : undefined,
        docId: TODO_DOC_ID,
    });

    return (
        <section>
            <PeerJsControls ... />
            {role === 'host' ? (
                <ProvideTodos initial={hostInitial} transport={sync.transport}>
                    <PeerHostDocument sync={sync} />
                </ProvideTodos>
            ) : (
                <PeerClientDocument sync={sync} />
            )}
        </section>
    );
}
```

Client document:

```tsx
function PeerClientDocument({sync}: {sync: PeerJsSync}) {
    const snapshot = useStore(sync.snapshotStore);
    if (!snapshot) return <WaitingForSnapshot />;
    return (
        <ProvideTodos initial={createCrdtLocalHistory(snapshot)} transport={sync.transport}>
            <TodoPanel ... />
        </ProvideTodos>
    );
}
```

## Testing and verification

Automated:

- `npm run typecheck`
- `npm run typecheck:examples`
- `npm test`
- `pnpm build` in `examples/react-crdt`

Unit tests worth adding if practical:

- protocol parser rejects invalid messages;
- protocol parser accepts valid snapshot/update messages;
- external store notifies subscribers exactly when snapshots change;
- latest CRDT update timestamp helper handles `set`, `delete`, and `setOrder`.

Manual:

1. Open `#peerjs` in tab A as host.
2. Open `#peerjs` in tab B as client.
3. Connect B to A's PeerJS ID.
4. Confirm B receives host snapshot.
5. Edit A; B updates.
6. Edit B; A updates; any other clients update.
7. Connect tab C as another client; C receives current host snapshot.
8. Edit C; A and B update.
9. Disconnect B, edit A/C, reconnect B, verify queued behavior does not crash and visible queued counts make sense.
10. Undo/redo on A or B broadcasts normally.

## Implementation order

1. Add external store helper.
2. Refactor `useDemoSync` and local simulator controls onto the external store.
3. Split `App` into hash-routed `LocalSimulatorApp` and placeholder `PeerJsApp`.
4. Add CRDT latest timestamp batch helpers and use them in the local demo transport.
5. Add PeerJS dependency.
6. Add Peer protocol types/parser/full snapshot validators.
7. Implement `usePeerJsSync` with stable transport, Peer lifecycle, connection tracking, and queued sends.
8. Implement host snapshot send and client snapshot mount flow.
9. Add `PeerJsControls`.
10. Run automated checks.
11. Manually test two and three browser tabs.

## Risks

- PeerJS public signaling server availability can make manual testing flaky.
- Full snapshot validation may require adding CRDT validators that are not currently public.
- Queuing across disconnect/reconnect is ambiguous without stable durable client identity.
- Host snapshot plus queued update flush can duplicate updates; CRDT LWW behavior should tolerate this, but add batch dedupe if duplicate delivery becomes visible.
- `TodoPanel` currently assumes a queued count prop from local simulator. PeerJS mode may need either a generic queued count prop or a mode-specific status panel.

## Done criteria

- `#local` preserves current side-by-side simulator behavior.
- `#peerjs` supports one host and at least two clients in separate tabs.
- New clients receive the host's current document before rendering the TODO UI.
- Clients reject invalid snapshots and stay unmounted with a visible protocol error.
- Edits from host and clients propagate through the host-star route.
- Disconnected outgoing updates are queued and visible in status UI.
- `src/react-crdt` remains transport-agnostic.
- Automated checks pass.
