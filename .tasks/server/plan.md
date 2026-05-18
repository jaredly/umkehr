# Offline-First Server Example Plan

## Goal

Add a new example for the paradigm: "offline-first, one server, many clients
with intermittent connectivity."

The client UI should live under `examples/react-crdt/src/lib/server`, alongside
the existing `solo`, `local`, `peerjs`, and `local-first` modes. The server
should be a separate Bun package at `examples/react-crdt-server`, using
`bun.serve`, `bun-plugin-typia`, and a fixed localhost port that clients can
depend on.

## Decisions

- Use fixed `PORT = 8787`.
- Use WebSockets for sync. A health endpoint is still useful, but sync itself
  does not need HTTP snapshot/upload endpoints.
- Persist server state across restarts.
- Duplicate protocol code between client and server for now.
- Support multiple documents from the first pass.
- Do not implement migration, compaction, or snapshots.
- Do not use version vectors for this server mode.
- Add a manual offline toggle to the client UI.
- Keep `examples/react-crdt-server` on its own `tsconfig.json` because it
  depends on Bun globals.

## Existing Context

`examples/react-crdt` already has reusable app abstractions:

- `src/lib/crdtApp.ts` defines generic app definitions, CRDT runtimes, document
  initialization, and app panel props.
- `src/lib/appRegistry.ts` currently registers the todo app and its CRDT/history
  runtimes.
- `src/lib/local-first` already implements durable browser replicas, schema
  fingerprints, persisted CRDT updates, and PeerJS-based intermittent sync.

The new server-backed mode should reuse the durable client-side editing and
persistence ideas, but it should not copy the full peer-to-peer machinery. A
single server is the connection source of truth, so clients can track a simple
server log cursor instead of a version vector.

## Proposed Shape

```text
examples/
  react-crdt/
    src/
      lib/
        server/
          ServerApp.tsx
          ServerControls.tsx
          protocol.ts
          useServerSync.ts
          types.ts
  react-crdt-server/
    package.json
    tsconfig.json
    src/
      index.ts
      protocol.ts
      store.ts
      types.ts
```

`examples/react-crdt/src/lib/server` owns the browser mode. It should load or
create a durable local replica, edit against the local CRDT document, persist
local updates immediately, and opportunistically exchange missing updates with
the server.

`examples/react-crdt-server` owns the fixed-port Bun server. It should accept
updates from any client, persist them in an append-only per-document log, and
answer sync requests from a client-provided `lastSeenMessageIndex`.

## Sync Model

The server maintains an append-only ordered list of accepted CRDT updates for
each document. Each accepted update gets a monotonically increasing server
`messageIndex`. A client stores the highest server message index it has already
applied.

This replaces the heavier local-first version vector model:

- The server is the single authoritative connection point.
- Clients only need "what server message did I last see?"
- The server can answer reconnects by sending all messages after that index.
- If trimming, compaction, or snapshots are added later, the cursor model can
  grow to handle that then.

Batches can be kept minimal. Conceptually, the server log can store one CRDT
update per message. The client may upload several updates in one websocket
message for efficiency, but the server should still assign ordered message
indexes to the accepted updates.

## Server Protocol

Use a small server-specific protocol, duplicated in the client and server
packages for now.

Core messages:

- `hello`: client announces actor, doc id, schema fingerprint, and
  `lastSeenMessageIndex`.
- `clientUpdates`: client uploads one or more local CRDT updates that are not
  known to be in the server log yet.
- `serverUpdates`: server sends log entries with
  `messageIndex > lastSeenMessageIndex`.
- `ack`: server acknowledges accepted client updates with their assigned
  message indexes.
- `syncRequest`: client asks the server to resend entries after a given
  `lastSeenMessageIndex`.
- `error`: either side reports invalid schema, invalid update shape, unknown
  message kind, or another protocol issue.

Do not implement migration, compaction, snapshots, or vector-clock sync in the
first pass.

## Bun Server Package

Create `examples/react-crdt-server/package.json` with scripts similar to:

```json
{
    "private": true,
    "type": "module",
    "scripts": {
        "dev": "bun --bun src/index.ts",
        "typecheck": "tsc -p tsconfig.json --noEmit"
    },
    "dependencies": {
        "bun-plugin-typia": "...",
        "typia": "...",
        "umkehr": "link:../.."
    },
    "devDependencies": {
        "typescript": "..."
    }
}
```

The server should:

- Use fixed exported `PORT = 8787`.
- Use `Bun.serve({port: PORT, fetch, websocket})`.
- Support CORS for the Vite client origin.
- Use `bun-plugin-typia` for typia transforms.
- Validate incoming messages with typia-backed validators and CRDT update
  validators.
- Keep server state per `docId` and schema fingerprint.
- Persist server state across restarts.

Use a small Bun-friendly durable store. JSONL is probably enough for the first
pass:

- One server log file per document, or one log file whose entries include
  `docId`.
- Each stored entry includes `messageIndex`, `docId`, `origin`, `receivedAt`,
  and the CRDT update payload.
- On startup, replay the log into memory to rebuild per-document message lists
  and next message indexes.
- A simple debug reset can be deferred unless it becomes useful for demos.

## Client Mode

Add a new `server` mode to the React example:

- Add mode routing in `src/App.tsx`.
- Add a tab label in `src/lib/ModeTabs.tsx`.
- Add `src/lib/server/ServerApp.tsx` that mirrors the durable local replica
  behavior of `LocalFirstApp`, without migration or schema-upgrade flows.
- Add `useServerSync.ts` for websocket connection state, reconnect/backoff,
  upload queueing, sync request/response handling, and server-log cursor
  tracking.
- Persist `lastSeenMessageIndex` with the local replica.
- Reuse `runtime.Provider` and `app.renderPanel(...)` exactly like the other
  CRDT modes.

The user-visible behavior should make intermittent connectivity obvious:

- Client can edit while disconnected.
- Local edits persist in IndexedDB immediately.
- Reconnect uploads queued local updates.
- Server returns changes from other clients.
- Conflicting edits converge through the existing CRDT merge semantics.
- Controls expose connection state, `lastSeenMessageIndex`, pending upload
  count, received update count, and last sync time.
- A manual offline/online toggle lets demos simulate intermittent connectivity
  without stopping the server.

## Data Flow

1. Browser loads local replica from IndexedDB or creates a new one.
2. Browser connects to `ws://localhost:8787/sync`.
3. Browser sends `hello` with doc id, schema metadata, actor id, and
   `lastSeenMessageIndex`.
4. Server responds with all log entries after `lastSeenMessageIndex`.
5. Local edits apply immediately to the browser CRDT history.
6. Browser persists local updates and attempts upload.
7. Server validates each update, assigns message indexes, appends the entries
   to durable storage, and acknowledges the accepted indexes.
8. Server broadcasts new log entries to connected clients for the same
   document.
9. Disconnected clients continue editing locally and reconcile on reconnect.

## Implementation Steps

1. Define constants and protocol boundaries.
   - Use fixed `PORT = 8787`.
   - Use WebSocket path `/sync`.
   - Duplicate protocol types in the client and server example packages.
   - Define CORS and websocket message envelopes.
   - Use `lastSeenMessageIndex` as the client sync cursor.

2. Scaffold `examples/react-crdt-server`.
   - Add `package.json`, `tsconfig.json`, and `src/index.ts`.
   - Configure Bun and `bun-plugin-typia`.
   - Add a health endpoint such as `GET /health`.
   - Add websocket upgrade handling for `/sync`.

3. Implement server state.
   - Store documents by `docId`.
   - Track schema fingerprint per document.
   - Store append-only update log entries.
   - Maintain the next message index per document.
   - Persist entries across restarts, likely using JSONL or another simple
     file-backed format.
   - Do not implement migration, compaction, or snapshots.

4. Implement server message handling.
   - Validate message shape and schema metadata.
   - Accept client updates and assign server message indexes.
   - Answer `hello` and `syncRequest` by sending entries after
     `lastSeenMessageIndex`.
   - Acknowledge accepted client updates.
   - Broadcast new server log entries to connected clients.
   - Decide the minimal duplicate-upload handling needed for reconnects. This
     may be a client-generated update id, or the client may keep pending
     uploads until the server acknowledges assigned message indexes.

5. Add the client server mode.
   - Create `src/lib/server` files.
   - Load/create the durable local replica using the same IndexedDB persistence
     ideas as `local-first`, without migration support.
   - Persist `lastSeenMessageIndex` with the local replica.
   - Add websocket sync and retry behavior.
   - Add a manual offline toggle that closes/suppresses the websocket while
     local editing continues.
   - Render app panel through the existing CRDT runtime.
   - Add controls for connect/disconnect and sync status.

6. Wire the mode into the existing app.
   - Extend hash mode parsing.
   - Add the mode tab.
   - Mount `ServerApp` from `App.tsx`.
   - Document running both processes in the README.

7. Verify.
   - Build the root package.
   - Typecheck/build `examples/react-crdt`.
   - Typecheck/start `examples/react-crdt-server`.
   - Manually test two browser clients: edit offline, reconnect, and confirm
     convergence.
   - Restart the server and confirm persisted log entries are still served.
   - Add focused tests for protocol/session logic if the extracted logic is
     pure enough to test without a browser.

## Remaining Open Questions

- What durable format should the server use: JSONL for maximum readability, or
  SQLite for easier indexed lookup once the log grows?
  - SQLite
- What is the cleanest representation of "pending local update not yet assigned
  a server message index" in IndexedDB?
  - do local updates need server message indices? the server shouldn't be sending them back to us (it should only send updates from other clients)
- Should clients send one CRDT update per server log message, or group several
  local CRDT updates in one upload while the server still assigns individual
  message indexes?
  - let's stream one by one for now
- Should duplicate upload prevention use a client-generated id per local update,
  or is ack-based pending queue management enough for this example?
  - local updates will have unique HLC timestamps, server should respond with timestamps it has recorded
- Should the server expose a small debug view/log endpoint for development, even
  though sync itself is WebSocket-only?
  - yes please
