# Server Presence Implementation Plan

## Goal

Add presence to the server-backed React CRDT example:

- show which logged-in users are online;
- show small row-level cursor indicators for the last todo each remote session edited;
- show title blame in a hover tooltip on each todo, using the most recent title editor.

This builds on the current server-user model:

- users log in by nickname;
- server assigns durable `userId`;
- browser sessions have query-param `sessionId`;
- CRDT/HLC actors are `${userId}:${sessionId}`;
- a single user may have multiple live sessions.

## Decisions

- Keep presence example-local. Do not add presence to `SyncedTransport`.
- Use separate protocol messages for presence instead of extending sync `hello`.
- Presence protocol uses version `2` and validates actor/user consistency like sync messages.
- Online roster excludes the current client.
- Multiple sessions for one user render as one online person.
- Multiple sessions for one user may still produce multiple cursors because cursors are actor/session-scoped.
- Cursor badges show the first letter of the nickname with a background color derived from a hash of `userId`.
- Cursor statuses are keyed by full actor id: one status per actor.
- Cursor scope is the containing todo row, not the specific edited field.
- For commands that produce multiple CRDT updates, cursor location uses the last user-visible changed path.
- The local user's own cursor is hidden.
- Cursor statuses are ephemeral: clear when the actor leaves or after roughly one minute, whichever happens first.
- Blame for a todo title means the most recent edit of the title field.
- Undo/redo blame should respect fresh CRDT timestamps, so the undoing/redoing actor becomes the latest editor.
- Last-edit cursor metadata is derived from CRDT updates on each client, not broadcast by the server.

## Data Model

Add browser/server shared shape equivalents in the duplicated protocol/type files:

```ts
type ServerPresenceSession = {
    actor: string;
    userId: string;
    sessionId: string;
    nickname: string;
    color: string;
    online: true;
    lastSeenAt: string;
};

type ServerPresenceUser = {
    userId: string;
    nickname: string;
    color: string;
    sessions: ServerPresenceSession[];
};
```

Browser-only status data can include last edit details:

```ts
type ServerLastEditStatusData = {
    actor: string;
    userId: string;
    sessionId: string;
    nickname: string;
    color: string;
    timestamp: HlcTimestamp;
    receivedAt: string;
};
```

Use deterministic color helpers in server-mode client code:

- `colorForUserId(userId): string`
- `initialForNickname(nickname): string`

Keep colors derived from `userId` so all sessions and clients render the same user consistently.

## Protocol

Extend both protocol files:

- `examples/react-crdt/src/lib/server/protocol.ts`
- `examples/react-crdt-server/src/protocol.ts`

Add client message:

```ts
{
    kind: 'presenceHello';
    version: 2;
    actor: string;
    userId: string;
    docId: string;
    color: string;
}
```

Add server messages:

```ts
{
    kind: 'presenceSnapshot';
    version: 2;
    docId: string;
    users: ServerPresenceUser[];
}
```

```ts
{
    kind: 'presenceUpdate';
    version: 2;
    docId: string;
    user: ServerPresenceUser;
}
```

```ts
{
    kind: 'presenceLeave';
    version: 2;
    docId: string;
    actor: string;
    userId: string;
    sessionId: string;
    at: string;
}
```

Validation rules:

- reject non-v2 messages;
- require non-empty `actor`, `userId`, and `docId`;
- parse `actor` as `${userId}:${sessionId}`;
- reject if parsed `userId !== message.userId`;
- for presence messages, reject if the server does not know the supplied `userId`;
- keep color validation simple: require a non-empty string from a small known palette or a valid hex value.

## Server Work

Update `examples/react-crdt-server/src/types.ts`:

- add `ServerPresenceSession`;
- add `ServerPresenceUser`;
- add presence fields to connected-client debug shape if useful.

Update `examples/react-crdt-server/src/store.ts`:

- add `getUserById(userId): ServerUser | null`.

Update `examples/react-crdt-server/src/protocol.ts`:

- add presence message types;
- extend `parseClientMessage` to accept and validate `presenceHello`;
- keep actor/user validation shared with sync messages.

Update `examples/react-crdt-server/src/index.ts`:

- track presence metadata on `ws.data`:
  - `actor`;
  - `userId`;
  - `sessionId`;
  - `nickname`;
  - `color`;
  - `docId`;
  - presence-ready flag.
- after a valid sync `hello`, client can send `presenceHello`;
- on `presenceHello`:
  - validate duplicate session handling remains intact;
  - look up the user by `userId`;
  - store nickname/color on the socket;
  - send a `presenceSnapshot` for the document to that socket, excluding that socket;
  - broadcast `presenceUpdate` for that user to other sockets in the same document.
- on socket close:
  - remove socket from `clients`;
  - broadcast `presenceLeave` to remaining sockets in the same document when the closing socket had presence metadata.
- when constructing `presenceSnapshot` or `presenceUpdate`:
  - group sessions by `userId`;
  - exclude the requesting actor for snapshots;
  - exclude closed/non-presence-ready sockets;
  - include all live sessions for each remote user.
- update `/debug` to show presence-ready state, nickname, and color.

## Browser Sync Work

Update `examples/react-crdt/src/lib/server/types.ts`:

- add `ServerPresenceSession`;
- add `ServerPresenceUser`;
- add `ServerPresenceState` if useful;
- extend `ServerSync<TState>` with:

```ts
presenceStore: ExternalStore<ServerPresenceUser[]>;
statusStore: StatusStore;
```

Update `examples/react-crdt/src/lib/server/protocol.ts`:

- add presence message types;
- parse `presenceSnapshot`, `presenceUpdate`, and `presenceLeave`;
- validate user/session shape enough to avoid corrupting UI state.

Add a helper file if useful, for example `examples/react-crdt/src/lib/server/presence.ts`:

- `colorForUserId`;
- `initialForNickname`;
- `upsertPresenceUser`;
- `removePresenceSession`;
- `presenceUsersFromSessions`;
- `statusForLastEdit`;
- `collapsePathToTodoRow(path): Path | null`.

Update `examples/react-crdt/src/lib/server/useServerSync.ts`:

- create `presenceStore` with initial `[]`.
- create a `StatusStore` with `createStatusStore()`.
- send `presenceHello` after the socket opens and sync `hello` is sent.
- handle `presenceSnapshot` by replacing current presence users.
- handle `presenceUpdate` by upserting the remote user, excluding the current actor.
- handle `presenceLeave` by:
  - removing the actor's session from `presenceStore`;
  - clearing `presence:last-edit:${actor}` from `statusStore`.
- derive remote last-edit statuses when receiving `serverUpdates`:
  - skip local actor;
  - compute the changed path from the update;
  - use the last user-visible path when multiple updates are processed;
  - collapse the path to the containing todo row;
  - add/replace `presence:last-edit:${entry.origin}`;
  - schedule that status to clear after about one minute.
- derive local last-edit location only if needed for internal consistency, but do not render the local actor's cursor.
- clear any scheduled cursor timer when replacing or clearing that actor's status.

Path computation direction:

- Prefer computing before calling `transport.receive` with a non-mutating preview apply:
  - `before = historyRef.current.doc`;
  - `previewHistory = applyRemoteHistoryUpdate(historyRef.current, update)`;
  - `changedNormalPathsForCrdtUpdate(before, previewHistory.doc, update)`;
  - then call `transport.receive(update)` normally.
- For local publishes, use the current history ref and a non-mutating preview apply per update if needed. If this is too awkward and local cursors stay hidden, local status derivation can be skipped.

Todo row collapse:

- For paths under `todos[index]`, use the row path `[{type: 'key', key: 'todos'}, {type: 'key', key: index}]`.
- For reorder/setOrder paths that only resolve to `todos`, do not show a row cursor unless the update path contains an array item id that can be mapped to a current row.
- For non-todo paths such as `bgcolor`, do not show a todo cursor.

## Provider Wiring

Update `examples/react-crdt/src/lib/server/ServerApp.tsx`:

- pass `statuses={sync.statusStore}` to the CRDT `Provider`;
- pass presence data to UI surfaces that are server-specific:
  - `ServerControls` receives `sync.presenceStore`;
  - todo panel can consume statuses through `useStatuses`.

The app panel still receives only `actor` through the existing `renderPanel` API. Avoid expanding the generic `AppEditorContext` for server-only concerns unless the tooltip blame lookup cannot be implemented cleanly.

## Todo UI Work

`examples/react-crdt/src/apps/todos/TodoPanel.tsx` already has uncommitted reorder/drag changes. Integrate presence UI with the current row structure:

- import `useStatuses` from `umkehr/react-crdt`;
- in `TodoItem`, read row statuses:

```ts
const presenceStatuses = useStatuses(editor.$.todos[index], {
    kinds: ['presence:last-edit'],
});
```

- ignore statuses where `data.actor === replicaId` or current actor if available;
- render one or more small cursor badges on the todo row:
  - badge text is `initialForNickname(nickname)`;
  - badge background is `colorForUserId(userId)`;
  - title/tooltip can include nickname and session id;
  - visually attach to the row without disrupting drag/drop layout.
- add CSS classes for cursor badges and row positioning.

Because `TodoItem` currently does not receive `replicaId`, either:

- pass the current actor down from `TodoPanel`; or
- rely on `useServerSync` not creating local actor statuses.

Prefer not creating local actor statuses, then the todo UI stays generic.

## Blame Work

Add a small CRDT metadata helper, likely under `examples/react-crdt/src/apps/todos/blame.ts` or `examples/react-crdt/src/lib/server/blame.ts`.

Needed core exports:

- export `crdtPathForExisting` from `src/crdt/index.ts`;
- export `getMetaAtPath` from `src/crdt/index.ts`;
- possibly export a tiny `versionOf`/metadata timestamp helper if direct meta switching gets noisy.

Blame helper behavior:

- input:
  - `history: CrdtLocalHistory<TodoState>`;
  - `index: number`;
  - optional known users/presence directory for labels.
- translate `todos[index].title` to a CRDT path with `crdtPathForExisting`;
- read title metadata with `getMetaAtPath`;
- if title metadata is primitive:
  - use `meta.ts` as the most recent title edit timestamp;
  - unpack actor with `hlc.unpack(meta.ts).node`;
  - parse actor with `parseSessionActor`;
  - map `userId` to nickname from presence/known user data when available;
  - fallback to full actor id;
- expose result:

```ts
type TodoTitleBlame = {
    actor: string;
    userId?: string;
    sessionId?: string;
    nickname?: string;
    timestamp: HlcTimestamp;
};
```

UI:

- do not add a blame button;
- compute blame for each visible todo row;
- attach native `title` text to the todo title or row;
- tooltip text should answer "last edited title by X";
- include the timestamp in compact form if it does not make the tooltip noisy.

Native `title` delay is browser-controlled, so the plan should not try to implement an exact 300ms timer unless native behavior is too inconsistent during manual testing.

Do not implement "created by" in the first pass because the decision is title field's most recent edit.

## Controls UI

Update `examples/react-crdt/src/lib/server/ServerControls.tsx`:

- read `sync.presenceStore`;
- render online users excluding the current actor;
- group multiple sessions for one user as one person;
- show a small session count when `sessions.length > 1`;
- keep the existing nickname/user/session/actor debug fields.

## Styling

Update `examples/react-crdt/src/style.css`:

- presence roster in server controls;
- cursor badge stack on todo rows;
- native title tooltip text for blame, plus any small layout adjustments needed for cursor badges;
- ensure row layout remains stable with drag handle, checkbox, title, cursor badges, and action buttons.

## Tests

Add focused tests where practical.

Core/server tests:

- protocol rejects invalid `presenceHello` actor/user mismatch;
- protocol accepts valid `presenceHello`;
- store `getUserById` returns existing users;
- presence grouping excludes current actor and groups sessions by `userId`.

Browser/helper tests:

- `colorForUserId` is deterministic;
- `initialForNickname` handles empty/whitespace nicknames defensively;
- `collapsePathToTodoRow` returns the row for todo child paths and null for non-todo paths;
- status replacement uses id `presence:last-edit:${actor}`;
- status clear timer clears the actor status;
- title blame returns the actor from the title primitive timestamp.

Existing status-store tests do not need duplication.

## Verification

Static checks:

```sh
pnpm run build
cd examples/react-crdt
pnpm run build
cd ../react-crdt-server
bun run typecheck
```

Manual test matrix:

1. Start the Bun server and React example.
2. Log in as two different users in two tabs with different `session` params.
3. Confirm each tab's roster shows the other user and excludes itself.
4. Edit a todo title in tab A.
5. Confirm tab B shows a cursor badge on the containing todo row.
6. Wait about one minute and confirm the cursor badge disappears if no further edits occur.
7. Close tab A and confirm tab B removes A from roster and clears A's cursor.
8. Open two sessions for the same user and one session for another user.
9. Confirm roster groups same-user sessions as one person, while separate cursors can appear per session.
10. Hover over a todo title/row and confirm the native tooltip shows the most recent title editor.
11. Undo/redo a title edit and confirm blame follows the fresh undo/redo timestamp.

## Risks

- The generic todo app now consumes `useStatuses`, which requires a status store from the provider. The CRDT provider creates an internal one by default, so non-server modes should still work.
- Current todo reorder work changes row layout and path behavior. Presence badges should be added without disturbing drag/drop hit testing.
- Row-level cursor derivation for reorder operations may be ambiguous. The first pass can skip row cursors for array-level reorder updates.
- Presence is ephemeral and derived client-side. A client joining after a remote edit will know who is online, but it will not show historical last-edit cursors until future updates arrive.
- Actor ids include session ids. UI should avoid showing the full actor prominently except in debug/tooltips.
