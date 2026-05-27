# Seeded server database implementation log

## Phase 1: Server store support

Status: completed.

Implemented:

- Added server-side seed payload types in `examples/react-crdt-server/src/types.ts`:
  - `DocumentMetadata`
  - `SeedUser`
  - `SeedDocument`
  - `SeedDatabasePayload`
- Extended `DocumentSummary` with metadata fields:
  - `title`
  - `sizeLabel`
  - `sizeRank`
  - `createdAt`
  - `lastAccessedAt`
- Added a `document_metadata` SQLite table in `ServerStore`.
- Added metadata APIs:
  - `upsertDocumentMetadata(...)`
  - `touchDocumentAccess(...)`
- Added `importSeedDatabase(payload, options)` to `ServerStore`.
- Seed import now:
  - validates the payload before clearing data;
  - overwrites the target database by default;
  - runs writes in one SQLite transaction;
  - inserts users, documents, metadata, branches, and events;
  - clears migration locks and archived documents during overwrite.
- Refactored branch/event consistency validation so seed import and migration upload share the same core checks.
- Updated `summarizeDocuments()` to include metadata while still returning sensible fallback values for normal documents without metadata.

Tests added:

- imports seeded users, document metadata, branches, and events;
- overwrites existing seeded database contents by default;
- keeps existing data when seed import validation fails;
- supports metadata upserts and access touches on normal documents.

Verification:

```sh
cd examples/react-crdt-server
bun test ./src/store.bun.ts
```

Result: 13 pass, 0 fail.

```sh
cd examples/react-crdt-server
bun run typecheck
```

Result: passed.

Notes:

- Phase 1 did not wire document access touching into the WebSocket `hello` path; the store method exists for Phase 2 server endpoint/runtime wiring.
- Phase 1 did not add `/documents`, argv parsing, or seed scripts; those remain Phase 2.

## Phase 2: Server CLI, endpoints, and scripts

Status: completed.

Implemented:

- `src/index.ts` now accepts `--db <path>`, passes it to `ServerStore`, and logs the selected database.
- Added `GET /documents` returning `{documents: store.summarizeDocuments()}`.
- Debug document table now includes metadata fields.
- Successful WebSocket `hello` calls now touch document access metadata.
- Added `src/seed.ts` importer:
  - reads seed JSON from stdin or `--input <path>`;
  - accepts `--db <path>`;
  - imports via `ServerStore.importSeedDatabase(...)`.
- Added package scripts:
  - `dev:test`
  - `seed:test`

Verification:

- `bun test ./src/store.bun.ts`: 13 pass.
- `bun run typecheck`: passed.
- Smoke-tested `src/seed.ts` with stdin JSON into `/private/tmp/umkehr-seed-smoke.sqlite`: passed.

Note:

- `seed:test` is ready for Phase 3, but currently expects JSON on stdin until the client fixture generator exists.

## Phase 3: Client-side fixture generator

Status: completed.

Implemented:

- Split todo and whiteboard schema/state exports into React-free `schema.ts` modules so seed generation can share the exact app schemas.
- Added `examples/react-crdt/src/lib/seed/generate.ts`.
- Generator emits 4 seeded users and 7 documents:
  - `todos-small`
  - `todos-many-items`
  - `todos-many-events`
  - `todos-branches`
  - `todos-merge-review`
  - `whiteboard-many-elements`
  - `whiteboard-branches`
- Added `--date` for deterministic timestamps and `--size small|default|large`.
- Added `vite.seed.config.ts` so the generator can be built with the typia Vite transform before running under Node.
- Added client `seed:server` script.
- Replaced server `seed:test` with `src/seedTest.ts`, which runs the client generator as a subprocess and imports the generated payload. It forwards generator args, so `bun run seed:test -- --date 2026-01-02 --size small` works.

Verification:

- Client typecheck: passed.
- Server typecheck: passed.
- Server store tests: 13 pass.
- Determinism check with fixed `--date`: passed.
- `bun run seed:test -- --date 2026-01-02 --size small --db /private/tmp/umkehr-phase3-wrapper.sqlite`: imported 7 documents and 4 users.

## Phase 4: Client document discovery and URL switching

Status: completed.

Implemented:

- Added client `ServerDocumentSummary` type.
- Server mode now fetches `/documents` independently from login/sync bootstrap.
- Added document dropdown to `ServerControls`.
- Dropdown shows all server documents and keeps a manual active doc option if the URL doc is not in `/documents`.
- Selecting a document updates `?doc=<docId>`, preserves the hash, and remounts server mode for the new doc.
- `/documents` failures are shown as a toolbar notice without blocking login or sync controls.
- Added responsive toolbar styles for the picker.

Verification:

- Client typecheck: passed.
- Server typecheck: passed.
- Server store tests: 13 pass.

## Phase 5: Tests

Status: completed.

Implemented:

- Extracted server document parsing/URL helpers to `src/lib/server/documents.ts`.
- Added client tests for:
  - document summary parsing and malformed response rejection;
  - reading/writing the `doc` query param while preserving hash and other params;
  - keeping a manual active doc option when it is not in `/documents`.
- Made seed generation importable via `generateSeedDatabasePayload(...)`.
- Added client seed generator tests for:
  - expected document ids and seeded users;
  - deterministic output with fixed `--date`;
  - stress fixture sizing.
- Extracted server CLI `--db` parsing to `src/cli.ts`.
- Added Bun tests for server `--db` parsing.
- Updated the server test script to include CLI tests.

Verification:

- `npx vitest run src/lib/server/documents.test.ts src/lib/seed/generate.test.ts`: 6 pass.
- `bun test ./src/store.bun.ts ./src/cli.bun.ts`: 16 pass.
- Client typecheck: passed.
- Server typecheck: passed.
- `bun run seed:test -- --date 2026-01-02 --size small --db /private/tmp/umkehr-phase5-wrapper.sqlite`: imported 7 documents and 4 users.
