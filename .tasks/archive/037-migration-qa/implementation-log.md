# Implementation log

## 2026-05-28

- Started Phase 1 by reading the existing Playwright migration spec and helper modules.
- Added focused server migration UI helpers in `examples/react-crdt/tests/helpers/app.ts`.
- Added `waitForServerDocument(...)` polling wrapper around `inspectServerDocument(...)` in `examples/react-crdt/tests/helpers/server.ts`.
- Updated the existing migration tests to use explicit `appId: 'todos'` selection and the new helper assertions.
- Started Phase 2 by making the seeded v1 migration test assert the migration-required state, click `Migrate document`, wait for sync, and verify the migrated server state through `waitForServerDocument(...)`.
- Verified Phase 1/2 changes with `pnpm test:e2e -- server-migration.spec.ts` from `examples/react-crdt`; all 4 tests passed.
- Started Phase 3 by adding a mixed-version v1/v2 browser test: v1 syncs normally, v2 performs migration, v1 sees upgrade-required, and v1 local edits remain unsynced/server-neutral after migration.
- Ran the 5-test migration spec; the mixed-version test failed because the v1 client reached upgrade-required before Playwright observed migration-running.
- Adjusted the mixed-version test to keep durable coverage for v1 normal sync, v2 migration, v1 upgrade-required, and v1 pending local edits staying off the server. Deferred the transient migration-running assertion to Phase 6 unless a deterministic delay hook is added.
- Fixed the mixed-version local edit target to use `Try CRDT sync`; the v1 migration fixture does not contain `Write README`.
- Verified the current Phase 1-3 implementation with `pnpm test:e2e -- server-migration.spec.ts` from `examples/react-crdt`; all 5 tests passed.
- Investigated Phase 4 lock expiry. The server expires locks opportunistically when it receives a message for that document, so waiting for migration-cancelled may need either a deterministic server tick/hook or a client action that causes a message while sync is paused.
- Ran `pnpm exec tsc -p tsconfig.json --noEmit`; it failed on existing `src/lib/server/materialize.ts(419,65)` typing (`path` is not present on all CRDT update union members), unrelated to the Playwright helper/spec changes.
- Added a `serverMigrationDelayMs` URL query parameter that delays the browser migration owner between receiving `serverMigrationDump` and uploading the migrated document.
- Updated the mixed v1/v2 test to open the v2 migration owner with `serverMigrationDelayMs=1000` and assert the v1 client sees `migration-running` before upgrade-required.
- First delayed test run observed `migration-running`, but the default 1s migration lock TTL expired before upload completed. Increased the mixed-version test server lock TTL to 5s.
- Verified the delayed migration flow with `pnpm test:e2e -- server-migration.spec.ts` from `examples/react-crdt`; all 5 tests passed.
- Removed an accidental lock TTL change from the unrelated seeded sync test and reran `pnpm test:e2e -- server-migration.spec.ts`; all 5 tests passed.
- Continued Phase 4 by adding an expired-lock pending edit test: v2 opens behind an active lock, makes a local edit that stays unsynced, reconnects after lock expiry, migrates, and verifies the pending edit from a fresh v2 client.
- First expired-lock run failed because `inspectTest.ts` uses the store default 60s lock TTL, so polling `inspectServerDocument(...)` cannot observe the shorter TTL configured on the running test server. Changed the test to wait just past the 2s server TTL and reconnect, letting the server process expire the lock.
- The 2s TTL proved too short for browser open/login on the full file run, so the expiry test now uses a 5s TTL and waits just past that after creating the pending local edit.
- The expiry test then exposed a product bug: `migration-cancelled` allowed pending writes to flush before the server document was migrated, causing a schema fingerprint mismatch. Updated `canFlushPendingServerWrites(...)` so `migration-cancelled` keeps writes paused, with unit coverage.
- The expiry test still found a reconnect-time bug: `useServerSync` flushed pending writes immediately on WebSocket open before the server had accepted `hello` and schema state. Removed that eager flush so pending writes flush only after server hello/branch data confirms sync can continue.
- Adjusted the expired-lock DB completion wait to assert migrated schema and no active lock; the fresh-client check remains the server-backed proof of the pending edit because migration upload does not necessarily increase total event count relative to the migrated fixture.
- Verified Phase 4 expiry coverage with `pnpm test:e2e -- server-migration.spec.ts` from `examples/react-crdt`; all 6 tests passed.
- Started Phase 5 by extending the future-schema v3-ahead test: while the v2 client is upgrade-required, it makes a local edit, keeps one unsynced event, and the server v3 document event count/schema remain unchanged.
- Verified the future-schema pending-edit extension with `pnpm test:e2e -- server-migration.spec.ts`; all 6 tests passed.
- Added a Phase 5 smoke test for `appId: 'todos@3'` migrating the seeded v1 fixture to schema v3.
- Verified Phase 5 with `pnpm test:e2e -- server-migration.spec.ts`; all 7 tests passed.
- Continued Phase 6 by adding interrupted-owner coverage using `serverMigrationDelayMs`: one client acquires the migration lock and closes before upload, then a second client reconnects after lock expiry and migrates successfully.
- Verified Phase 6 interrupted-owner coverage with `pnpm test:e2e -- server-migration.spec.ts`; all 8 tests passed.
- Re-ran `pnpm exec vitest run examples/react-crdt/src/lib/server/states.test.ts`; all 6 tests passed.
- Ran final related unit validation with `pnpm exec vitest run examples/react-crdt/src/lib/server/states.test.ts examples/react-crdt/src/lib/server/migration.test.ts`; both files passed, 10 tests total.
