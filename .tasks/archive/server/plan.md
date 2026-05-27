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
- Persist server state in SQLite.
- Duplicate protocol code between client and server for now.
- Support multiple documents from the first pass.
- Do not implement migration, compaction, or snapshots.
- Do not use version vectors for this server mode.
- Stream client updates one by one for now.
- Local updates have unique HLC timestamps. The server should acknowledge the
  HLC timestamps it has recorded.
- The server should not echo a client's own recorded updates back to that same
  client.
- Add a manual offline toggle to the client UI.
- The client should maintain a full timestamp-sorted list of all known changes
  so the user can scrub through document history.
- The history scrubber should show timestamps only for now.
- History scrubbing is preview-only for now.
- Add a small debug view/log endpoint on the server.
- The debug endpoint should be HTML.
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
          ServerHistoryView.tsx
          persistence.ts
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
local updates immediately, keep a full timestamp-sorted change list for history
scrubbing, and opportunistically exchange missing remote updates with the
server.

`examples/react-crdt-server` owns the fixed-port Bun server. It should accept
updates from any client, persist them in an append-only per-document SQLite log,
and answer sync requests from a client-provided `lastSeenMessageIndex`.

## Sync Model

The server maintains an append-only ordered list of accepted CRDT updates for
each document. Each accepted update gets a monotonically increasing server
`messageIndex`. A client stores the highest server message index it has already
seen from other clients.

This replaces the heavier local-first version vector model:

- The server is the single authoritative connection point.
- Clients only need "what server message did I last see?"
- The server can answer reconnects by sending all messages after that index,
  excluding entries from the requesting client.
- If trimming, compaction, or snapshots are added later, the cursor model can
  grow to handle that then.

Batches can be discarded conceptually for this example. Stream one CRDT update
per client message and store one CRDT update per server log entry. The server
still assigns ordered message indexes for replay to other clients, but the
originating client does not need those indexes for its own local history.

## History Scrubbing Model

Each client should maintain a full list of all known changes, sorted by HLC
timestamp:

- Local changes are added immediately when produced.
- Remote server changes are added when received.
- Pending local changes remain in the list while offline or awaiting server
  acknowledgement.
- Server acknowledgement marks the matching HLC timestamp as recorded.
- The list is persisted in IndexedDB with the local replica.
- The UI can scrub through this list and preview the document at a selected
  timestamp.

This history list is separate from `lastSeenMessageIndex`. The cursor tracks
what remote server log entries have been seen. The history list drives the user
experience for browsing and previewing known document evolution.

## Server Protocol

Use a small server-specific protocol, duplicated in the client and server
packages for now.

Core messages:

- `hello`: client announces actor, doc id, schema fingerprint, and
  `lastSeenMessageIndex`.
- `clientUpdate`: client uploads one local CRDT update that is not yet recorded
  by the server.
- `serverUpdates`: server sends log entries with
  `messageIndex > lastSeenMessageIndex`, excluding entries from the receiving
  client's actor.
- `ack`: server acknowledges an accepted client update by returning the HLC
  timestamp it recorded.
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
- Expose a small debug endpoint or page.

Use SQLite for durable server storage:

- A `documents` table tracks `docId`, schema fingerprint, and next message
  index.
- A `messages` table stores `messageIndex`, `docId`, `origin`, `hlcTimestamp`,
  `receivedAt`, and the CRDT update payload as JSON.
- Index `(docId, messageIndex)` for reconnect replay.
- Index `(docId, hlcTimestamp)` for duplicate detection and ack lookup.
- On startup, read the database normally; no in-memory replay-only design is
  required, though a small in-memory cache is fine for connected clients.
- The debug endpoint should show known documents, message counts, recent
  messages, and connected clients.

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
- Persist all local and remote changes in a timestamp-sorted history list.
- Add a history scrubber UI that can preview the document at a selected change.
- Reuse `runtime.Provider` and `app.renderPanel(...)` exactly like the other
  CRDT modes.

The user-visible behavior should make intermittent connectivity obvious:

- Client can edit while disconnected.
- Local edits persist in IndexedDB immediately.
- Reconnect uploads queued local updates one by one.
- Server acknowledges local updates by HLC timestamp.
- Server returns changes from other clients.
- Conflicting edits converge through the existing CRDT merge semantics.
- User can scrub through the complete known change history in timestamp order.
- Controls expose connection state, `lastSeenMessageIndex`, pending upload
  count, received update count, and last sync time.
- A manual offline/online toggle lets demos simulate intermittent connectivity
  without stopping the server.

## Data Flow

1. Browser loads local replica, `lastSeenMessageIndex`, and timestamp-sorted
   change list from IndexedDB, or creates new local state.
2. Browser connects to `ws://localhost:8787/sync`.
3. Browser sends `hello` with doc id, schema metadata, actor id, and
   `lastSeenMessageIndex`.
4. Server responds with all log entries after `lastSeenMessageIndex`, excluding
   entries from the same actor.
5. Local edits apply immediately to the browser CRDT history and are inserted
   into the local timestamp-sorted change list.
6. Browser streams pending local updates to the server one at a time.
7. Server validates each update, deduplicates by `(docId, hlcTimestamp)`,
   assigns a message index, appends the entry to SQLite, and acknowledges the
   recorded HLC timestamp.
8. Server broadcasts new log entries to connected clients for the same
   document, excluding the origin actor.
9. Receiving clients apply remote updates, insert them into their
   timestamp-sorted change lists, and advance `lastSeenMessageIndex`.
10. Disconnected clients continue editing locally and reconcile on reconnect.

## Implementation Steps

1. Define constants and protocol boundaries.
   - Use fixed `PORT = 8787`.
   - Use WebSocket path `/sync`.
   - Duplicate protocol types in the client and server example packages.
   - Define CORS and websocket message envelopes.
   - Use `lastSeenMessageIndex` as the client sync cursor.
   - Use HLC timestamps as local update identities and server ack keys.

2. Scaffold `examples/react-crdt-server`.
   - Add `package.json`, `tsconfig.json`, and `src/index.ts`.
   - Configure Bun and `bun-plugin-typia`.
   - Add a health endpoint such as `GET /health`.
   - Add a debug endpoint or page for documents, messages, and connected
     clients.
   - Add websocket upgrade handling for `/sync`.

3. Implement server state.
   - Store documents by `docId`.
   - Track schema fingerprint per document.
   - Store append-only update log entries in SQLite.
   - Maintain the next message index per document.
   - Deduplicate by `(docId, hlcTimestamp)`.
   - Do not implement migration, compaction, or snapshots.

4. Implement server message handling.
   - Validate message shape and schema metadata.
   - Accept one client update per message and assign a server message index.
   - Answer `hello` and `syncRequest` by sending entries after
     `lastSeenMessageIndex`, excluding the requesting actor's entries.
   - Acknowledge accepted or already-recorded client updates by HLC timestamp.
   - Broadcast new server log entries to connected clients except the origin.

5. Add the client server mode.
   - Create `src/lib/server` files.
   - Load/create the durable local replica using the same IndexedDB persistence
     ideas as `local-first`, without migration support.
   - Persist `lastSeenMessageIndex` with the local replica.
   - Persist all local and remote changes in a timestamp-sorted history list.
   - Add a history scrubber UI that can preview the document at a selected
     change.
   - Add websocket sync and retry behavior.
   - Stream pending local updates one by one.
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
   - Restart the server and confirm persisted SQLite log entries are still
     served.
   - Verify the client history scrubber includes local and remote changes in
     timestamp order.
   - Verify duplicate local update replay after reconnect is handled by HLC
     timestamp.
   - Add focused tests for protocol/session logic if the extracted logic is
     pure enough to test without a browser.

## Remaining Open Questions

None for the first implementation pass.
