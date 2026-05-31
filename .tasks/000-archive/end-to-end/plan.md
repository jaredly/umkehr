# End-to-End Automation Plan

## Goal

Build a repeatable Playwright E2E suite for the React CRDT example that verifies migration behavior through the actual browser, Vite app, Bun sync server, SQLite store, and seeded data pipeline.

The first useful milestone is not exhaustive coverage. It is a reliable fast tier that can prove:

- the app can sync against a temp seeded server database;
- a current client can migrate `todos-migration-v1-main`;
- server state after migration is correct;
- local pending edits are preserved when migration blocks server writes.

## Phase 1: Test Runtime Configuration

Purpose: make server-backed Playwright tests deterministic and isolated.

Tasks:

- Update `examples/react-crdt/playwright.config.ts` for this repo instead of the default scaffold:
  - set `testDir` to the chosen E2E location;
  - start the Vite app with `webServer`;
  - use Chromium only for the fast tier;
  - keep traces/screenshots on failure.
- Decide whether migration specs stay under `examples/react-crdt/tests` or move to `examples/react-crdt/e2e`.
  - Current recommendation: keep the existing `tests` directory until the suite is large enough to justify a move.
- Add a package script for the fast E2E tier:
  - root: `test:e2e:migration`;
  - or example-local: `test:e2e`.
- Add server runtime configurability:
  - `--port <port>` or `UMKEHR_SERVER_PORT`;
  - `--migration-lock-ms <ms>` or `UMKEHR_MIGRATION_LOCK_MS`.
- Keep `--db <path>` as the database isolation mechanism.
- Make sure the React app can target a non-default server URL if server tests need dynamic ports.

Acceptance checks:

- A Playwright smoke test can open the app through the configured dev server.
- A Bun server can run against a temp SQLite path and a non-default port.
- E2E tests can run with one worker on the default port and are ready for parallelization once dynamic ports are wired through the app.

## Phase 2: Playwright Server Fixtures

Purpose: give tests a clean, reusable way to seed and inspect server state.

Tasks:

- Add `examples/react-crdt/tests/helpers/server.ts`.
- Implement `createTempServerDbPath(testInfo)` using `/tmp` or the test output directory.
- Implement `seedServerDatabase({dbPath, date, size})` by running:

```sh
cd examples/react-crdt-server
bun run seed:test -- --db <dbPath> --date 2026-01-02 --size small
```

- Implement `startServer({dbPath, port, migrationLockMs})` using the Bun server process.
- Ensure process cleanup happens in fixture teardown even after test failure.
- Implement a polling helper for `/health`.
- Add server DB inspection helpers, either via direct SQLite or a small test-only module:
  - active document schema version/hash;
  - archived schema hashes;
  - branch list and event counts;
  - active migration lock.
- Avoid adding test-only HTTP seed endpoints unless direct fixture/module access proves too awkward.

Acceptance checks:

- A test can seed a DB, start the server, hit `/health`, query `/documents`, and shut the process down cleanly.
- A helper can assert that `todos-migration-v1-main` exists with schema version 1 and the v1 fingerprint hash.

## Phase 3: App Interaction Helpers

Purpose: make browser tests readable and less coupled to incidental DOM structure.

Tasks:

- Add `examples/react-crdt/tests/helpers/app.ts`.
- Add navigation helpers:
  - open app in server mode;
  - select app id;
  - select architecture/mode;
  - select document id, especially `todos-migration-v1-main`;
  - login as seeded users or unique test users.
- Add UI assertion helpers:
  - wait for connected/synced state;
  - read pending upload count;
  - wait for migration-required, migration-running, client-migration-required, and migration-cancelled notices;
  - read visible todo rows and fields.
- Prefer accessible names and stable selectors.
- Add stable `data-testid` attributes only where accessible selectors are insufficient or too brittle.

Acceptance checks:

- A smoke test can open server mode, select `todos-small`, log in, and observe synced data.
- Helpers do not require arbitrary sleeps; all waits are state-based.

## Phase 4: First Server E2E Tests

Purpose: cover the highest-risk browser/server migration behavior first.

Create `examples/react-crdt/tests/server-migration.spec.ts`.

Test 1: seeded server sync smoke.

Steps:

1. Seed temp DB with `bun run seed:test`.
2. Start server.
3. Open two isolated browser contexts in server mode.
4. Select a current-schema todos document such as `todos-small`.
5. Log in as two users.
6. Edit a todo in client A.
7. Verify client B receives it.
8. Assert pending upload count returns to zero.
9. Inspect SQLite event count increased.

Test 2: current client migrates old server document.

Steps:

1. Seed temp DB.
2. Open current client in server mode against `todos-migration-v1-main`.
3. Verify migration-required UI.
4. Trigger migration.
5. Wait for reconnect/synced state.
6. Verify migrated visible todo fields use the current schema.
7. Inspect SQLite:
   - active schema hash is current;
   - old v1 hash appears in `archived_documents`;
   - active branch events are current-schema events.

Test 3: waiting client preserves local pending edits during migration.

Steps:

1. Seed temp DB with `todos-migration-v1-main`.
2. Open client A and begin migration.
3. Hold or delay A before upload.
4. Open client B.
5. Verify migration-running UI.
6. Edit locally in B.
7. Verify pending upload count increases.
8. Verify server branch event count does not increase while locked.
9. Complete or cancel migration and verify B still has local pending state.

Implementation note:

- This test needs a deterministic way to pause migration between request and upload. Prefer a test-only app hook or network interception in Playwright before changing production migration flow.

Acceptance checks:

- These tests pass repeatedly locally.
- Failure output includes trace and enough DB/UI state to diagnose the problem.

## Phase 5: Browser Storage Seeding

Purpose: reuse the seed fixture catalog for local-first and cached server-client browser states.

Tasks:

- Add `examples/react-crdt/tests/seed/browserStorage.ts`.
- Add storage helpers in `examples/react-crdt/tests/helpers/storage.ts`:
  - clear localStorage and IndexedDB;
  - write local-first replicas and retained batches;
  - write server-client cached/pending state.
- Reuse existing projections:
  - `createLocalFirstSeedReplica({fixture})`;
  - `createServerClientSeedReplica({fixture, scenario})`.
- Add a browser-storage projection for the old-schema todos migration fixture if local-first migration must start from v1 data.
- Add focused unit tests for the seeding helpers where practical, because broken IndexedDB setup can make Playwright failures hard to read.

Acceptance checks:

- A Playwright test can seed local-first storage before loading the app and observe the expected document.
- A Playwright test can seed server-client pending state and observe pending uploads without relying on server writes.

## Phase 6: Local-First And Schema-Mismatch E2E Tests

Purpose: cover local migration UX and incompatible-peer behavior after the server path is stable.

Create `examples/react-crdt/tests/local-first-migration.spec.ts`.

Test 1: local-first retained batch migration.

Steps:

1. Seed browser IndexedDB with an old-schema local-first replica and retained batches.
2. Open current app in local-first mode.
3. Verify migration-required panel.
4. Create migrated document.
5. Open migrated document.
6. Verify visible state, lineage, schema version/hash, retained batch reconstruction, and recomputed vector.

Test 2: local-first schema mismatch.

Steps:

1. Open two isolated contexts with incompatible schema metadata.
2. Connect via invite.
3. Make local edits on both sides.
4. Verify mismatch UI and no incompatible batch acceptance.

Acceptance checks:

- The source document remains intact after migration.
- The target document has current schema metadata and valid reconstructed history.
- Incompatible peers do not exchange data, while local editing remains available.

## Phase 7: Old-Client And Negative Paths

Purpose: automate protocol and UX cases that are hard to catch with unit tests.

Tasks:

- Add a schema metadata override strategy for browser tests, or build a direct protocol test client.
- Prefer direct protocol tests for server-only old-client states:
  - old-schema hello after server migration;
  - old-schema attempted writes after migration;
  - malformed migration upload rejection.
- Use browser-level simulation where UX matters:
  - update-your-app notice;
  - local edits remain pending;
  - no server flush occurs.
- Add tests using `generateMalformedSeedPayloads(...)` for importer/validation paths if coverage is not already sufficient at the Bun store level.
- Add a migration failure test:
  - missing migration path or bad migration output;
  - concise UI error;
  - detailed console error;
  - no partial active data committed;
  - old data still archived or still active, depending on failure point.

Acceptance checks:

- Old-client behavior is covered without requiring a second checkout for the fast tier.
- Real old-build testing remains a manual or slow-tier release check.

## Phase 8: CI And Maintenance

Purpose: make the suite useful without making normal development slow.

Tasks:

- Split Playwright projects:
  - fast Chromium migration tier;
  - optional slow multi-browser tier.
- Keep normal tests under roughly 30 seconds each.
- Configure retries only in CI.
- Store traces/screenshots/videos on failure.
- Add docs to `examples/react-crdt/README.md` or a test README:
  - how to run fast E2E tests;
  - how to seed a server DB manually;
  - how to inspect `/debug` and SQLite state.
- Add CI job triggers for PRs touching:
  - `examples/react-crdt`;
  - `examples/react-crdt-server`;
  - `src/crdt`;
  - `src/migration`;
  - `examples/migration-fixtures`.

Acceptance checks:

- The fast tier runs locally with one command.
- CI artifacts are enough to debug a failed migration run.
- Slow-tier tests can be run manually before migration-heavy releases.

## Open Decisions

- Keep tests in `examples/react-crdt/tests`, or move to `examples/react-crdt/e2e` once helpers and specs grow?
- Import the full 18-document seed DB for E2E setup, or add a focused one-document import helper?
- Should test runtime overrides be CLI flags, environment variables, or both?
- Should app server URL selection be URL-param based, environment based, or inferred from the dev server config?
- What is the cleanest way to pause a server migration between dump and upload for competing-client tests?
- How much real old-build testing should be automated versus kept as release checklist work?

## Suggested Implementation Order

1. Server `--port` and migration lock TTL override.
2. Playwright config and server fixture helpers.
3. Seeded server sync smoke test.
4. Server migration required test for `todos-migration-v1-main`.
5. SQLite inspection helpers for active/archive assertions.
6. Migration-running competing-client test.
7. Browser storage seed helpers.
8. Local-first migration test.
9. Old-client/protocol negative tests.
10. CI wiring and docs.
