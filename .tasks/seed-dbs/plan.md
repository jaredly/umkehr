# Seeded server database implementation plan

## Goal

Add a repeatable seeded-database workflow for the React CRDT server example.

The target behavior is:

- run a script that overwrites and regenerates a test SQLite database;
- run the server against either normal usage data or the generated test data via explicit argv/script invocation;
- include seeded users and documents with updates from multiple users;
- expose document metadata through the server;
- let the web server mode select documents with `?doc=...` and a dropdown;
- support an optional `--date` argument so generated HLC timestamps can be deterministic.

There are unrelated worktree changes in this repo. Implementation should inspect current diffs before editing shared files and avoid reverting user work.

## Decisions

- The test seed database should be overwritten by default.
- Database mode should be selected by separate script invocations using argv, not by a runtime switch endpoint.
- Fixture generation should live on the client side, where app schema and fixture builders are available.
- The client fixture generator should produce a JSON blob that is passed to a server-side import script. A shell pipe or subprocess is fine.
- Add a metadata table for documents with:
  - title
  - approximate size/proxy measure
  - date created
  - date last accessed
- Seeded databases should include users.
- Some seeded documents should include updates from multiple users.
- Stress fixtures can be a couple thousand updates by default.
- Default seed timestamps may use the current date.
- The seed flow must accept `--date` for deterministic timestamp generation.
- The dropdown should show all documents for now, even if some are incompatible with the active app/schema.
- Keep the canonical query param as `doc`.

## Data Shape

Add a fixture exchange format shared by the client generator and server importer.

Candidate shape:

```ts
type SeedDatabasePayload = {
    generatedAt: string;
    users: SeedUser[];
    documents: SeedDocument[];
};

type SeedUser = {
    userId: string;
    nickname: string;
};

type SeedDocument = {
    docId: string;
    title: string;
    sizeLabel: string;
    sizeRank: number;
    createdAt: string;
    lastAccessedAt: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    branches: ServerBranch[];
    events: ServerBranchEvent[];
};
```

Use deterministic ids for fixture users, document ids, branch ids, merge ids, and HLC actor ids. Use `--date` to anchor timestamps. If `--date` is omitted, use the current date.

The server importer should validate the payload envelope before writing data. It can trust CRDT update payloads at the same level the server already trusts client messages, but it should still enforce document, branch, and event consistency.

## Phase 1: Server store support

Likely files:

- `examples/react-crdt-server/src/store.ts`
- `examples/react-crdt-server/src/types.ts`
- `examples/react-crdt-server/src/store.bun.ts`

Work:

- Add a `document_metadata` table created by `ServerStore`.
- Add migration logic for existing databases that do not have the metadata table.
- Extend `DocumentSummary` or add a sibling type with metadata fields:
  - `title`
  - `sizeLabel`
  - `sizeRank`
  - `createdAt`
  - `lastAccessedAt`
- Add store methods:
  - `upsertDocumentMetadata(...)`
  - `touchDocumentAccess(docId, at)`
  - `importSeedDatabase(payload, options)`
- `importSeedDatabase` should overwrite existing data by default for the target database.
- Import should run in one transaction.
- Import should insert users, documents, metadata, branches, and branch events.
- Reuse or extract existing validation from migration upload validation where practical:
  - every document has `main`;
  - branch tips match event counts;
  - event indexes are contiguous per branch;
  - merge source branches exist;
  - merge source indexes are within source branch tips.
- Update `summarizeDocuments()` to include metadata and sort by metadata order/title or doc id.
- Update access time when a document is opened. The least invasive place is on successful `hello` after `ensureDocument`.

Acceptance:

- Store tests can import a seed payload into a temp database and read all summaries.
- Import overwrites prior test data cleanly.
- Imported branch tips and events can be listed through existing store APIs.
- Existing normal databases without metadata still open.

## Phase 2: Server CLI, endpoints, and scripts

Likely files:

- `examples/react-crdt-server/src/index.ts`
- `examples/react-crdt-server/src/seed.ts`
- `examples/react-crdt-server/package.json`

Work:

- Add argv parsing for the server:
  - `--db <path>` selects the SQLite database path.
  - default remains `server-sync.sqlite`.
- Instantiate `ServerStore` with the parsed path.
- Log the selected database path on startup.
- Add `GET /documents` returning `{documents: store.summarizeDocuments()}` with CORS headers.
- Keep `/debug` working and include metadata if available.
- Add a server-side seed importer script:
  - reads JSON from stdin or a `--input <path>` argument;
  - accepts `--db <path>`;
  - overwrites the target database by default;
  - exits non-zero with a clear error for invalid payloads.
- Add package scripts:
  - `dev`: normal database, current behavior;
  - `dev:test`: server using the test database path via argv;
  - `seed:test`: run the client fixture generator and feed the server importer.

Acceptance:

- `bun run dev` uses the normal database.
- `bun run dev:test` uses the test database.
- `bun run seed:test` overwrites and regenerates the test database.
- `/documents` returns summaries for the selected database.

## Phase 3: Client-side fixture generator

Likely files:

- `examples/react-crdt/src/lib/seed/`
- `examples/react-crdt/src/apps/todos/`
- `examples/react-crdt/src/apps/whiteboard/`
- `examples/react-crdt/package.json`

Work:

- Add a Bun/TS script in the client example that emits `SeedDatabasePayload` JSON.
- Import app definitions or schema helpers from the existing client app modules so schema version, fingerprint, and fingerprint hash match browser server mode.
- Build helper utilities for fixture event generation:
  - deterministic clock anchored to `--date`;
  - deterministic users/actors;
  - create initial CRDT document/history;
  - apply local-style updates and emit `ServerUpdateEvent`s;
  - create branches and merge events.
- Generate seeded users such as:
  - Ada
  - Ben
  - Cy
  - Dee
- Generate initial fixtures:
  - `todos-small`
  - `todos-many-items`
  - `todos-many-events`
  - `todos-branches`
  - `todos-merge-review`
  - `whiteboard-many-elements`
  - `whiteboard-branches`
- Use multiple users in at least the branch and many-events fixtures.
- Keep default stress size around a couple thousand updates.
- Support arguments:
  - `--date <iso-date-or-date-time>`
  - optional `--size <small|default|large>` if cheap; otherwise defer.

Acceptance:

- Running the generator prints valid JSON.
- With the same `--date`, generated ids, HLC timestamps, branch topology, and events are stable.
- Without `--date`, generated timestamps are anchored to the current date.
- Generated documents use schema fingerprints accepted by the running browser client.

## Phase 4: Client document discovery and URL switching

Likely files:

- `examples/react-crdt/src/lib/server/ServerApp.tsx`
- `examples/react-crdt/src/lib/server/ServerControls.tsx`
- `examples/react-crdt/src/lib/server/types.ts`
- `examples/react-crdt/src/lib/server/protocol.ts`
- `examples/react-crdt/src/style.css`

Work:

- Add client type for document summaries returned by `/documents`.
- Add `fetchServerDocuments()` using the existing timeout/error style.
- Load document summaries during server bootstrap or in a small hook owned by `ServerApp`.
- Pass summaries, active doc id, and a switch callback into `ServerControls`.
- Render a compact dropdown in the server toolbar:
  - show title when present;
  - include doc id and approximate size/count in option text or title;
  - show all documents, regardless of schema compatibility;
  - keep controls usable if document fetching fails.
- On selection:
  - update `?doc=<docId>`;
  - preserve the existing hash mode/app id;
  - remount server mode for the selected doc;
  - close the current WebSocket via normal component unmount.
- Ensure `readActiveDocId()` remains the canonical source for initial load.

Acceptance:

- Visiting `...?doc=todos-branches#server/...` loads that document.
- Selecting a document changes the URL query param to `doc`.
- Refresh keeps the selected document.
- The dropdown still renders when the active doc was typed manually and is absent from `/documents`.
- The UI does not block login or sync controls if `/documents` is unavailable.

## Phase 5: Tests

Server tests:

- Importing a seed payload creates users, documents, metadata, branches, and events.
- Import is transactional on invalid payload.
- Import overwrites prior target data by default.
- Existing non-seeded documents still work with missing metadata.
- `/documents` returns metadata summaries.
- `--db` causes the server/importer to use the requested file.

Client/unit tests:

- Fixture generator is deterministic with `--date`.
- Fixture generator emits all expected document ids.
- Document summary parsing rejects malformed server responses.
- URL helper preserves hash and updates only `doc`.
- `readActiveDocId()` still honors `?doc=...`.

Manual checks:

- From `examples/react-crdt-server`, run `bun run seed:test`.
- Run `bun run dev:test`.
- From `examples/react-crdt`, run the web dev server.
- Open server mode, log in as a seeded or new user, switch between documents, refresh, and verify the selected doc persists.
- Confirm at least one fixture shows multiple users in event origins/history.

## Implementation Order

1. Add metadata table, document summary shape, and import primitives in `ServerStore`.
2. Add server argv parsing, `/documents`, and the seed importer script.
3. Add client fixture generator and wire `seed:test` to pipe generator output into the importer.
4. Add document summary fetching and dropdown URL switching in server mode UI.
5. Add tests around store import, generator determinism, endpoint parsing, and URL switching.
6. Run server tests, client typecheck/tests, and manual seeded flow.

## Follow-Ups

- Filter or group documents by app/schema once metadata includes explicit app ids.
- Add a visible server database mode indicator if test/normal confusion becomes common.
- Add larger opt-in stress sizes beyond the default couple thousand updates.
- Add corrupt or legacy database fixtures using a raw SQLite writer if needed.
