# Server users research

This document maps the architecture relevant to adding user selection/login to the `examples/react-crdt/src/lib/server` example and records open questions before implementation.

The requested behavior:

- on first opening the page, the user sets a nickname or chooses from server-provided known nicknames;
- the server responds with a durable `userId`;
- the HLC `node` incorporates that `userId`;
- the HLC `node` also includes a unique session element;
- the `userId` is persisted locally;
- logging out clears the local `userId` so the user can log in again.

## Current architecture

### Browser server sync mode

The browser-side server mode lives under `examples/react-crdt/src/lib/server`.

Important files:

- `ServerApp.tsx` loads the local IndexedDB identity and persisted per-document replica, then mounts the CRDT provider.
- `useServerSync.ts` owns the WebSocket connection, reconnect loop, pending local uploads, server cursor, change log, and `SyncedTransport`.
- `persistence.ts` stores one durable `ServerReplicaIdentity` in IndexedDB plus per-document `PersistedServerReplica` records.
- `protocol.ts` defines the browser/server WebSocket message types and validates server messages.
- `ServerControls.tsx` renders connection state, actor identity, and sync stats.

Today there is no concept of a human user. The browser creates one local actor identity:

```ts
{
    replicaId: `client-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
}
```

That `replicaId` is used as:

- the `SyncedTransport.actor`;
- the HLC node passed to `hlc.init`;
- the `actor` field in `hello`, `clientUpdate`, and `syncRequest`;
- the `origin` recorded on local `ServerChange` rows;
- the `replicaId` saved inside `PersistedServerReplica`;
- the identity shown in `ServerControls`.

### HLC node behavior

`src/crdt/hlc.ts` treats `node` as an arbitrary string. Packed timestamps are:

```ts
<wall-clock-ms>:<counter-base36>:<node>
```

`unpack` joins all segments after the second colon back into `node`, so node strings may contain `:` without breaking parsing. Timestamp comparison uses `ts`, then `count`, then lexicographic `node`.

Implication: a composite node string such as `user:<userId>:session:<sessionId>` works mechanically. It should still be made by one helper so all protocol, UI, and debugging code can parse or display it consistently.

The unique session element is important. If two tabs or devices use only the same durable `userId` as the HLC node, concurrent local ticks at the same millisecond can produce identical timestamps. The current CRDT/server store assumes timestamps are unique per document; the Bun store has `unique (docId, hlcTimestamp)`.

### Bun server

The demo server lives under `examples/react-crdt-server`.

Important files:

- `src/index.ts` serves `/health`, `/debug`, and WebSocket `/sync`.
- `src/protocol.ts` validates client messages with `typia`.
- `src/store.ts` persists documents and messages in SQLite.
- `src/types.ts` defines `ServerLogEntry`, `DocumentSummary`, and connected client debug data.

The server currently accepts whatever `actor` string the client sends. It stores messages as:

```sql
messages (
    docId text,
    messageIndex integer,
    origin text,
    hlcTimestamp text,
    receivedAt text,
    updateJson text,
    primary key (docId, messageIndex),
    unique (docId, hlcTimestamp)
)
```

There is no user table, login endpoint, nickname list, or server-side validation tying a client `actor` to an assigned user.

### Protocol

Current client-to-server messages:

- `hello`: `{actor, docId, schemaFingerprint, lastSeenMessageIndex}`;
- `syncRequest`: `{actor, docId, schemaFingerprint, lastSeenMessageIndex}`;
- `clientUpdate`: `{actor, docId, schemaFingerprint, hlcTimestamp, update}`.

Current server-to-client messages:

- `hello`: `{docId, lastSeenMessageIndex}`;
- `serverUpdates`: `{docId, entries}`;
- `ack`: `{docId, hlcTimestamp}`;
- `error`: `{message}`.

The protocol is versioned as `SERVER_PROTOCOL_VERSION = 1` in both the client example and the Bun server. Adding users probably deserves version `2` because valid messages and persisted identity shape will change.

## Recommended architecture

### Split user identity from session/actor identity

Introduce separate concepts:

```ts
type ServerUser = {
    userId: string;
    nickname: string;
};

type ServerSessionIdentity = {
    user: ServerUser;
    sessionId: string;
    actor: string; // HLC node and protocol actor
    createdAt: string;
};
```

`actor` should be derived, not user-entered:

```ts
actor = `user:${userId}:session:${sessionId}`
```

The durable local identity should persist `userId` and `nickname`, but `sessionId` should be newly generated for each page load/session. This satisfies both requirements:

- HLC timestamps visibly incorporate the durable server-assigned user id.
- Concurrent sessions for the same user still get distinct HLC nodes.

If the example wants reconnects within the same tab to keep the same HLC node, keep `sessionId` in React state/ref after the initial load rather than regenerating on WebSocket reconnect.

### Add a login/bootstrap phase before mounting sync

`ServerApp.tsx` currently calls `loadInitialState(...)` and immediately renders `ServerReadyApp`.

Recommended load flow:

1. Load persisted local server user from IndexedDB.
2. If no user is present, fetch or request known nicknames from the server and render a lightweight login/nickname picker.
3. When the user picks or enters a nickname, call a server login/register message or endpoint.
4. Persist the returned `{userId, nickname}` locally.
5. Create a new `sessionId`, derive `actor`, then load/create the document replica and mount `useServerSync`.

This implies the load state likely becomes:

```ts
type LoadState<TState> =
    | {kind: 'loading'}
    | {kind: 'needsUser'; knownNicknames: string[]}
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'error'; message: string};
```

`Loaded<TState>` should carry the session identity instead of the current `ServerReplicaIdentity`.

### Persistence changes

Current IndexedDB:

- DB name: `umkehr-react-crdt-server-sync`
- version: `1`
- stores: `identity`, `replicas`
- identity key: `default`

Recommended browser persistence:

- bump DB version to `2`;
- replace or migrate the `identity` value from `{replicaId, createdAt}` to a user-centered shape;
- persist only durable user data, not the per-page `sessionId`;
- add `logoutServerUser()` that deletes the identity key.

Potential type:

```ts
type PersistedServerUser = {
    storageVersion: 2;
    userId: string;
    nickname: string;
    createdAt: string;
    updatedAt: string;
};
```

Open design point: what happens to existing per-document replicas on logout? See open questions below. The simplest user-visible behavior is clearing only the user id and leaving document replicas intact, but that means the next user in the same browser may reuse local history containing updates authored by the previous actor. For a clear example mental model, logout should probably clear server-mode replicas and pending changes too, or replicas should be keyed by `userId + docId`.

### Persisted replica changes

`PersistedServerReplica` currently stores `replicaId`. With user/session split:

- storing `actor` in the replica is misleading because actor is per session;
- persisted `changes` already include each change's `origin`, which remains the historical actor/HLC node;
- existing local unacknowledged changes may have an old actor and timestamp and should keep them when uploaded.

Recommended adjustment:

```ts
type PersistedServerReplica<TState> = {
    docId: string;
    storageVersion: 2;
    protocolVersion: 2;
    schemaFingerprint: string;
    userId: string;
    history: CrdtLocalHistory<TState>;
    lastSeenMessageIndex: number;
    changes: ServerChange[];
    updatedAt: string;
};
```

If keeping backward compatibility is desired, migration can treat old `replicaId` as a legacy anonymous user/actor, but this is an example app. It may be acceptable to drop old server-mode IndexedDB records on version bump.

### Protocol options

There are two viable shapes.

#### Option A: HTTP login plus WebSocket sync

Add server endpoints:

- `GET /users` returns known users/nicknames.
- `POST /users/login` accepts `{nickname}` and returns `{userId, nickname}`.

Keep `/sync` focused on document sync. The WebSocket messages then include both:

```ts
{
    actor: string;  // HLC node, user + session
    userId: string; // durable user identity assigned by server
}
```

This is simple in the browser and avoids WebSocket state before a user exists.

#### Option B: WebSocket login messages

Extend the WebSocket protocol with:

```ts
type ClientServerMessage =
    | {kind: 'listUsers'; version: 2}
    | {kind: 'login'; version: 2; nickname: string}
    | ExistingSyncMessagesWithUser;

type ServerClientMessage =
    | {kind: 'users'; version: 2; users: ServerUser[]}
    | {kind: 'loginAccepted'; version: 2; user: ServerUser}
    | ExistingSyncMessages;
```

This keeps all server interaction in one transport, but it complicates `useServerSync` because the hook currently assumes it already has identity and document metadata when connecting.

Recommendation: Option A. The example already has HTTP debug/health endpoints, and login is conceptually a bootstrap step before sync.

### Server store changes

Add server-side users to `examples/react-crdt-server/src/store.ts`.

Potential schema:

```sql
create table if not exists users (
    userId text primary key,
    nickname text not null unique,
    createdAt text not null,
    lastSeenAt text not null
);
```

Server behavior:

- normalize nicknames with trim and reject empty values;
- if nickname exists, return its existing `userId`;
- otherwise create a new `userId`, for example `user-${crypto.randomUUID()}`;
- update `lastSeenAt` on login.

Known nicknames can come from this table. If the task expects a fixed curated list "provided by the server", the server can seed the table on startup with names. If it expects users created by previous logins to appear, `GET /users` should list table contents.

For messages, either keep `origin` as the full actor/HLC node and add a separate `userId`, or derive `userId` by parsing `origin`. Keeping `userId` explicitly is better for debug UI, future presence, and avoiding parser coupling.

Potential message schema addition:

```sql
alter messages add column userId text;
```

Because this is an example and the DB is local SQLite, it may be simpler to create a fresh schema or tolerate nullable `userId` for old rows.

### Sync hook changes

`useServerSync` should take a session identity:

```ts
identity: ServerSessionIdentity;
```

Then update:

- `clockRef = useRef(initialClock(identity.actor, changesRef.current))`;
- `transport.actor = identity.actor`;
- local `ServerChange.origin = identity.actor`;
- client messages send `actor: identity.actor` and `userId: identity.user.userId`;
- filtering of own echoed messages should compare `entry.origin === identity.actor`, not only `userId`, so another tab for the same user still receives that tab's changes.

That last point matters. Two sessions for the same user must behave like different CRDT replicas even though they share a durable user.

### UI changes

Add a login screen before `ServerReadyApp`:

- show known nicknames from the server as buttons/options;
- include an input for a new nickname;
- on submit, request login and then continue into the document.

Update `ServerControls`:

- display nickname and user id separately from session/actor;
- add a `Log out` button;
- on logout, close WebSocket, clear persisted user id, and return to the login state.

The task does not ask for authentication, so labels should avoid security language like password/account protection. "Choose user" or "Set nickname" may be clearer than a full login framing, though the logout behavior is still useful.

## Compatibility and migration notes

- Existing protocol version `1` clients and servers will not understand user login fields. Bump both client and server protocol constants together.
- Existing IndexedDB identity records have `{replicaId, createdAt}`. Either migrate them to an anonymous generated user or clear them. Clearing is simpler but should be intentional.
- Existing SQLite `messages` rows only have `origin`. If adding `userId`, old rows can leave it null and debug UI can display a parsed/legacy value.
- Existing local pending changes may have old actor IDs. If preserving local replicas across migration, do not rewrite their timestamps or origins.
- Because HLC node strings can contain colons, use a deliberate prefix format and parser if the server/debug UI wants to extract `userId` and `sessionId`.

## Open questions

1. Should "known nicknames provided by the server" mean a fixed seeded list, the set of users previously created in SQLite, or both?
  - set of users previously created
2. On logout, should the app clear only the persisted `userId`, or also clear server-mode document replicas, pending local changes, and sync cursors?
  - only clear the userId
3. Should local replicas be keyed by `docId` as today, or by `userId + docId` so multiple users can safely share the same browser?
  - all users have access to all documents; no need to key by userId
4. Should the server reject `clientUpdate` messages whose HLC node does not incorporate the supplied `userId`?
  - sure
5. Should the server store `userId` separately on each message, or continue storing only `origin` and derive user data from the actor string?
  - we can derive from the actor string
6. Should nickname matching be case-sensitive? For example, are `Jared` and `jared` one user or two?
  - case-insensitive
7. Does a user selecting an existing nickname intentionally become that same user, or should the server distinguish same-nickname users with separate ids?
  - same-nickname is same user
8. Should `sessionId` survive page refreshes in `sessionStorage`, or should every page load create a new HLC node?
  - put it in a queryParam (history.replaceState) so it persists over refresh
9. Should the UI call this "login/logout" even though there is no password, or use "choose user/change user" language to avoid implying authentication?
  - login/logout is right
10. Should protocol version `2` be strictly required, or should the client/server keep a narrow compatibility path for existing version `1` messages during local development?
  - no need for compatibility
