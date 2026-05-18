# Server Users Implementation Plan

## Goal

Add lightweight user support to the server-backed React CRDT example.

The example should let a browser user log in by nickname, receive a server-assigned `userId`, persist that `userId` locally, and derive the CRDT/HLC actor from both the durable user and a unique session id. There is no password or real authentication; selecting an existing nickname is intentionally logging in as that existing user.

## Decisions

- Use protocol version `2`; no compatibility path for protocol version `1`.
- Known nicknames come from users previously created on the server.
- Nickname matching is case-insensitive.
- Selecting an existing nickname returns that same existing user.
- Logging out clears only the persisted local user id/nickname.
- Server-mode document replicas remain keyed by `docId`, not `userId + docId`.
- All users can access all documents.
- The HLC node/protocol actor must incorporate both `userId` and `sessionId`.
- The server should reject sync messages whose actor does not encode the supplied `userId`.
- The server does not need to store `userId` separately on each message; it can derive user data from the actor string.
- The session id should persist over page refresh by living in a query parameter written with `history.replaceState`.
- Use login/logout language in the UI.

## Identity Model

Add explicit user and session identity types to the browser server mode:

```ts
type ServerUser = {
    userId: string;
    nickname: string;
};

type ServerSessionIdentity = {
    user: ServerUser;
    sessionId: string;
    actor: string;
    createdAt: string;
};
```

Use a single helper to construct and parse the actor string:

```ts
actor = `${userId}:${sessionId}`;
```

The helper should live where both client server-mode code and server validation can use equivalent logic. Since protocol code is currently duplicated between `examples/react-crdt` and `examples/react-crdt-server`, duplicate a small `actorForSession` / `parseSessionActor` helper in each package for now.

Parsing should split on `:` and return `null` unless there are exactly two non-empty pieces. This is sufficient because `userId` and `sessionId` are generated as `user-${crypto.randomUUID()}` and `session-${crypto.randomUUID()}`, which do not contain `:`. Server-side validation should compare `parseSessionActor(actor)?.userId` to the message's `userId`.

## Server API

Keep document sync on WebSocket `/sync`, and add HTTP endpoints for user bootstrap.

### `GET /users`

Returns users created by prior logins:

```json
{
    "users": [{"userId": "user-...", "nickname": "Jared"}]
}
```

Sort by case-insensitive nickname for stable UI.

### `POST /users/login`

Accepts:

```json
{"nickname": "Jared"}
```

Behavior:

- trim whitespace;
- reject empty nicknames;
- match existing users case-insensitively;
- return the existing user for a match;
- otherwise create `user-${crypto.randomUUID()}`;
- store the display nickname as entered after trimming;
- update `lastSeenAt`.

Response:

```json
{"user": {"userId": "user-...", "nickname": "Jared"}}
```

Use CORS headers compatible with the Vite example for both endpoints.

## Server Storage

Update `examples/react-crdt-server/src/store.ts`.

Add a `users` table:

```sql
create table if not exists users (
    userId text primary key,
    nickname text not null,
    nicknameKey text not null unique,
    createdAt text not null,
    lastSeenAt text not null
);
```

Use `nicknameKey = nickname.trim().toLocaleLowerCase()` for case-insensitive lookup. Avoid relying only on SQLite collation because the code should make the example behavior obvious.

Add store methods:

- `listUsers(): ServerUser[]`
- `loginUser(nickname: string): ServerUser`
- optionally `getUserById(userId: string): ServerUser | null` if useful for validation/debug.

Do not alter the `messages` schema to add `userId`. Keep `origin` as the full actor string. Debug rendering can parse `origin` when it wants to show a user/session split.

## Protocol Changes

Bump `SERVER_PROTOCOL_VERSION` to `2` in both:

- `examples/react-crdt/src/lib/server/protocol.ts`
- `examples/react-crdt-server/src/protocol.ts`

Add `userId` to every client sync message:

```ts
type ClientServerMessage =
    | {
          kind: 'hello';
          version: 2;
          actor: string;
          userId: string;
          docId: string;
          schemaFingerprint: string;
          lastSeenMessageIndex: number;
      }
    | {
          kind: 'clientUpdate';
          version: 2;
          actor: string;
          userId: string;
          docId: string;
          schemaFingerprint: string;
          hlcTimestamp: HlcTimestamp;
          update: CrdtUpdate;
      }
    | {
          kind: 'syncRequest';
          version: 2;
          actor: string;
          userId: string;
          docId: string;
          schemaFingerprint: string;
          lastSeenMessageIndex: number;
      };
```

Server-to-client sync messages can remain structurally the same except for `version: 2`.

Server-side `parseClientMessage` should reject:

- any non-v2 message;
- any message with empty `userId`;
- any message whose `actor` does not parse;
- any message where parsed actor `userId !== message.userId`;
- any `clientUpdate` where `latestCrdtUpdateTimestamp(update) !== hlcTimestamp`;
- any `clientUpdate` where `hlc.unpack(hlcTimestamp).node !== actor`.

That final check ensures the submitted update was actually produced by the claimed actor, not just wrapped in a message with that actor.

The WebSocket handler should also reject duplicate live sessions. After parsing a client's first valid sync message and extracting `{userId, sessionId}` from `actor`, check currently connected clients. If another open WebSocket already has the same `sessionId`, send an `error` and close the new socket. This makes copied URLs deterministic: refreshes are fine because the old socket closes, but two simultaneously open pages cannot share one session id.

## Browser Persistence

Update `examples/react-crdt/src/lib/server/persistence.ts`.

Current DB:

- `DB_VERSION = 1`
- `identity` stores `ServerReplicaIdentity`
- `replicas` stores `PersistedServerReplica`

New DB:

- bump to `DB_VERSION = 2`;
- keep the `identity` object store name for minimal churn, but store `PersistedServerUser`;
- keep `replicas` keyed by `docId`;
- do not delete replicas on logout.

Types:

```ts
type PersistedServerUser = {
    storageVersion: 2;
    userId: string;
    nickname: string;
    createdAt: string;
    updatedAt: string;
};
```

Functions:

- `loadServerUser(): Promise<PersistedServerUser | null>`
- `saveServerUser(user: ServerUser): Promise<PersistedServerUser>`
- `clearServerUser(): Promise<void>`
- keep `loadServerReplica` / `saveServerReplica`.

On upgrade from DB v1 to v2, delete the old `identity` key. Do not try to migrate old `replicaId` into a user. This is a clean break and avoids inventing a fake server-assigned `userId`.

Update `PersistedServerReplica`:

- bump `storageVersion` to `2`;
- bump `protocolVersion` to `2`;
- remove `replicaId`;
- optionally add `lastUserId?: string` only if useful for debugging, but do not key or gate document loading by user.

Since old persisted replicas contain protocol version `1`, `loadInitialState` should ignore or replace incompatible persisted replicas rather than throwing a hard error that strands the demo. Recommended behavior:

- if no replica exists, create one;
- if schema fingerprint mismatches, throw as today;
- if storage/protocol version is old, create a fresh replica for that `docId`.

## Session Query Parameter

Add a client helper, likely in a new `examples/react-crdt/src/lib/server/session.ts`.

Responsibilities:

- read `session` from `window.location.search`;
- if present and non-empty, reuse it;
- otherwise create `session-${crypto.randomUUID()}`;
- write it into the current URL with `history.replaceState` while preserving existing query params such as `doc`;
- return the session id.

Use a query parameter name that is unlikely to collide, for example `session`.

Because this helper mutates the URL, call it during the browser-only load/bootstrap path, not during render or SSR-style module initialization.

## Browser Login Flow

Update `ServerApp.tsx`.

Current flow:

1. load/create local identity;
2. load/create replica;
3. mount `ServerReadyApp`.

New flow:

1. ensure a session id exists in the query string;
2. load persisted server user from IndexedDB;
3. if a user exists, build `ServerSessionIdentity` and load/create replica;
4. if no user exists, fetch `GET /users` and render login UI;
5. when the user submits a nickname or clicks a known user:
    - call `POST /users/login`;
    - persist returned user locally;
    - build `ServerSessionIdentity`;
    - load/create replica;
    - mount `ServerReadyApp`.

Suggested state:

```ts
type LoadState<TState> =
    | {kind: 'loading'}
    | {kind: 'needsUser'; sessionId: string; users: ServerUser[]; message?: string}
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'error'; message: string};
```

`Loaded<TState>` should contain:

```ts
{
    identity: ServerSessionIdentity;
    history: CrdtLocalHistory<TState>;
    lastSeenMessageIndex: number;
    changes: ServerChange[];
    source: 'created' | 'loaded';
}
```

Add a `ServerLogin` component in `ServerApp.tsx` or a new `ServerLogin.tsx`:

- render known nickname buttons from `GET /users`;
- render a text input for a new/existing nickname;
- submit on button click/form submit;
- show loading/error state;
- avoid implying password/security beyond the words login/logout.

## Sync Hook Changes

Update `useServerSync.ts`.

Replace `identity.replicaId` with:

- `identity.actor` for CRDT/HLC/protocol actor/origin comparisons;
- `identity.user.userId` for the new protocol `userId` field;
- `identity.user.nickname` for UI only.

Specific changes:

- `clockRef = useRef(initialClock(identity.actor, changesRef.current))`
- persisted replica no longer writes `replicaId`
- `flushPending` sends `actor: identity.actor` and `userId: identity.user.userId`
- `requestSync` sends `actor: identity.actor` and `userId: identity.user.userId`
- WebSocket `hello` sends `actor: identity.actor` and `userId: identity.user.userId`
- remote echo filtering remains `entry.origin === identity.actor`
- local change creation uses `origin: identity.actor`
- `transport.actor = identity.actor`

Do not filter out entries from the same `userId`; two tabs for the same user are still separate CRDT sessions and must receive each other's updates.

## Logout Flow

Add a logout callback from `ServerApp` into `ServerControls`.

Behavior:

1. stop/close the active WebSocket;
2. clear the persisted server user identity with `clearServerUser()`;
3. leave the `session` query param unchanged;
4. leave per-document replicas and pending changes intact;
5. reload known users from the server;
6. transition back to `needsUser`.

Implementation options:

- Add `logout(): void` to `ServerSync`, implemented by setting manual offline/closing the socket and calling a callback passed from `ServerApp`.
- Or keep logout outside `useServerSync`: `ServerControls` receives both `sync` and `onLogout`, and `ServerReadyApp` unmounting naturally runs the sync hook cleanup.

Prefer the second option. It keeps persistence/UI concerns out of the sync hook.

When logging back in as a different user, the preserved local replica may contain pending local changes from the previous actor. Per the decision, that is acceptable for this example. Do not rewrite old origins or timestamps.

## Controls And Debug UI

Update `ServerControls.tsx`:

- show nickname;
- show user id;
- show session id;
- show actor/HLC node, possibly shortened only if the full value remains accessible enough for debugging;
- add `Log out` button;
- keep existing online/offline and sync controls.

Update `examples/react-crdt-server/src/index.ts` debug page:

- show known users in a users section;
- show connected clients with actor, parsed user id, parsed session id, and doc id;
- recent messages can keep showing origin, with optional parsed user/session columns.

## File-Level Checklist

1. `examples/react-crdt-server/src/types.ts`
    - Add `ServerUser`.
    - Optionally add parsed actor/session debug types.

2. `examples/react-crdt-server/src/protocol.ts`
    - Bump protocol to `2`.
    - Add `userId` to client messages.
    - Add actor parsing/validation.
    - Validate client update timestamp actor matches message actor.

3. `examples/react-crdt-server/src/store.ts`
    - Add `users` table.
    - Add `listUsers`.
    - Add `loginUser`.
    - Keep messages schema unchanged.

4. `examples/react-crdt-server/src/index.ts`
    - Add `GET /users`.
    - Add `POST /users/login`.
    - Add JSON body parsing helper.
    - Set CORS headers.
    - Store `userId` in WebSocket client data.
    - Store parsed `sessionId` in WebSocket client data.
    - Reject and close duplicate live `sessionId` connections.
    - Reject invalid actor/user combinations through protocol parsing.
    - Update debug HTML.

5. `examples/react-crdt/src/lib/server/types.ts`
    - Replace `ServerReplicaIdentity` with user/session types.
    - Update `PersistedServerReplica` to v2 shape.
    - Update `ServerSync.identity` type.

6. `examples/react-crdt/src/lib/server/protocol.ts`
    - Bump protocol to `2`.
    - Add `SERVER_HTTP_URL` or helper URLs for `/users` and `/users/login`.
    - Add `ServerUser` response parsing helpers, or put them in a separate API file.
    - Add `userId` to client messages.

7. `examples/react-crdt/src/lib/server/session.ts`
    - Add session query param helper.
    - Add actor construction/parsing helper.

8. `examples/react-crdt/src/lib/server/persistence.ts`
    - Bump IndexedDB version to `2`.
    - Store `PersistedServerUser` in `identity`.
    - Add load/save/clear user helpers.
    - Keep replicas keyed by `docId`.
    - Clear old v1 identity during upgrade.

9. `examples/react-crdt/src/lib/server/ServerApp.tsx`
    - Add login/bootstrap load state.
    - Fetch known users when no persisted user exists.
    - Login by nickname and persist returned user.
    - Build session identity.
    - Load/create v2 replica.
    - Handle logout transition.

10. `examples/react-crdt/src/lib/server/useServerSync.ts`
    - Use `identity.actor` everywhere actor/replica id was used.
    - Send `userId` on all client messages.
    - Persist v2 replica shape.

11. `examples/react-crdt/src/lib/server/ServerControls.tsx`
    - Render user/session identity fields.
    - Add logout button.

12. `examples/react-crdt/src/style.css`
    - Add minimal styles for login form and known user list.
    - Keep the server mode layout consistent with existing panels.

13. `examples/react-crdt/README.md`
    - Update server-mode notes to mention nickname login and persisted user id.

## Verification

Run static checks:

```sh
pnpm run build
pnpm run typecheck:examples
cd examples/react-crdt-server
bun run typecheck
```

Manual test matrix:

1. Fresh browser storage:
    - open Server tab;
    - see login UI;
    - create nickname;
    - confirm server returns user and UI mounts document.

2. Refresh:
    - URL now contains `session=...`;
    - same `userId` is loaded from IndexedDB;
    - same `session` query param is reused;
    - HLC actor contains both values.

3. Logout:
    - click `Log out`;
    - login UI appears;
    - document replica data is not cleared;
    - known user list includes the previous nickname.

4. Case-insensitive login:
    - login as `Jared`;
    - logout;
    - login as `jared`;
    - confirm the same `userId` is returned.

5. Two sessions:
    - open two tabs with different `session` query params and the same user;
    - edits converge;
    - server does not filter same-user/different-session updates.

6. Duplicate session URL:
    - copy a Server tab URL including `session=...` into another tab while the first tab remains open;
    - confirm the second WebSocket is rejected and closed;
    - refresh the original tab and confirm it can reconnect with the same session id after the previous socket closes.

7. Server validation:
    - malformed actor/user combinations are rejected;
    - updates whose HLC timestamp node differs from `actor` are rejected.

8. Persistence:
    - restart the Bun server;
    - previously created users still appear in `GET /users`;
    - existing document messages still replay.

## Risks

- Keeping replicas keyed only by `docId` means a new login in the same browser can reuse local pending changes created under a previous actor. This is intentional per the task decision, but the behavior should be kept visible in debug/control UI.
- Query-param session persistence means copying a URL carries the session id. The server should reject simultaneous duplicate live sessions, but this is still only example-grade identity and not real authentication.
- Because protocol code is duplicated between client and server, the version, actor format, and message fields must be updated in both packages in the same change.
