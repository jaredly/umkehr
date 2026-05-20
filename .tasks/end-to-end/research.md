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

Use **Playwright** as the primary end-to-end test runner, with dev/test seed helpers for old-schema data and server migration states.

Puppeteer would work for simple browser automation, but Playwright is a better fit here because it has first-class support for:

- multiple isolated browser contexts
- multiple pages in one test
- built-in web server orchestration
- browser storage state control
- tracing/screenshots/videos for failure analysis
- Chromium/WebKit/Firefox if cross-browser coverage becomes useful

An MCP browser server is useful for ad hoc inspection, but it is not a replacement for repeatable checked-in E2E tests. The durable approach is a Playwright suite in the repo.

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
- Playwright `webServer` config or test fixture for the Bun server
- environment variable or CLI flag for server SQLite path

Current gap:

- The server currently defaults to `server-sync.sqlite`.
- For repeatable E2E tests, the server should accept a test database path from environment, for example `UMKEHR_SERVER_DB=/tmp/...sqlite`.

### Storage Seeding

Needed:

- seed old-schema local history
- seed old-schema local-first replica and retained batches
- seed old-schema server replica data
- seed active server migration lock
- seed pending local server events
- seed malformed migration uploads for negative tests

Best approach:

- Add checked-in seed helpers that use the same fixture data as unit tests.
- Prefer structured app/server APIs over handwritten IndexedDB mutation inside browser tests.
- Keep seed helpers test-only or dev-only.

Suggested files:

- `examples/react-crdt/e2e/seed/browserStorage.ts`
- `examples/react-crdt/e2e/seed/serverData.ts`
- `examples/react-crdt/e2e/fixtures/todosMigration.ts`

The existing `examples/migration-fixtures/todos.ts` can be reused as the canonical v1/v2 data shape.

### Server Test Hooks

Needed:

- reset server database
- seed old active document
- seed branches/events
- create/expire migration lock
- inspect active schema hash
- inspect archived schema hashes
- inspect active branch events

Options:

1. Test-only HTTP endpoints.
2. A separate seed CLI/script imported by Playwright setup.
3. Direct SQLite access from tests.

Recommended:

- Use a seed CLI or module for setup.
- Avoid exposing seed/reset HTTP endpoints in the dev server unless guarded by a clear test environment flag.

Potential helper:

```sh
bun run src/test-seed.ts --db /tmp/umkehr-e2e.sqlite --scenario old-todos-v1
```

## Proposed Repo Shape

```text
examples/react-crdt/
  e2e/
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
      serverData.ts
  playwright.config.ts
```

Server-side helpers:

```text
examples/react-crdt-server/
  src/
    testSeed.ts
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
- `seedServerScenario(name)`: seeds server DB with a named fixture.
- `clearBrowserStorage(page)`: clears localStorage and IndexedDB.
- `seedBrowserStorage(page, scenario)`: writes localStorage/IndexedDB fixture data.

## Scenarios To Automate First

### 1. Fresh Server Sync

Purpose:

- Verify baseline app/server wiring.

Steps:

1. Start server with empty DB.
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

1. Seed server with old-schema todos document.
2. Open current client in server mode.
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

1. Seed old-schema server document.
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

1. Seed browser IndexedDB with old-schema local-first replica and retained batches.
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

1. Seed old-schema data.
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

The todos migration fixture should support:

- v1 state with `text`, optional `archived`, optional `legacyFilter`
- v2 state with `title`, required `priority`
- CRDT updates that:
  - rename a todo text
  - drop an archived update
  - add a todo requiring default priority
- server events with contiguous indexes
- local-first retained batch with vector metadata

Existing fixture:

- `examples/migration-fixtures/todos.ts`

Additional seed helpers should wrap that fixture for:

- browser `localStorage`
- browser IndexedDB
- server SQLite store

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

- no real schema-version split
- seeded browser/server data
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
- Use fake or shortened lock timeout in test mode instead of waiting a real minute.

## Test-Mode Server Configuration

Useful environment variables:

- `UMKEHR_SERVER_DB`
- `UMKEHR_SERVER_PORT`
- `UMKEHR_MIGRATION_LOCK_MS`
- `UMKEHR_ENABLE_TEST_SEEDING`

The lock timeout override is especially important. A one-minute manual timeout is acceptable, but automated tests should use something like 500-2000 ms.

## What Codex Would Need

To run these tests autonomously, Codex needs:

- Playwright installed.
- Permission to start Vite and Bun server processes.
- Permission to access `localhost`.
- Permission to create/delete temporary SQLite files.
- A deterministic seed API or seed scripts.
- Stable selectors or accessible names in the UI.
- A test-mode way to shorten migration lock expiry.

Codex does not need an MCP server if Playwright tests are checked in and runnable from the shell. The Browser plugin can help debug failures interactively, but repeatability should live in Playwright.

## Open Questions

- Should E2E tests live under `examples/react-crdt/e2e` or a root-level `e2e` directory?
- Should the server expose test-only seed endpoints, or should tests seed SQLite directly?
- Do we want schema metadata override flags in the app for simulating old clients?
- Should the server debug/admin page expose machine-readable JSON for active/archived schema state?
- How much old-build testing should be automated versus kept as a release checklist?
- Should local non-CRDT migration have a browser-visible fixture page, or is localStorage seeding enough?

## Summary

The practical path is:

1. Add Playwright to the React CRDT example.
2. Add deterministic seed helpers using the existing todos migration fixture.
3. Add server test configuration for temp DB path and shorter lock timeout.
4. Automate the highest-risk server and local-first migration flows first.
5. Keep real old-build testing as a slower release check unless schema churn becomes frequent.
