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
