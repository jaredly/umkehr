# Seeded server database research

## Goal

We want a repeatable way to generate a server SQLite database for the React CRDT server example with several named test documents. Each document should exercise a different behavior: large event logs, large todo lists, branch and merge topology, migration scenarios, and other cases useful for manual evaluation.

When running `examples/react-crdt-server` with `bun dev`, it should be easy to choose between normal usage data and the generated test data. On the web side, server mode should load a document by id from a query param and expose a dropdown for switching documents.

## Current architecture

The server lives in `examples/react-crdt-server`.

- `src/store.ts` owns SQLite schema creation and all document, branch, event, user, and migration lock persistence.
- `ServerStore` defaults to `server-sync.sqlite`, but its constructor already accepts a custom database path.
- Documents are represented by `documents`, `branches`, and `branch_events`.
- `ServerStore.summarizeDocuments()` already returns `DocumentSummary[]` with `docId`, schema metadata, branch count, and event count.
- `/debug` already renders document summaries and recent events, but there is no JSON `/documents` endpoint.
- Server document creation is lazy: a client `hello` creates the document if the schema matches or the document does not exist.

The client lives in `examples/react-crdt`.

- Server mode is implemented in `src/lib/server/ServerApp.tsx`.
- `readActiveDocId()` already reads `?doc=...`; if it is absent, `ServerApp` falls back to `runtime.docId`.
- Local browser replicas are persisted per `docId` in IndexedDB.
- The server UI currently fetches only `/users`; it does not fetch document summaries.
- `ServerControls` is the natural home for a compact document selector because it already owns server toolbar controls and sync state.

The shared app registry lives in the client package, while the Bun server package does not currently import client app definitions. That matters for seed generation because seeded documents need the same schema fingerprints the browser will send during `hello`.

## Recommended approach

Add a server-side seeding script that uses `ServerStore` directly and writes a separate SQLite file, for example `test-server-sync.sqlite`. Then make `bun dev` choose the SQLite file through an environment variable or an explicit npm/bun script.

Recommended pieces:

1. Add `examples/react-crdt-server/src/seed.ts`.
2. Add an exported `databasePathFromEnv()` helper or simple env read in `src/index.ts`.
3. Add package scripts such as:
   - `bun run seed:test`
   - `bun run dev`
   - `bun run dev:test`
4. Add `GET /documents` returning `store.summarizeDocuments()`.
5. Add a server document picker in the client that fetches `/documents`, writes `?doc=<docId>` with `history.pushState` or `location.assign`, and remounts server mode for the new doc id.

The key design choice is to keep the generated test database separate from normal usage data. This avoids requiring destructive reset behavior for day-to-day testing and makes it clear when a developer is using curated fixtures.

## Seed generation options

### Option 1: Use `ServerStore` append APIs

The seed script imports `ServerStore` and app schema metadata, then calls:

- `ensureDocument`
- `appendUpdateEvent`
- `createBranch`
- `appendMergeEvent`

Benefits:

- Reuses production validation around contiguous event indexes, branch existence, duplicate HLC timestamps, and merge source bounds.
- Avoids hand-writing SQLite rows or duplicating storage details.
- Produces a database that matches how the running server writes data.
- Easy to test with the existing Bun test setup.

Costs:

- Generating many CRDT updates requires either using CRDT helpers or constructing valid update payloads carefully.
- Importing app schema metadata into the server package may require adjusting TypeScript config or moving shared fixture helpers to a common location.

This is the safest default.

### Option 2: Generate a migration upload dump and insert atomically

The seed script could build `ServerBranch[]` and `ServerBranchEvent[]` in memory, then insert them through a new `replaceDocumentFixture` method on `ServerStore`.

Benefits:

- Faster for very large fixtures because it can batch insert.
- Good fit for complex branch topologies where all event indexes are known up front.
- Could reuse migration upload validation rules.

Costs:

- Requires a new store API that is fixture-oriented rather than production-oriented.
- Easy to bypass invariants unless the method validates as strictly as `completeMigration`.
- More code than needed for a first pass.

This is useful later if seed generation becomes slow.

### Option 3: Raw SQLite fixture writer

The script could open `bun:sqlite` directly and insert rows into `documents`, `branches`, and `branch_events`.

Benefits:

- Fast and independent of `ServerStore` public API.
- Can create edge-case databases that production APIs would reject.

Costs:

- Duplicates schema knowledge.
- Higher risk of invalid fixtures that fail for accidental storage reasons instead of real app behavior.
- More likely to break when migrations change store tables.

This should be reserved for testing corrupt or legacy database cases, not normal seeded evaluation data.

## Fixture document ideas

Initial fixtures should be small enough to regenerate quickly but varied enough to expose UI and sync behavior:

- `todos-small`: a baseline todo document with a handful of completed and open items.
- `todos-many-items`: hundreds or thousands of todo items to test rendering, materialization, and local persistence size.
- `todos-many-events`: a moderate number of todos changed many times to test event replay and history UI performance.
- `todos-branches`: several branches forked from different main indexes, with edits on each branch.
- `todos-merge-review`: branches merged back into main, including a merge that changes overlapping logical areas.
- `whiteboard-many-elements`: many notes, strokes, and emoji stamps for canvas/UI load testing.
- `whiteboard-branches`: whiteboard edits spread across branches to exercise branch preview and merge materialization.

For each fixture, store a human-readable label somewhere. The current database has no document metadata table, so either:

- derive labels from `docId` in the first pass, or
- add a small `document_metadata` table with `docId`, `label`, `description`, `fixtureKind`, and maybe `sortOrder`.

If the UI dropdown should be understandable without encoded ids, the metadata table is worth adding.

## Schema metadata issue

Seeded documents must use the exact schema version, fingerprint, and fingerprint hash expected by the browser app. Otherwise the server handshake will trigger migration or mismatch flows instead of loading the fixture.

There are three viable ways to share schema metadata:

1. Import app definitions from `examples/react-crdt` into `examples/react-crdt-server`.
2. Move shared fixture/schema helpers into a common examples package or folder.
3. Generate seed data from the client package and write to the server database path.

The first option is quickest but couples the server package to client source layout. The second option is cleaner if more server-side fixture tooling is expected. The third option keeps app ownership with the client but may complicate Bun package scripts.

## Database selection options

### Option A: Environment variable

Use an env var such as `UMKEHR_SERVER_DB_PATH`.

Example scripts:

```json
{
  "scripts": {
    "dev": "bun --bun src/index.ts",
    "dev:test": "UMKEHR_SERVER_DB_PATH=test-server-sync.sqlite bun --bun src/index.ts",
    "seed:test": "UMKEHR_SERVER_DB_PATH=test-server-sync.sqlite bun --bun src/seed.ts"
  }
}
```

Benefits:

- Minimal code.
- Works in CI and local shells.
- Keeps `ServerStore` constructor unchanged.

Costs:

- Inline env syntax is POSIX-oriented; if Windows support matters, use a small JS launcher or `cross-env`.

### Option B: CLI argument

Let `src/index.ts` parse `--db <path>` and `src/seed.ts` parse `--out <path>`.

Benefits:

- Explicit and shell-portable.
- Easy to document.

Costs:

- Slightly more parsing code.
- Environment variables are still useful for scripts and tests.

### Option C: Server-side database switch endpoint

Run one server that can switch between normal and test databases at runtime.

Benefits:

- One long-lived server process.
- Could support a UI-level test/normal toggle.

Costs:

- Active WebSocket clients, migration locks, and presence state become ambiguous during switches.
- More state management than the task appears to need.

Prefer Option A or B. A runtime switch is not needed unless developers frequently need both databases under one server process.

## Client document selector options

### Option 1: Query param is the source of truth

Fetch `/documents`, render a dropdown, and on selection update `?doc=<docId>` and remount `ServerApp`.

Benefits:

- Matches the task directly.
- URLs are shareable.
- Keeps IndexedDB replicas keyed by doc id.
- Minimal changes because `readActiveDocId()` already exists.

Costs:

- Switching docs probably closes/reopens the WebSocket and remounts the provider.
- Need to decide whether to preserve other query params and hash mode when changing docs.

This is the recommended path.

### Option 2: Internal React state only

Keep active doc id in component state and avoid changing the URL.

Benefits:

- Fewer browser history concerns.

Costs:

- Does not satisfy the query param requirement.
- Harder to share a specific fixture.

Not recommended.

### Option 3: Include app id in document metadata

Return documents grouped by app/schema and only show documents compatible with the active app.

Benefits:

- Avoids choosing a todo fixture while the whiteboard app is active.
- Can make the dropdown much clearer.

Costs:

- Requires metadata beyond the current `documents` table.
- Without metadata, compatibility can only be inferred from schema fingerprint hash.

A first pass can filter by `schemaFingerprintHash`; a polished version should include app metadata in seeded fixture records.

## Testing strategy

Server tests:

- Seeding into a temp database creates expected document summaries.
- Seed script is idempotent or explicitly resets the target test database.
- `/documents` returns JSON summaries with CORS headers.
- `UMKEHR_SERVER_DB_PATH` or CLI selection causes `ServerStore` to use the requested file.

Client tests:

- `readActiveDocId()` honors `?doc=...`.
- Document selector renders fetched summaries.
- Selecting a document updates the URL and causes server mode to load the new doc id.
- Dropdown handles server unavailable state without blocking normal sync controls.

Manual checks:

- `bun run seed:test` then `bun run dev:test` in `examples/react-crdt-server`.
- `pnpm dev` in `examples/react-crdt`.
- Open server mode, choose fixture documents, refresh, and verify the selected doc remains selected via query param.

## Open questions

- Should the seed script overwrite the test database by default, or should reset require `--force`?
  - overwrite
- Where should app schema and fixture builders live so both the client example and server seed script can import them without awkward package coupling?
  - they should live in a script in the client, which produces a json blob that gets passed to a script in the server. either shell pipe or subprocess, I don't care which.
- Do we want a document metadata table now, or is `docId` plus branch/event counts enough for the first dropdown?
  - yes metadata table w/ title, size (approximate/proxy measure is fine), date created, date last accessed
- Should normal usage and test usage be separate scripts only, or should the UI expose a database mode indicator?
  - separate script invocations (use an argv)
- Should seeded documents include users, or should users remain normal server state created through login?
  - definitely should include users; and some docs should have updates from multiple users
- How large should the stress fixtures be by default so they are useful without making local startup slow?
  - idk a couple thousand updates is fine
- Should generated fixture events be deterministic across runs, including HLC timestamps and branch ids, to make database diffs stable?
  - hmm default to using current date for hlc timestamp, but the seed script should accept a --date param for determinism
- Should the selector show only documents compatible with the current app/schema, or all documents with incompatible ones disabled?
  - all documents for now
- What query param name should be canonical: the existing `doc`, or a more explicit `docId`?
  - doc is fine
