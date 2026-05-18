# Server presence research

This document maps the architecture relevant to adding presence indicators to the `examples/react-crdt/src/lib/server` example and records the open questions before implementation.

The requested behavior has three parts:

- a Google Docs-like "who is online" indicator for the server-backed document;
- a small cursor/marker on the last thing each user edited, using the existing `StatusStore`;
- an inline blame action for todo titles showing who added or last edited that title.

## Current architecture

### React CRDT runtime

`src/react-crdt/react-crdt.tsx` owns the reusable synced editor runtime.

Important pieces:

- `createSyncedContext` creates a provider and hook for a CRDT-backed editor.
- `SyncedTransport` is the sync boundary: `{actor, tick, publish, subscribe}`.
- Local edits call `applyLocalCommand`, save the new local history, notify changed paths, then publish CRDT updates through the transport.
- Remote edits call `applyRemoteHistoryUpdate`, save the history, compute changed normal paths with `changedNormalPathsForCrdtUpdate`, then notify the affected path subscribers.
- The provider already accepts an optional `statuses?: StatusStore` prop. If absent, it creates an internal store.
- `useStatuses` is exported from `umkehr/react-crdt` and reads the provider's status store through the same typed path-builder context as `useValue`.

This means the UI can already render path-scoped non-document metadata:

```ts
const titleStatuses = useStatuses(editor.$.todos[index].title);
const rowStatuses = useStatuses(editor.$.todos[index], {descendants: true});
```

No core React context change is required for basic presence markers as long as the server mode can create and pass a `StatusStore` into the provider.

### Status store

`src/statuses.ts` is a framework-neutral path-indexed store.

Status shape:

```ts
type Status = {
    id: string;
    path: Path;
    kind: string;
    message?: string;
    data?: unknown;
};
```

Store operations:

- `get(path, query?)`;
- `subscribe(path, query, listener)`;
- `add(statuses)`;
- `clear(id)`;
- `clearAll()`.

The store indexes both exact paths and ancestor/descendant paths. `useStatuses` already has tests for exact subscriptions, descendant subscriptions, and kind filtering in `src/react-crdt/react-crdt.test.tsx`.

Implication for presence:

- "Last edited here by Alice" should be a `Status` with a stable id such as `presence:last-edit:${actor}`.
- The status `path` should be the latest normal path changed by that actor.
- The status `kind` can be open-ended, for example `presence:last-edit`.
- `data` can carry `{actor, label, color, timestamp, receivedAt}`.

### CRDT metadata and authorship

CRDT update timestamps already contain the HLC actor identity.

Relevant code:

- `src/crdt/hlc.ts` packs/unpacks timestamps.
- `src/crdt/metadata.ts` stores timestamps on metadata:
  - primitive values use `meta.ts`;
  - object/record/array/tagged containers use `created`;
  - tagged branches also have `tagTs`;
  - tombstones use `deleted`;
  - array order metadata has `{value, ts}`.
- `src/crdt/path.ts` can translate CRDT paths to public normal paths with `normalPathForCrdtPath` and `changedNormalPathsForCrdtUpdate`.
- `examples/react-crdt/src/lib/local-first/vector.ts` already has `actorForTimestamp(timestamp)` implemented via `hlc.unpack(timestamp).node`.

This is enough to infer authorship from current document metadata for many fields:

- the actor for a primitive field's current value is the node in `PrimitiveMeta.ts`;
- the actor who created an object/array item is the node in `created`;
- the actor who deleted something is the node in a tombstone's `deleted`;
- the actor who changed array order is the node in the order timestamp.

For todo title blame, the most direct target is `todos[index].title`, whose metadata should normally be a primitive. "Last edited" can use that primitive timestamp. "Added" can use the containing todo item/container creation timestamp.

Important caveat: the public UI path for todos uses array indices, while CRDT paths use stable array item ids. For current visible items, translating from the current index path to CRDT metadata is possible with `crdtPathForExisting(doc, normalPath)`, then `getMetaAtPath(doc.meta, crdtPath)`. For historical/deleted todos, a numeric index is not stable enough; this task only asks for a given visible todo.

### Server client mode

The browser-side server sync code is present under `examples/react-crdt/src/lib/server`:

- `types.ts` defines `ServerSync`, `ServerChange`, `ServerSyncState`, and stores exposed to UI.
- `protocol.ts` defines versioned messages:
  - client to server: `hello`, `clientUpdate`, `syncRequest`;
  - server to client: `hello`, `serverUpdates`, `ack`, `error`.
- `useServerSync.ts` owns the WebSocket, reconnect loop, pending local uploads, server cursor, local change log, and `SyncedTransport`.
- `persistence.ts` stores durable browser identity and per-document replica state in IndexedDB.

The transport already records actor identity in three places:

- `identity.replicaId` is the local actor.
- each `ServerChange` has `origin`.
- each server log entry has `origin`.

The browser-side hook currently exchanges only CRDT update messages. It has no presence protocol and no status store.

The separate Bun server package directory exists at `examples/react-crdt-server`, but it is currently empty in this checkout. The older server plan expects a Bun server at fixed port `8787` with WebSocket path `/sync`.

### Todo UI

`examples/react-crdt/src/apps/todos/TodoPanel.tsx` is the app-specific surface.

Relevant details:

- `TodoPanel` receives a generic `AppEditorContext<TodoState>`, an actor id, panel title, and grid slot.
- It reads `bgcolor` and `todos` with `useValue`.
- Each `TodoItem` receives `{editor, todo, index}` and edits through `editor.$.todos[index]`.
- There is no current status rendering in the todo UI.

Because `useStatuses` is available from `umkehr/react-crdt`, a server-mode todo panel can render statuses without changing the core app model, but the current `AppEditorContext` type does not expose server-specific presence or blame APIs.

## Recommended implementation shape

### Keep presence in the server example

Do not add presence to `SyncedTransport`. Presence is transport-specific, ephemeral, and not part of CRDT document replication.

Recommended server-mode state:

```ts
type ServerPresenceUser = {
    actor: string;
    label: string;
    color: string;
    online: boolean;
    lastSeenAt: string;
    lastEdit?: {
        path: Path;
        timestamp: HlcTimestamp;
        receivedAt: string;
    };
};
```

Expose it from `ServerSync` as another external store:

```ts
presenceStore: ExternalStore<ServerPresenceUser[]>;
statusStore: StatusStore;
```

Then `ServerApp` can pass `statusStore` into `runtime.Provider`.

### Extend the server protocol with ephemeral presence messages

Add messages alongside the CRDT sync protocol:

```ts
type ClientServerMessage =
    | ExistingMessages
    | {
          kind: 'presenceHello';
          version: 1;
          actor: string;
          docId: string;
          label: string;
          color: string;
      };

type ServerClientMessage =
    | ExistingMessages
    | {
          kind: 'presenceSnapshot';
          version: 1;
          docId: string;
          users: ServerPresenceUser[];
      }
    | {
          kind: 'presenceUpdate';
          version: 1;
          docId: string;
          user: ServerPresenceUser;
      }
    | {
          kind: 'presenceLeave';
          version: 1;
          docId: string;
          actor: string;
          at: string;
      };
```

Presence should remain non-durable. The server can derive online state from open sockets and broadcast leave on socket close. The client can preserve the local user's label/color in IndexedDB or derive it from the replica id.

`hello` could be extended with label/color instead of adding `presenceHello`. A separate presence message is cleaner because it keeps document sync and ephemeral session state distinct.

### Derive last-edit cursor statuses in the client

The client already sees every local and remote CRDT update as it flows through `useServerSync`.

For each accepted local publish:

1. compute changed normal paths from the provider if possible, or from update paths plus current history;
2. update `presenceStore` for local actor's `lastEdit`;
3. add/replace a status in `statusStore`.

For each remote `ServerLogEntry`:

1. apply the update through `transport.receive(entry.update)`;
2. compute the changed normal path while applying or immediately after, using before/after documents;
3. update that actor's `lastEdit`;
4. add/replace `presence:last-edit:${entry.origin}` in the status store.

The tricky part is location computation. `useServerSync` sits outside the provider and currently does not own the mutable CRDT history after remote updates; the provider applies remote updates internally when `transport.receive` fires. Options:

1. Move "changed path" reporting into the transport boundary by adding an optional callback from the provider to the server sync layer.
2. Have `useServerSync.saveHistory(history)` compare the previous and new history around local/remote updates, but it does not know which actor caused a save unless the sync hook tracks a pending receive context.
3. Recompute path from the update and a document snapshot in `useServerSync` before calling `transport.receive`, then trust provider application to match. This is awkward because `useServerSync` has `historyRef`, but that ref is only updated when `saveHistory` is called by the provider.

Most pragmatic direction for the example:

- In `useServerSync`, keep `historyRef.current` synchronized through `saveHistory`.
- For remote updates, before calling `transport.receive`, capture `before = historyRef.current.doc`; after the provider calls `saveHistory`, `historyRef.current.doc` will be updated, but that happens through React/provider control and may not be synchronous enough to compute immediately.
- Add a small optional `onRemoteUpdateApplied` mechanism only inside the example if necessary, but prefer a pure helper in the provider if this becomes awkward.

An alternative is to set the cursor from `changedNormalPathsForCrdtUpdate(before, applyRemoteHistoryUpdate(historyRef.current, update).doc, update)` inside `useServerSync`, then call `transport.receive(update)`. This duplicates the apply for path calculation but does not mutate the persisted history. For example code, that is acceptable if documented and tested.

### Render presence in the todo panel

Add a small UI component that consumes row/title statuses:

```ts
const titleStatuses = useStatuses(editor.$.todos[index].title, {
    kinds: ['presence:last-edit'],
});
```

For the "cursor" marker:

- render a compact colored chip next to the title or at the row edge;
- hide the local actor's marker if it is too noisy, or render it differently;
- if multiple users last edited the same path, render a small stack.

For the online roster:

- `ServerControls` or `ServerApp` should render `presenceStore`;
- show local actor plus connected remote actors;
- use deterministic colors derived from actor id unless a user profile concept is added.

### Inline blame for todo title

This should be a document-metadata query, not a server log scan, for the current visible todo.

Candidate helper:

```ts
type TodoTitleBlame = {
    titleLastEditedBy: string;
    titleLastEditedAt: HlcTimestamp;
    todoAddedBy?: string;
    todoAddedAt?: HlcTimestamp;
};
```

Implementation route:

1. Get the current CRDT history with `editor.useLocalHistory()`.
2. Translate `[{key: 'todos'}, {key: index}, {key: 'title'}]` to a CRDT path using `crdtPathForExisting`.
3. Read title metadata with `getMetaAtPath(history.doc.meta, titleCrdtPath)`.
4. If the title meta is `primitive`, unpack `meta.ts` to get last editor.
5. Translate `[{key: 'todos'}, {key: index}]` and read the todo item/container metadata to get creation timestamp.
6. Render the actor labels using the presence/user directory when available, falling back to actor id.

This likely requires exporting `crdtPathForExisting` and `getMetaAtPath` if they are not already public enough for the example. `src/crdt/index.ts` currently exports `changedNormalPathsForCrdtUpdate` and `normalPathForCrdtPath` from `path.ts`, but not `crdtPathForExisting` or `getMetaAtPath`.

Alternative: scan the local `changesStore` for updates affecting the todo title path. This is harder because historical array indices are unstable and CRDT paths contain array item ids. The metadata route is more accurate for "current field last edited by".

## Open questions

- User identity: should actors be displayed as raw replica ids, generated friendly names, or user-editable names persisted with the server identity?
- Local user in presence: should the online roster include the current client, or only other connected clients?
- Offline display: when a socket closes unexpectedly, should remote users disappear immediately, or remain as "recently online" for a short TTL?
- Protocol shape: should presence fields be added to existing `hello`, or should presence use separate messages?
- Cursor scope: should the last-edit marker point to the most specific changed field, the todo row containing it, or both?
- Multiple updates per command: local commands can publish multiple CRDT updates. Should the cursor use the last update in the command, the first user-visible path, or aggregate all changed paths?
- Local cursor: should the current user's own last-edit marker be visible?
- Status lifecycle: should last-edit statuses persist while the user is online only, or remain after disconnect as "last seen editing here"?
- Status replacement: `StatusStore` can replace a status by reusing its id, but it has no source-level clear. Do we need a helper to clear all presence statuses for an actor on leave?
- Blame semantics: does "who added the title" mean who created the todo item, who first set the title field, or both?
- Undo/redo semantics: should undo/redo change blame to the actor performing the undo/redo, or preserve the original author restored by undo metadata? Current CRDT updates generated by undo/redo use fresh timestamps, so "last edited" will naturally be the undoing actor.
- Server authority: should the server broadcast `lastEdit` metadata, or should every client derive it independently from received updates?
- Validation: how strict should presence message validation be in the example server? The CRDT update protocol validates updates; presence messages still need basic actor/doc/label/color checks.
- Empty server package: the Bun server directory currently has no implementation in this checkout. Presence cannot be fully wired until the server package has the WebSocket connection registry.

## Suggested first pass

1. Add presence types and stores to the browser-side server sync layer.
2. Add ephemeral presence messages to client/server protocol definitions.
3. Implement server-side connection tracking when the Bun server exists.
4. Pass a `StatusStore` from server mode into the CRDT provider.
5. Derive `presence:last-edit` statuses from local publishes and remote server entries.
6. Render online users and path-scoped cursor chips in the todo UI.
7. Add a small blame helper for current todo title metadata and expose it behind an item-level button.
8. Test the pure helpers first: actor extraction from timestamps, metadata blame lookup, and last-edit status replacement.
