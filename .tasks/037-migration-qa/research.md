# Migration QA research

## Goal

Add Playwright coverage for the server schema migration story in `examples/react-crdt`, with special attention to mixed client versions, pending local edits, and reconnect behavior.

The task examples are:

- Server has a `todosV1` document. A `todosV2` client opens it, sees the migration-required UI, clicks the migration action, the server document migrates, and sync resumes.
- Server has a `todosV1` document. Client A is still `todosV1`; client B is `todosV2`. Client B migrates the document. Client A first sees migration-in-progress, then sees that it must upgrade before sync can resume.

## Existing coverage

Relevant files:

- `examples/react-crdt/playwright.config.ts`
- `examples/react-crdt/tests/server-migration.spec.ts`
- `examples/react-crdt/tests/helpers/app.ts`
- `examples/react-crdt/tests/helpers/server.ts`
- `examples/react-crdt/src/lib/server/useServerSync.ts`
- `examples/react-crdt/src/lib/server/ServerControls.tsx`
- `examples/react-crdt-server/src/index.ts`

`server-migration.spec.ts` already has useful server-backed E2E coverage:

- Baseline two-client sync against a seeded server DB.
- A browser/server migration test for `todos-migration-v1-main`.
- A pending-local-edit test while a migration lock is already present.
- A future-schema test where a v2 client opens `todos-migration-v3-ahead` and gets an upgrade-required notice.

However, the current browser migration test does not explicitly assert the migration-required notice or click the `Migrate document` button. It loads the v1 document, logs in, waits for the sync indicator, then inspects the DB. That leaves the most important user journey under-specified: the UI prompt and manual migration action.

## Current migration behavior

The server compares client and document schema metadata during `hello`:

- Same fingerprint: normal `hello` and branch sync.
- Client schema version is newer: `serverMigrationRequired`.
- Migration lock exists: `waitForMigration`.
- Client schema version is older: `clientMigrationRequired`.
- Same version but different fingerprint: `schemaMismatch`.

The browser maps those messages to toolbar notices in `serverMigrationStateForMessage(...)`. `ServerControls` renders a `Migrate document` button only when state is `migration-required`.

When a v2 client clicks the button:

1. Browser sends `serverMigrationRequest`.
2. Server stores a migration lock and returns `serverMigrationDump` to the owner.
3. Server broadcasts `waitForMigration` to other clients on the document.
4. Browser migrates the dump with `migrateServerDump(...)`.
5. Browser uploads `serverMigrationUpload`.
6. Server replaces the document, archives the old schema, clears the lock, sends `serverMigrationComplete` to the owner, and broadcasts `clientMigrationRequired` to other still-connected clients.
7. The owner reconnects and resumes normal sync.

Pending local writes are paused by state gating: `canFlushPendingServerWrites(...)` does not allow flushing while state is `migration-required`, `migration-running`, `client-migration-required`, `schema-mismatch`, or `error`. Local edits can still be made and remain pending.

## Versioned app selection

The mixed-client story can use the existing query-param app selection rather than a separate test harness. The Playwright helper `openServerDocument(...)` already accepts `appId`, so tests can open:

- current todos client: `?mode=server&doc=...` or `appId: 'todos'`
- old todos client: `?mode=server&app=todos@1&doc=...`
- future todos client: `?mode=server&app=todos@3&doc=...`

That means the literal "client A w/ todosV1 and client B w/ todosV2" browser test is expressible as two contexts/pages pointed at the same server document with different `app` query params. No second Vite server or protocol-only fake client should be needed for the core QA story.

## Recommended Playwright scenarios

### 1. V2 client manually migrates a seeded v1 server document

Purpose: cover the primary user journey.

Flow:

- Seed server DB.
- Open `?mode=server&doc=todos-migration-v1-main`.
- Log in.
- Assert `.serverToolbarNotice` contains the migration-required message.
- Assert `Migrate document` button is visible.
- Click `Migrate document`.
- Assert notice transitions away and sync resumes.
- Assert a known migrated todo is visible, for example `Try CRDT sync`.
- Inspect SQLite and assert:
  - document schema hash is v2,
  - archived schema hashes contain v1,
  - migration lock is null,
  - event count is nonzero.

This should replace or tighten the existing migration test.

### 2. Existing v2 clients see lock while another v2 client migrates

Purpose: cover the broadcast lock state between clients that are both capable of migrating.

Flow:

- Seed server DB.
- Open two browser contexts on `todos-migration-v1-main`.
- Both log in with different users.
- Both should initially see migration-required.
- Client B clicks `Migrate document`.
- Client A should see `Document migration is in progress`.
- After completion, client B reconnects and syncs.
- Client A, because it is also v2, should eventually reconnect/sync normally rather than getting upgrade-required.

This complements the v1/v2 test by confirming that a non-owner v2 client recovers to normal sync after completion rather than staying in upgrade-required.

### 3. Old v1 client sees lock, then upgrade-required after v2 migration

Purpose: cover the exact task story.

Flow:

- Seed server DB with `todos-migration-v1-main`.
- Open client A using `appId: 'todos@1'`.
- Client A logs in and syncs normally with the v1 server document.
- Open client B using `appId: 'todos'`.
- Client B logs in, sees migration-required, clicks `Migrate document`.
- Client A sees `Document migration is in progress`.
- After migration completes, client A sees the client-upgrade-required notice.
- Assert client A cannot flush writes while in this state.
- Inspect DB to confirm v2 schema and no active lock.

Expected nuance: a v1 client connected before migration will receive `clientMigrationRequired` via broadcast after completion. A v1 client connecting after migration should receive the same state during `hello`.

### 4. Pending local edit made before migration-required is preserved and uploads after migration

Purpose: cover a user editing while disconnected or before the schema mismatch is known.

Flow:

- Start with seeded v1 server document.
- Open v2 client with network disabled or server stopped, so it loads/creates local replica and permits edits.
- Make a local todo edit; assert one unsynced event.
- Restore connectivity.
- Client receives migration-required and pending event remains unsynced.
- Click `Migrate document`.
- After migration and reconnect, pending v2 event uploads.
- Assert server event count increased and a fresh v2 client sees the local edit.

Open concern: if the local replica was created as a blank v2 document while the server had a v1 document, the post-migration merge semantics need careful expected values. This may need a pre-seeded local v2 replica with pending uploads for the same docId.

### 5. Pending local edit during active migration lock remains pending

Purpose: keep and expand the existing test.

The current test creates a lock with `lockTest.ts`, opens a v2 client, edits a todo, asserts one unsynced event, and verifies the server event count did not change. Keep this, but add an unlock/expiry continuation:

- Use a short migration lock TTL.
- After lock expiry, assert migration-cancelled appears.
- Client reconnects and sees migration-required again.
- Click migrate.
- Assert the previously pending local edit eventually uploads.

This covers intermittent migration ownership and confirms lock expiry is recoverable.

### 6. Migration owner disconnects before upload

Purpose: cover interrupted migration.

Flow:

- Seed v1 DB.
- Open v2 client, click `Migrate document`.
- Before upload completes, close the page/context or block the WebSocket.
- Wait for migration lock TTL expiry.
- Open another v2 client.
- Assert it can acquire migration and complete.
- Assert no stale active lock remains.

This may require a deterministic test hook to pause between `serverMigrationDump` and `serverMigrationUpload`; otherwise the browser migration may complete too quickly to interrupt reliably.

### 7. Offline old client with pending v1 edits after server migrated to v2

Purpose: define behavior for a hard real-world case.

Flow:

- Client A v1 syncs v1 document.
- Client A goes offline and makes a local v1 edit.
- Client B v2 migrates server to v2.
- Client A reconnects.
- Assert client A receives upgrade-required and its v1 pending edit remains local, not uploaded.

Open product question: should those pending v1 edits be migratable after upgrade, or are they stranded in old local storage until the v2 app migrates the local server replica? The local load path can migrate persisted server replicas, but this needs an explicit QA expectation.

### 8. Future server schema remains blocked

Purpose: keep the v3-ahead regression coverage.

Existing test is good: v2 client opens `todos-migration-v3-ahead`, sees upgrade-required, and DB remains v3 with no lock. Add a local edit assertion if we want consistency with the notice text: edits stay pending and do not mutate the server.

## Test helper improvements

Recommended additions to `tests/helpers/app.ts`:

- `expectMigrationRequired(page)` that checks the migration-required notice and button.
- `clickMigrateDocument(page)` that clicks `Migrate document`.
- `expectMigrationRunning(page)`.
- `expectClientUpgradeRequired(page)`.
- `disconnectFromServer(page)` / `reconnectToServer(page)` using the toolbar buttons.
- `expectUnsyncedEvents(page, count)`.
- Keep `openServerDocument(page, {appId, docId})` as the entry point for mixed-version tests; use `todos@1`, `todos`, and `todos@3` explicitly in the scenarios that care about client version.

Recommended additions to `tests/helpers/server.ts`:

- A helper to wait for inspected document state, polling `inspectServerDocument(...)`.
- A helper to seed or write a local IndexedDB server replica if pending-local scenarios need deterministic local state.
- Possibly a test-only server hook to delay migration upload or dump handling. Without this, owner-disconnect and "see lock while migration is happening" tests may be flaky because migration can complete in one event loop turn.

## Risks and likely flake points

- Migration completion is fast. Tests asserting an intermediate `waitForMigration` state need either a pre-created lock, a delay hook, or very careful sequencing.
- Current user identity is persisted in IndexedDB per browser context. Use separate contexts for separate clients and avoid reusing pages when testing old/new bundles.
- `waitForSynced(...)` only checks the unsynced local event icon. It does not prove the WebSocket is in `connected` state or that schema migration completed. Migration tests should assert toolbar notices and inspect the server DB.
- Existing app code auto-migrates local persisted server replicas during load if their schema differs from the current app. That is useful for upgraded clients, but tests should still use separate browser contexts and explicit `app` query params so a v2 load does not mask v1-client behavior.

## Open questions

- What exact old-client UI copy should the tests assert: full notice text, key phrase, or state-specific test id?
- Should the migration-required state require an explicit user click forever, or should some documents auto-migrate? The current UI implies manual.
- What should happen to pending v1 local edits after the server has migrated to v2 and the user upgrades the client?
- Do we want deterministic server test hooks for delaying migration, or should tests rely on pre-created locks only?
- Should server migration archive assertions include event replay/materialized state checks, or is schema hash plus visible todo enough at the Playwright layer?
