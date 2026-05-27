# End-to-End Automation Research

## Goal

Automate the migration manual testing plan well enough that Codex or a developer can repeatedly verify the full browser/server experience, not just the pure migration functions.

The main target is schema migration behavior across:

- local non-CRDT history
- CRDT-backed local state
- local-first/PeerJS flows
- server-backed sync
- server migration locks, dumps, uploads, and old-client behavior

## Recommendation

Use **Playwright** as the primary end-to-end test runner, backed by the checked-in seed database generator/importer that now exists for the React CRDT example and Bun sync server.

Puppeteer would work for simple browser automation, but Playwright is a better fit here because it has first-class support for:

- multiple isolated browser contexts
- multiple pages in one test
- built-in web server orchestration
- browser storage state control
- tracing/screenshots/videos for failure analysis
- Chromium/WebKit/Firefox if cross-browser coverage becomes useful

An MCP browser server is useful for ad hoc inspection, but it is not a replacement for repeatable checked-in E2E tests. The durable approach is a Playwright suite in the repo. The repo already has `@playwright/test` in `examples/react-crdt`, a starter `examples/react-crdt/playwright.config.ts`, and `examples/react-crdt/tests/example.spec.ts`; the remaining work is to replace the scaffold with migration-focused specs and server fixtures.

## Required Capabilities

### Browser Automation

Needed:

- launch browser pages against the React CRDT dev server
- create two or more isolated browser contexts/profiles
- click through app modes and controls
- inspect DOM-visible sync state
- run page scripts to inspect localStorage and IndexedDB
- observe or wait on websocket-driven UI changes
- collect screenshots/traces when a migration flow fails

Tooling:

- Playwright test runner
- `@playwright/test`
- Chromium as the initial browser

### Local Process Control

Needed:

- start the React CRDT Vite dev server
- start the Bun server sync process
- stop/restart either process during reconnect and lock-expiry tests
- run each server test with a temporary SQLite database

Tooling:

- Playwright `webServer` config for the Vite app
- Playwright fixture for the Bun server, so each worker/test can create and seed an isolated database
- server CLI database path: `bun --bun src/index.ts --db /tmp/umkehr-e2e.sqlite`
- seeded server database wrapper: `bun run seed:test -- --db /tmp/umkehr-e2e.sqlite --date 2026-01-02 --size small`

Current gap:

- The server now accepts `--db <path>`, so temp SQLite DBs are possible without an environment variable.
- The server port is still hard-coded to `8787`, so parallel server E2E tests either need one worker or a `--port`/environment override.
- The migration lock TTL is still hard-coded to 60 seconds in `ServerStore`, so lock-expiry tests still need a test override or a direct store-level helper.

### Storage Seeding

Needed:

- seed old-schema local history
- seed old-schema local-first replica and retained batches
- seed old-schema server replica data
- seed active server migration lock
- seed pending local server events
- seed malformed migration uploads for negative tests

Existing seed database setup:

- `examples/react-crdt/src/lib/seed/generate.ts` is the canonical deterministic fixture catalog.
- The client script `seed:server` builds that generator with `vite.seed.config.ts` and prints a server-shaped JSON payload.
- `examples/react-crdt-server/src/seed.ts` imports a seed JSON payload from stdin or `--input`.
- `examples/react-crdt-server/src/seedTest.ts` runs the client generator and imports it directly into a SQLite file.
- `examples/react-crdt-server` exposes `bun run seed:test -- --db <path> --date <date> --size small|default|large`.
- `ServerStore.importSeedDatabase(...)` validates the payload before clearing data, writes in one transaction, inserts users/documents/metadata/branches/events, and clears migration locks/archive rows on overwrite.

Current valid seed documents:

- Todos: `todos-small`, `todos-many-items`, `todos-many-events`, `todos-branches`, `todos-merge-review`, `todos-conflicting-fields`, `todos-array-operations`, `todos-deletes-and-readds`, `todos-recursive-merges`, `todos-partial-repeat-merge`, `todos-wide-branch-list`.
- Whiteboard: `whiteboard-many-elements`, `whiteboard-branches`, `whiteboard-element-editing`, `whiteboard-dense-overlap`, `whiteboard-conflicting-element-edits`, `whiteboard-many-events`.
- Migration: `todos-migration-v1-main`, with `appId: "todos-migration-fixture"`, schema version 1, and the v1 fixture fingerprint hash from `examples/migration-fixtures/todos.ts`.

Related projections already exist:

- `createLocalFirstSeedReplica({fixture})` projects branch-free seed fixtures to local-first IndexedDB-shaped replicas and retained batches.
- `createServerClientSeedReplica({fixture, scenario: "cached" | "pending-uploads"})` projects fixtures to cached or pending server-client browser state.
- `generateMalformedSeedPayloads(...)` returns malformed server payloads for importer/negative validation tests, separate from the default valid payload.

Best approach from here:

- Reuse `generateSeedFixtureCatalog(...)` and the existing projections instead of inventing separate E2E fixtures.
- Use `bun run seed:test` for whole-server database setup.
- Add thin Playwright-side helpers that write existing browser projection shapes into IndexedDB/localStorage.
- Prefer structured app/server APIs over handwritten IndexedDB mutation inside browser tests.
- Keep seed helpers test-only or dev-only.

Suggested files:

- `examples/react-crdt/tests/seed/browserStorage.ts`
- `examples/react-crdt/tests/helpers/server.ts`
- `examples/react-crdt/tests/helpers/storage.ts`

The existing `examples/migration-fixtures/todos.ts` remains the canonical v1/v2 migration shape; the seed generator already imports it for `todos-migration-v1-main`.

### Server Test Hooks

Needed:

- reset server database
- seed old active document
- seed branches/events
- create/expire migration lock
- inspect active schema hash
- inspect archived schema hashes
- inspect active branch events

Existing:

```sh
cd examples/react-crdt-server
bun run seed:test -- --db /tmp/umkehr-e2e.sqlite --date 2026-01-02 --size small
bun --bun src/index.ts --db /tmp/umkehr-e2e.sqlite
```

Recommended:

- Keep setup as CLI/module-based seeding, not test-only HTTP endpoints.
- Add small E2E helpers that can query SQLite for assertions such as active schema hash, archived schema hashes, branch event counts, and active migration lock state.
- Add a test-only way to create or shorten migration locks. This can be a store helper imported by tests or a CLI, but does not need to be a public server endpoint.

## Proposed Repo Shape

```text
examples/react-crdt/
  tests/
    migration.spec.ts
    local-first.spec.ts
    server-migration.spec.ts
    helpers/
      app.ts
      storage.ts
      server.ts
      assertions.ts
    seed/
      browserStorage.ts
  playwright.config.ts
```

Server-side helpers:

```text
examples/react-crdt-server/
  src/
    seedTest.ts
    seed.ts
```

Root scripts:

```json
{
  "scripts": {
    "test:e2e:migration": "playwright test -c examples/react-crdt/playwright.config.ts"
  }
}
```

## Playwright Fixtures

Useful fixtures:

- `appPage`: one current-schema browser page.
- `secondAppPage`: another isolated current-schema page.
- `oldAppPage`: old-schema or seeded old-schema page.
- `serverDbPath`: temporary SQLite file path.
- `serverProcess`: Bun server process using that DB path.
- `seedServerDatabase(options)`: runs `bun run seed:test -- --db <path> --date <date> --size <size>`.
- `seedServerFixture(docId)`: starts from the generated catalog and optionally prunes/imports one document if a test needs a smaller DB.
- `clearBrowserStorage(page)`: clears localStorage and IndexedDB.
- `seedBrowserStorage(page, scenario)`: writes localStorage/IndexedDB fixture data from `createLocalFirstSeedReplica(...)` or `createServerClientSeedReplica(...)`.
- `inspectServerDb(dbPath)`: checks active document schema, archived schemas, branch events, users, and locks.

## Scenarios To Automate First

### 1. Fresh Server Sync

Purpose:

- Verify baseline app/server wiring.

Steps:

1. Start server with an empty temp DB, or with seed DB imported and a new document id.
2. Open two isolated browser contexts in server mode.
3. Log in as two users.
4. Make a todo edit in client A.
5. Verify client B sees it.
6. Verify pending upload count returns to zero.

Expected:

- Both clients connect.
- Server event timeline includes the edit.
- Presence appears.

### 2. Server Migration Required

Purpose:

- Verify newer client can initiate migration.

Steps:

1. Seed server with `todos-migration-v1-main`.
2. Open current client in server mode against that doc id.
3. Observe migration-required toolbar notice.
4. Accept migration prompt.
5. Wait for reconnect.
6. Verify migrated todo fields.
7. Verify debug/admin state or server DB has archived old schema hash.

Expected:

- Current client migrates server dump.
- Active schema hash becomes current hash.
- Old data is archived.
- Normal sync returns migrated branch data.

### 3. Competing Client During Migration

Purpose:

- Verify waiting clients can still edit locally and queue pending updates.

Steps:

1. Seed server with `todos-migration-v1-main`.
2. Open client A and begin migration.
3. Hold or delay A before upload.
4. Open client B.
5. Verify B shows migration-running notice.
6. Make local edits in B.
7. Verify pending upload count increases.
8. Verify no writes are sent while migration is locked.
9. Complete or cancel migration.

Expected:

- B is not blocked from editing.
- B’s edits remain local pending events.
- Server rejects or never receives B writes while lock is active.

### 4. Old Client After Migration

Purpose:

- Verify update-your-app is unobtrusive and local edits stay pending.

Steps:

1. Complete server migration with current client.
2. Open an old-schema client or simulate old schema metadata.
3. Verify update-your-app toolbar notice.
4. Make local edits.
5. Verify pending upload count increases.
6. Verify no writes flush to server.

Expected:

- Notice is informational, not a modal/blocking error.
- Editing still works locally.
- Pending local events are preserved.

### 5. Local-First Retained Batch Migration

Purpose:

- Verify local-first migration uses retained batches as source of truth.

Steps:

1. Seed browser IndexedDB with an old-schema local-first replica and retained batches.
2. Open current app in local-first mode.
3. Observe migration panel.
4. Create migrated document.
5. Open migrated document.
6. Inspect visible state and local-first stats.

Expected:

- Source document remains.
- Target document has current schema hash/version.
- Lineage appears.
- Retained batches reconstruct history.
- Vector is recomputed from migrated batches.

### 6. Local-First Schema Mismatch

Purpose:

- Verify mismatched peers do not exchange data and show an update-your-app message.

Steps:

1. Open two contexts with incompatible schema metadata.
2. Connect via invite.
3. Make local edits on both.

Expected:

- Connection row shows schema mismatch.
- State is incompatible.
- Local edits remain in each local replica.
- No incompatible batch is accepted.

### 7. Migration Failure Does Not Discard Data

Purpose:

- Verify failed migration leaves old data intact.

Steps:

1. Seed old-schema data, preferably `todos-migration-v1-main` for server tests and the migration fixture projection for browser/local-first tests.
2. Configure missing migration path or bad migration output.
3. Load current app.
4. Trigger migration.
5. Inspect browser/server storage.

Expected:

- User sees concise failure.
- Developer console shows detailed validation/replay error.
- Old data remains available.
- No partial migrated active data is committed.

## Seed Data Requirements

The todos migration fixture already supports:

- v1 state with `text`, optional `archived`, optional `legacyFilter`
- v2 state with `title`, required `priority`
- CRDT updates that:
  - rename a todo text
  - drop an archived update
  - add a todo requiring default priority
- server events with contiguous indexes via `todoFixtureServerUpdateEventsV1`

Existing fixture:

- `examples/migration-fixtures/todos.ts`

Existing seed wrappers:

- `todosMigrationV1Main(...)` in `examples/react-crdt/src/lib/seed/generate.ts` emits a valid old-schema server document.
- `createLocalFirstSeedReplica(...)` emits local-first replica plus retained batches from branch-free seed fixtures.
- `createServerClientSeedReplica(...)` emits cached/pending server-client browser state from seed fixtures.

Remaining seed-helper work:

- Add a browser-storage projection for the old-schema migration fixture specifically, if local-first migration E2E tests need to start from v1 data.
- Add an E2E helper for importing only one generated document into SQLite, or accept the full 18-document seeded DB and select the relevant doc id in the UI.

## Simulating Old Clients

There are three possible strategies.

### Strategy A: Real Old Build

Use an old commit/build in a second checkout.

Pros:

- Highest confidence.
- Catches bundling/runtime differences.

Cons:

- More setup.
- Harder to run in CI.

### Strategy B: Schema Metadata Override

Add a test-only URL parameter or build flag to force old schema metadata while using the current code.

Pros:

- Easy to automate.
- Good for protocol and UI states.

Cons:

- Does not prove old code behavior.

### Strategy C: Direct Protocol Client

Use a test websocket client that sends old-schema hello/update messages.

Pros:

- Fast and deterministic.
- Good for server protocol states.

Cons:

- Does not test browser UX.

Recommended:

- Use Strategy B for most E2E tests.
- Use Strategy C for edge protocol tests.
- Periodically run Strategy A manually before major migration releases.

## CI Considerations

Playwright tests should be split into tiers.

Fast tier:

- seeded browser/server data from `generateSeedFixtureCatalog(...)`
- one schema-version split using `todos-migration-v1-main`
- one browser engine
- runs in CI on every PR touching migration/server/local-first code

Slow tier:

- multi-browser
- old-build simulation
- process interruption/reconnect
- lock-expiry timing
- runs nightly or before release

Suggested timeouts:

- Keep normal tests under 30 seconds each.
- Use a fake or shortened lock timeout in test mode instead of waiting the current 60-second server TTL.

## Test-Mode Server Configuration

Current test-mode configuration:

- Server DB path is available as a CLI flag: `--db <path>`.
- Seed database import is available through `bun run seed:test -- --db <path> --date <date> --size <size>`.
- Server port is not configurable yet.
- Migration lock TTL is not configurable yet.

Useful additions:

- `--port` or `UMKEHR_SERVER_PORT`
- `--migration-lock-ms` or `UMKEHR_MIGRATION_LOCK_MS`

The lock timeout override is especially important. A one-minute manual timeout is acceptable, but automated tests should use something like 500-2000 ms.

## What Codex Would Need

To run these tests autonomously, Codex needs:

- Playwright installed.
- Permission to start Vite and Bun server processes.
- Permission to access `localhost`.
- Permission to create/delete temporary SQLite files.
- The existing deterministic seed scripts.
- Stable selectors or accessible names in the UI.
- A test-mode way to shorten migration lock expiry.

Codex does not need an MCP server if Playwright tests are checked in and runnable from the shell. The Browser plugin can help debug failures interactively, but repeatability should live in Playwright.

## Open Questions

- Should migration specs stay in existing `examples/react-crdt/tests`, or should the Playwright config move to `examples/react-crdt/e2e` once the suite grows?
- Should tests import the full seed DB and select doc ids, or add a focused one-document seed import helper?
- Do we want schema metadata override flags in the app for simulating old clients?
- Should the server debug/admin page expose machine-readable JSON for active/archived schema state?
- How much old-build testing should be automated versus kept as a release checklist?
- Should local non-CRDT migration have a browser-visible fixture page, or is localStorage seeding enough?
- Should server `--port` and migration lock TTL overrides be CLI flags, environment variables, or both?

## Summary

The practical path is:

1. Use the existing Playwright scaffold in `examples/react-crdt`.
2. Use the existing seed database pipeline for server E2E setup: `seed:server` -> `seedTest.ts` -> SQLite `--db`.
3. Add Playwright helpers for starting the Bun server with a temp DB, selecting seeded document ids, and inspecting SQLite state.
4. Add server `--port` and migration lock TTL overrides before parallel/expiry tests.
5. Add browser-storage seeding wrappers around the existing local-first and server-client seed projections.
6. Automate the highest-risk server migration and local-first migration flows first.
7. Keep real old-build testing as a slower release check unless schema churn becomes frequent.
