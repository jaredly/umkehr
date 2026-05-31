# Migration QA plan

## Phase 1: Tighten the test helpers

Goal: make migration-state assertions readable and less brittle before adding more scenarios.

Tasks:

- Add focused helpers in `examples/react-crdt/tests/helpers/app.ts`:
  - `expectMigrationRequired(page)` checks the server toolbar notice and verifies `Migrate document` is visible.
  - `clickMigrateDocument(page)` clicks the migration button.
  - `expectMigrationRunning(page)` checks for `Document migration is in progress`.
  - `expectClientUpgradeRequired(page)` checks for the upgrade-required notice.
  - `expectUnsyncedEvents(page, count)` checks the sync indicator aria label.
  - `disconnectFromServer(page)` and `reconnectToServer(page)` use the existing toolbar buttons.
- Keep `openServerDocument(page, {appId, docId})` as the version selector. Use `appId: 'todos@1'`, `appId: 'todos'`, and `appId: 'todos@3'` explicitly in version-sensitive tests.
- Add a polling helper in `examples/react-crdt/tests/helpers/server.ts`, for example `waitForServerDocument(dbPath, docId, predicate)`, wrapping `inspectServerDocument(...)`.

Verification:

- Run the existing `server-migration.spec.ts` after helper extraction to ensure no behavior changed.

## Phase 2: Cover the core migration journey

Goal: make the existing browser migration test exercise the actual user flow.

Tasks:

- Update `migrates the seeded v1 todos document through the browser and server`:
  - Seed the server DB.
  - Open `todos-migration-v1-main` with the current v2 todos client.
  - Log in.
  - Assert migration-required notice and button.
  - Click `Migrate document`.
  - Wait for sync to resume.
  - Assert migrated todo content is visible.
  - Inspect the DB and assert:
    - schema hash is v2,
    - archived schema hashes include v1,
    - no active migration lock remains,
    - events remain present.
- Avoid relying on `waitForSynced(...)` as the only proof of migration completion; pair it with notice/DB assertions.

Verification:

- Run `pnpm test:e2e -- server-migration.spec.ts` from `examples/react-crdt`.

## Phase 3: Add mixed-version browser coverage

Goal: cover the exact task story with real browser clients.

Tasks:

- Add a test for v1 client plus v2 client:
  - Seed `todos-migration-v1-main`.
  - Open client A in a separate browser context with `appId: 'todos@1'`.
  - Log in as one user and wait for normal sync.
  - Open client B in another context with `appId: 'todos'`.
  - Log in as another user.
  - Assert client B sees migration-required.
  - Click migration from client B.
  - Assert client A sees migration-running.
  - Assert client A then sees upgrade-required after migration completes.
  - Assert client A cannot flush a local edit while upgrade-required.
  - Inspect the DB for v2 schema and no active lock.
- Add a companion v2/v2 test if the migration-running transition is reliable:
  - Two current clients open the v1 server document.
  - One migrates.
  - The non-owner sees migration-running and then resumes normal sync, not upgrade-required.

Verification:

- Run the migration spec multiple times locally if the migration-running transition is timing-sensitive.
- If the non-owner transition is too fast to observe reliably, defer the v2/v2 version or use a pre-created migration lock in Phase 4.

## Phase 4: Cover pending writes around migration locks

Goal: prove local edits remain local while server writes are paused, then flush when migration is resolved.

Tasks:

- Keep the existing active-lock pending-edit test, but refactor it onto the helper assertions.
- Extend it with lock expiry:
  - Start the server with a short migration lock TTL.
  - Create a migration lock before opening the client.
  - Open a v2 client and assert migration-running.
  - Make a local todo edit.
  - Assert one unsynced event and no server event-count increase.
  - Wait for migration-cancelled / reconnect.
  - Assert migration-required returns.
  - Click migration.
  - Assert the pending edit eventually uploads and is visible from a fresh v2 client.
- Add a v1-old-client pending edit test if the expected product behavior is confirmed:
  - v1 client syncs, goes offline, edits locally.
  - v2 client migrates server.
  - v1 reconnects and sees upgrade-required.
  - Assert the v1 pending edit remains local and does not change the server.

Verification:

- Inspect server event counts before and after local edits.
- Use a fresh browser context after migration to confirm uploaded edits are actually server-backed.

## Phase 5: Future-schema and regression coverage

Goal: keep ahead-of-client behavior covered and make it consistent with migration pause behavior.

Tasks:

- Keep the existing `todos-migration-v3-ahead` test.
- Route it through `appId: 'todos'` explicitly for clarity.
- Optionally add:
  - Make a local v2 edit while upgrade-required.
  - Assert it stays unsynced.
  - Inspect DB and confirm the v3 document is unchanged and has no active lock.
- Add a small smoke case for `appId: 'todos@3'` opening the v2/v1 migration fixtures only if `todos@3` is intended to be able to migrate older todos documents in this demo.

Verification:

- Run the full Playwright migration file.
- Run related unit tests for server migration/state helpers if touched.

## Phase 6: Deterministic interruption support, only if needed

Goal: avoid flaky timing tests for owner disconnects and migration-running broadcasts.

Tasks:

- First attempt the core tests without new server hooks.
- If migration completion is too fast to observe reliably, add a test-only delay mechanism:
  - Prefer a server CLI/env option that delays the migration dump response or pauses completion after lock acquisition.
  - Keep it disabled by default.
  - Wire `startServer(...)` to pass the option only in tests that need it.
- Add interrupted-owner coverage:
  - Client B acquires the migration lock.
  - Pause before upload or completion.
  - Close client B.
  - Wait for lock expiry.
  - Client C migrates successfully.
  - Assert no stale lock remains.

Verification:

- Run the affected test repeatedly to confirm the hook removes timing dependence.
- Ensure normal E2E tests do not run with the delay enabled.

## Final validation

- Run `pnpm test:e2e -- server-migration.spec.ts` in `examples/react-crdt`.
- If helper or migration code outside Playwright changed, run the relevant unit tests:
  - `pnpm test -- src/lib/server/migration.test.ts`
  - `pnpm test -- src/lib/server/states.test.ts`
  - any todos fixture tests touched by versioned app selection.
- Review the Playwright trace/screenshots on any failure and tighten selectors or waits rather than adding broad sleeps.

## Open decisions

- Should tests assert exact migration notice copy or only key phrases/state-specific UI?
- What is the intended recovery path for pending v1 local edits after the user upgrades to v2?
- Should interrupted migration be part of the first implementation, or deferred until a deterministic server delay hook exists?
