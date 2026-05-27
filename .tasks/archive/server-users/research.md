# Server users research

This document records the current user/session architecture in the `examples/react-crdt` server-backed mode after the server users implementation. The original design questions in `plan.md` have mostly been resolved; this file is now a reference for follow-on work such as presence, attribution, and debugging.

## Implemented behavior

The server-backed React CRDT example now has lightweight user support:

- A browser user logs in by nickname.
- The server creates or returns a durable `userId`.
- Nickname lookup is case-insensitive through a stored `nicknameKey`.
- The browser persists only the returned user id and nickname in IndexedDB.
- A per-session id is stored in the URL query string as `session=...`.
- The CRDT/HLC actor is derived as `${userId}:${sessionId}`.
- Logging out clears only the persisted local user, not the document replica or pending changes.
- The protocol is version `2`; version `1` is not supported by this implementation.

This is still example-grade identity. There are no passwords or access controls, and all users can access all documents.

## Browser architecture

The browser server mode lives under `examples/react-crdt/src/lib/server`.

Current files and responsibilities:

- `types.ts`
  - Defines `ServerUser`, `PersistedServerUser`, `ServerSessionIdentity`, `ServerChange`, `PersistedServerReplica`, and `ServerSync`.
- `session.ts`
  - Defines `actorForSession(userId, sessionId)`.
  - Defines `parseSessionActor(actor)`.
  - Ensures the `session` query parameter exists with `history.replaceState`.
- `persistence.ts`
  - Uses IndexedDB database `umkehr-react-crdt-server-sync`, version `2`.
  - Stores `PersistedServerUser` in the existing `identity` object store.
  - Stores document replicas keyed only by `docId`.
  - Deletes the old v1 `identity` record during DB upgrade.
- `protocol.ts`
  - Defines v2 client/server sync messages.
  - Adds `SERVER_HTTP_URL` for `/users` and `/users/login`.
  - Parses server messages but does not currently parse or expose server users.
- `ServerApp.tsx`
  - Bootstraps the session query parameter.
  - Loads persisted user identity.
  - Fetches known users when no local user exists.
  - Logs in through `POST /users/login`.
  - Builds `ServerSessionIdentity`.
  - Loads or creates a v2 document replica.
  - Mounts the CRDT provider and server controls.
- `useServerSync.ts`
  - Uses `identity.actor` for HLC clock node, transport actor, local change origin, and echo filtering.
  - Sends `identity.user.userId` on `hello`, `syncRequest`, and local update upload.
  - Uploads pending changes using the historical `change.origin` and parses the user id from that origin.
- `ServerControls.tsx`
  - Shows nickname, user id, session id, actor, sync stats, online/offline controls, and logout.

Important persistence decision:

`PersistedServerReplica` is keyed by `docId`, not `userId + docId`, and no longer stores `replicaId`. This means a different user logging in on the same browser can reuse the same local document replica and may upload pending changes created by a previous actor. That is intentional for this example and should remain visible in debug/control UI.

## Server architecture

The Bun server lives under `examples/react-crdt-server`.

Current files and responsibilities:

- `src/types.ts`
  - Defines `ServerUser`, `ServerLogEntry`, `DocumentSummary`, and connected-client debug data.
- `src/protocol.ts`
  - Uses `SERVER_PROTOCOL_VERSION = 2`.
  - Validates client messages with typia.
  - Requires `userId`.
  - Parses actor strings as exactly `{userId}:{sessionId}`.
  - Rejects actor/user mismatches.
  - Rejects `clientUpdate` messages whose `hlcTimestamp` does not match the latest update timestamp.
  - Rejects `clientUpdate` messages whose HLC node does not equal the message actor.
- `src/store.ts`
  - Persists users in SQLite:

```sql
create table if not exists users (
    userId text primary key,
    nickname text not null,
    nicknameKey text not null unique,
    createdAt text not null,
    lastSeenAt text not null
);
```

  - Keeps the existing `documents` and `messages` schemas.
  - Does not store `userId` separately on messages; message `origin` remains the full actor string.
  - Provides `listUsers()` and `loginUser(nickname)`.
- `src/index.ts`
  - Serves `GET /users`.
  - Serves `POST /users/login`.
  - Serves `/health`, `/debug`, and WebSocket `/sync`.
  - Adds permissive CORS for the example.
  - Tracks connected client actor, user id, session id, doc id, and schema fingerprint on WebSocket data.
  - Rejects duplicate live `sessionId` connections.
  - Shows users, connected clients, and parsed recent-message actor info in `/debug`.

## Protocol

Client sync messages now include both actor and user id:

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

Server-to-client messages are structurally the same as v1 except for `version: 2`.

The actor string is the HLC node. It must be treated as a session identity, not a human user identity. Two tabs logged in as the same nickname/user are distinct actors if they have different `sessionId` values.

## Current constraints for future work

- Presence should display users by nickname/user id, but status and CRDT authorship should still use full actor ids so simultaneous sessions remain distinct.
- Inline blame can parse a metadata timestamp's HLC node into `{userId, sessionId}`, then map `userId` to nickname when known.
- Server history/debug UI can derive user/session from `origin`; there is no `userId` column on messages.
- Pending local changes may have origins from a previous login. Upload code already sends the user id parsed from each change origin, not always the currently logged-in user.
- A copied URL carries the session id. The server rejects simultaneous duplicate live sessions, but a later refresh can reuse the session after the old socket closes.

## Verification status

The implementation includes the expected files and behavior from the plan:

- Browser protocol/user/session/persistence changes are present.
- Server protocol/user table/login endpoints/debug UI are present.
- README and server-mode tab integration mention nickname login.

I did not run the verification commands while updating this research note. Recommended checks remain:

```sh
pnpm run build
cd examples/react-crdt-server
bun run typecheck
```

Manual checks should cover fresh login, refresh, logout, case-insensitive login, same user in two sessions, duplicate session URL rejection, and server restart persistence.
