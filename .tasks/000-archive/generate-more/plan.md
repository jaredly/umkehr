# Generate More Seed Coverage Plan

## Goal

Expand `examples/react-crdt/src/lib/seed/generate.ts` from a small server seed payload generator into a comprehensive, reusable fixture catalog for the React CRDT example.

This task should:

- add a file-level doccomment describing current and intended coverage;
- refactor generation around a shared fixture catalog;
- keep emitting the existing server seed JSON shape;
- add valid comprehensive server fixtures by default;
- include delete/tombstone, conflict, recursive merge, migration, and malformed negative fixtures;
- leave local-first IndexedDB seed projection to the broader "seed everything" work.

## Scope Decisions

- Do the fixture catalog refactor in this task.
- Always generate the full valid server fixture set. Do not add `--profile`, `--include`, or filtering yet.
- Include delete/tombstone coverage. The core draft patch API supports `op: 'remove'`, and CRDT conversion emits delete/tombstone updates.
- Include app-level todo id reuse after deletion to expose confusion between app ids and CRDT array item identities.
- Keep the server picker manageable. If the fixture count grows beyond roughly 30 documents, add grouping or a clearer picker organization in a follow-up.
- Do not build local-first seed databases in this task.
- Put malformed/corrupt fixtures in this generator, but keep them out of the default valid server seed payload unless explicitly requested by tests or a separate export.
- Include migration seeds here, using the existing migration fixture types and schema metadata where practical.

## Target Files

- `examples/react-crdt/src/lib/seed/generate.ts`
- `examples/react-crdt/src/lib/seed/generate.test.ts`
- `examples/migration-fixtures/todos.ts`, only if small exports are needed for seed reuse
- `examples/react-crdt-server/src/types.ts`, only if the fixture catalog needs a typed negative or migration payload shape
- `.tasks/generate-more/implementation-log.md`, optional progress log during implementation

## Phase 1: Document Current Generator

Add a top-of-file doccomment to `generate.ts`.

The doccomment should explain:

- the generator is deterministic when `--date` is provided;
- it emits server-shaped seed payloads with users, metadata, schema fingerprints, branches, and events;
- valid fixture edits are generated through real app schemas and `applyLocalCommand`;
- current coverage includes small todos, large todo item lists, long todo event logs, todo branch/merge flows, large whiteboards, and whiteboard branch merges;
- the expanded goal is representative edge-case coverage, not arbitrary corrupt production data.

Keep the doccomment descriptive, not a changelog. It should remain accurate as new fixtures are added.

## Phase 2: Refactor To A Fixture Catalog

Introduce an internal catalog layer above the server payload adapter.

Suggested shape:

```ts
type SeedFixture<TState> = {
    docId: string;
    appId: 'todos' | 'whiteboard' | string;
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
    histories: Record<string, CrdtLocalHistory<TState>>;
};
```

Implementation steps:

- Keep `generateSeedDatabasePayload(...)` as the public server output API.
- Add `generateSeedFixtureCatalog(...)` or an internal equivalent that returns valid fixtures before server projection.
- Convert catalog fixtures to `SeedDocument` in one adapter function.
- Preserve existing document ids, ordering, timestamps, branch ids, and event shapes for the seven current valid fixtures unless a test explicitly changes them.
- Add `appId` to valid seed documents if the server importer and document summary path already accept it safely. `SeedDocument.appId` is optional today, but adding it improves clarity for a shared catalog.
- Keep one clock per payload so deterministic output remains stable.

Helper cleanup to do during the refactor:

- `createBranchFromTip(doc, branchId, name, sourceBranchId)`
- `mergeBranchThroughTip(doc, actor, targetBranchId, sourceBranchId, mergeId)`
- `branchTip(doc, branchId)`
- todo helpers for replace, push/add, remove, move, and reorder operations
- whiteboard helpers for element field replacement, archival, recovery, and stroke-point updates

## Phase 3: Add Todo Edge-Case Fixtures

Add these valid fixtures to the default payload.

### `todos-conflicting-fields`

Build a same-path conflict fixture:

- base state on `main`;
- `copy-a` and `copy-b` fork from the same base event;
- both branches edit the same todo title differently;
- both branches edit different fields on the same todo;
- `main` edits that todo after the fork;
- merge both branches into `main`.

Assertions:

- branches exist with expected source branch and fork index;
- source branches contain non-root update paths;
- final materialized `main` includes a deterministic winning title and all non-conflicting surviving edits.

### `todos-array-operations`

Build an array identity/order fixture:

- start with a moderate list;
- insert at front, middle, and end;
- run repeated adjacent insertions;
- move and/or reorder items;
- edit items after visible indexes shift.

Assertions:

- output includes CRDT array item paths rather than root-only replacements after setup;
- materialized state has the expected visible order;
- generated output is deterministic under fixed `--date`.

### `todos-deletes-and-readds`

Build a deletion/tombstone and app-id reuse fixture:

- create todos with stable app ids;
- remove at least one todo;
- re-add a todo with the same app-level `id`;
- edit neighboring items after deletion;
- include a branch that edits an item deleted on `main`, then merge it.

Assertions:

- at least one emitted update is a CRDT delete/tombstone update;
- final visible state contains the re-added app id exactly once;
- materialization does not revive deleted array items unexpectedly.

### `todos-recursive-merges`

Build a recursive merge topology:

- `dependency` forks from `main` and edits a todo;
- `feature` forks from `main`;
- `feature` merges `dependency`;
- `feature` adds its own edits;
- `main` merges `feature`;
- optionally another branch also merges `dependency` directly.

Assertions:

- materializing `main` includes both dependency and feature changes;
- duplicate application is avoided when the same source has already been merged through another branch;
- merge event source indexes point at existing source tips.

### `todos-partial-repeat-merge`

Build a repeated merge fixture:

- source branch has multiple update events;
- `main` merges source through event `1`;
- source receives additional updates;
- `main` merges source through the later tip;
- include one already-covered/no-effect merge event only if current server logic accepts it as a valid event.

Assertions:

- merge impact can distinguish initial effective updates from already-merged updates;
- materialized final state includes only one application of each source update.

### `todos-wide-branch-list`

Build a branch-list scale fixture:

- base event on `main`;
- 25 to 30 branches forked from `main`;
- each branch has one small unique edit;
- merge a subset into `main`.

Use the low end of the range to stay at or below the current "no grouping yet" picker threshold.

Assertions:

- branch count is large enough to exercise picker/sync metadata scale;
- document count remains below the threshold where UI grouping is required.

## Phase 4: Add Whiteboard Edge-Case Fixtures

Add these valid fixtures to the default payload.

### `whiteboard-element-editing`

Build realistic nested tagged-union edits:

- create notes, strokes, and emoji stamps;
- move elements by replacing `position`;
- resize notes;
- edit note text and color;
- append stroke points or replace the stroke point array with more points;
- change stroke style;
- change emoji size and position;
- archive and recover at least one element, using `remove` for optional archive fields on recovery.

Assertions:

- update paths include tagged-union/record-entry paths below `elements`;
- optional field removal produces delete/tombstone coverage for whiteboard records;
- final materialized state includes expected active and archived elements.

### `whiteboard-dense-overlap`

Build visual stress data:

- many elements concentrated in a smaller coordinate range;
- some negative and large coordinates;
- overlapping z-order values generated through normal z-order helper logic where possible;
- rotations across a wider range;
- mixed archived and active elements.

Assertions:

- materialized state validates against `WhiteboardState`;
- element count and archived count match expectations.

### `whiteboard-conflicting-element-edits`

Build a same-record branch conflict fixture:

- base element on `main`;
- two branches edit the same element's position and text;
- another branch archives the same element;
- `main` edits the same element before merging branches;
- merge all branches into `main`.

Assertions:

- merge preview paths include multiple paths under the same element id;
- final materialized state is deterministic and valid.

### `whiteboard-many-events`

Build a replay-cost fixture:

- moderate element count;
- many small updates moving elements, editing text, changing z-order, archiving/recovering, and updating stroke data;
- actors rotate through the event stream;
- scale by existing `--size` values.

Suggested event counts can mirror todo event counts or use a smaller scale if whiteboard updates are too expensive:

- `small`: 100 to 200 events;
- `default`: 1000 to 2000 events;
- `large`: 2500 to 5000 events.

Assertions:

- event count scales by `--size`;
- generation remains deterministic;
- tests do not materialize the largest case unless runtime is acceptable.

## Phase 5: Add Migration Fixtures

Use existing migration fixture code in `examples/migration-fixtures/todos.ts` as the first source of truth.

Add server-seed migration documents that represent old-schema data:

- `todos-migration-v1-main`
- optionally `todos-migration-v1-branches`

Implementation approach:

- Import or adapt `todoFixtureV1Schema`, metadata, and `todoFixtureServerUpdateEventsV1()`.
- Emit a seed document with `schemaVersion: 1`, old schema fingerprint/hash, branch metadata, and old-schema CRDT events.
- Use a distinct `appId` if the server migration flow expects app identity separate from the current todos app, or document clearly why `appId` is omitted.
- Keep migration seed documents valid as old-schema documents. Do not mix migrated v2 events into the same fixture unless testing upload/import behavior explicitly.

Assertions:

- emitted migration documents use the old schema hash;
- importer accepts the seed payload;
- server migration dump or client migration test can recognize the fixture as old schema.

Open implementation check:

- Verify how the server/client chooses migration config for old fixture schemas. If old fixture schemas are not tied to a registered app, keep migration seeds as generator exports or tests first, not as default UI-openable documents.

## Phase 6: Add Malformed Negative Fixtures

Keep malformed fixtures in the generator module, but separate them from the default valid `generateSeedDatabasePayload(...)` result.

Recommended API:

```ts
export function generateMalformedSeedPayloads(options?: SeedGeneratorOptions): Record<string, SeedDatabasePayload>
```

Include small negative cases:

- missing source branch reference;
- duplicate event indexes on one branch;
- merge through a non-existent source event index;
- update with mismatched schema fingerprint hash;
- unknown actor/user reference if importer validation is expected to catch it.

Assertions:

- server importer rejects each malformed payload;
- failed import leaves the target database unchanged, matching existing transaction safety expectations.

Do not expose malformed payloads through the normal `seed:server` CLI unless there is a clear explicit flag later.

## Phase 7: Update Tests

Expand `examples/react-crdt/src/lib/seed/generate.test.ts`.

Test categories:

- expected valid document ids and seeded users;
- deterministic output with fixed `--date`;
- size scaling for todo and whiteboard event-heavy fixtures;
- fixture catalog projects to the same valid server payload shape;
- non-root CRDT paths for branch and edit-heavy fixtures;
- delete/tombstone updates are present in deletion fixtures;
- materialized final states for complex todo and whiteboard fixtures;
- recursive and repeated merge topology invariants;
- migration seed schema metadata;
- malformed payload generation, if kept in client tests.

Add or update server-side tests if malformed fixtures are imported there:

- import succeeds for comprehensive valid payload;
- import rejects malformed payloads;
- failed malformed import does not partially write users/documents/events.

## Phase 8: Verification

Run targeted checks:

```sh
npx vitest run src/lib/seed/generate.test.ts
```

from `examples/react-crdt`, or the equivalent existing workspace command.

Run server importer/store tests:

```sh
bun test ./src/store.bun.ts ./src/cli.bun.ts
```

from `examples/react-crdt-server`.

Run a seeded import smoke test:

```sh
bun run seed:test -- --date 2026-01-02 --size small --db /private/tmp/umkehr-generate-more.sqlite
```

from `examples/react-crdt-server`.

If practical, run typechecks for both example packages. If existing unrelated typecheck failures remain, record them in the implementation log and final notes.

## Completion Criteria

- `generate.ts` has an accurate file-level doccomment.
- Existing seven fixture ids remain available.
- New valid fixtures cover same-path conflicts, array operations, deletes/re-adds, recursive merges, repeated merges, wide branch lists, whiteboard nested edits, dense overlap, whiteboard conflicts, and whiteboard many-events.
- Migration seed output exists and is either part of the valid default payload or clearly exported for migration tests, depending on app registration compatibility.
- Malformed fixtures are generated separately and covered by rejection tests.
- Default valid seed output remains deterministic with fixed `--date`.
- Server seed import succeeds for the comprehensive valid payload.
- Tests cover materialization and topology invariants for the new tricky cases.
