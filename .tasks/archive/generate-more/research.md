# Generate More Seed Coverage Research

## Request

`examples/react-crdt/src/lib/seed/generate.ts` currently generates server seed database payloads for the React CRDT example. The requested follow-up has two parts:

- add a file-level doccomment describing what the generator currently covers;
- add more seed generators so manual and automated testing can exercise more edge cases.

The path in the task, `react-crdt/src/lib/seed/generate.ts`, appears to refer to the example package path `examples/react-crdt/src/lib/seed/generate.ts`.

## Current Generator Shape

The seed generator exports `generateSeedDatabasePayload({date, size})` and can also run as a CLI module that writes one JSON payload to stdout. The payload is shaped for the Bun server importer:

- `generatedAt`
- deterministic seeded `users`
- `documents`, each with metadata, schema metadata, server branches, and server branch events

The implementation is not just hand-writing server rows. It creates app documents with the real todo and whiteboard JSON schemas, applies fixture edits through `applyLocalCommand`, and records the generated CRDT updates as server update events. This is a good foundation because most new scenarios can be added as higher-level app edits while still producing realistic CRDT paths, HLC timestamps, undo-compatible histories, and materializable server branches.

Fixed `--date` makes generated timestamps deterministic. `--size small|default|large` scales the stress fixtures:

- todo item count: `100`, `1000`, `2500`
- todo event count: `200`, `2000`, `5000`
- whiteboard element count: `60`, `400`, `1000`

## Current Coverage

The generator currently emits four seeded users:

- `seed-user-ada`
- `seed-user-ben`
- `seed-user-cy`
- `seed-user-dee`

It emits seven documents.

### `todos-small`

Small baseline todo state with four todos and two events:

- root replacement from initial state to a curated todo list;
- one later `done` toggle by another actor.

This is useful for basic document selection, sync bootstrap, seeded user attribution, and a small readable manual smoke test.

### `todos-many-items`

Large todo-list rendering fixture:

- one root replacement event;
- many todo items;
- mixed `done` values.

This primarily stresses rendering and storage size, not event replay or branch logic.

### `todos-many-events`

Long event-log fixture:

- initial root replacement to 12 target todos;
- many subsequent field-level changes across four actors;
- alternating todo title edits, todo completion toggles, and occasional background color edits.

This stresses event replay, event list size, HLC ordering, multi-actor histories, and IndexedDB/SQLite storage volume.

### `todos-branches`

Branch fan-out fixture:

- base todos on `main`;
- two branches forked from `main` at event index `1`;
- one branch adds a todo;
- one branch changes background color;
- `main` independently toggles a todo.

This covers basic branch metadata, fork indexes, and divergent unmerged branches.

### `todos-merge-review`

Merge-review fixture:

- base todos on `main`;
- `design` and `qa` branches fork from `main`;
- `design` changes background color;
- `qa` adds two todos;
- `main` independently toggles a todo;
- `main` records merge events from both branches.

This covers merge events, materialization through merged source branches, and simple merge-preview path lists.

### `whiteboard-many-elements`

Large whiteboard rendering fixture:

- one root replacement event;
- many generated note elements with deterministic positions, colors, rotations, z-order values, and metadata.

This stresses rendering and state size for a record-heavy tagged-union app, but not replay of many element-level operations.

### `whiteboard-branches`

Whiteboard branch/merge fixture:

- base `main` state with a note and a stroke;
- `layout` and `annotations` branches fork from `main`;
- branch-local element additions use field-level record-entry paths;
- `main` independently changes background;
- `main` records merge events from both branches.

This covers branch materialization for tagged unions and record fields. Existing tests assert that branch fixture edits are not root-level replacement paths and that merged branch additions materialize into `main`.

## What Is Not Covered Yet

The current set is useful but still narrow. Important gaps:

- deletes/removals/tombstones;
- array insertion at middle or front, array reordering, and repeated adjacent insertions;
- conflicting concurrent edits to the same field/path;
- branch merges where target and source both changed the same path;
- partial merges, repeated merges from the same source, and recursive merges;
- branch creation from non-main branches;
- branch creation from non-tip fork indexes beyond the simple initial fork;
- undo/redo-generated updates, if those are represented in CRDT update metadata;
- local-first retained batch, vector, compaction, and stale replica states;
- server-client offline/pending-upload states;
- migration and schema-mismatch seed states;
- whiteboard element edits after creation, archival, optional fields, and tagged-union variants beyond static initial element creation;
- malformed/corrupt negative fixtures, if seed generation is intended to support validation tests.

The generator also does not expose its internal branch histories as a reusable fixture catalog. It returns only server-shaped payloads, so other architectures need to reconstruct or materialize histories from server branches/events.

## Suggested File-Level Doccomment

A doccomment at the top of `generate.ts` should describe current behavior without overpromising future coverage. Suggested draft:

```ts
/**
 * Deterministic seed database fixture generator for the React CRDT example.
 *
 * The generator emits server-shaped seed payloads containing seeded users,
 * document metadata, schema fingerprints, branch records, and branch events.
 * Fixture edits are applied through the real app schemas and CRDT command
 * pipeline, then serialized as server update or merge events, so generated
 * documents exercise normal materialization and sync paths rather than
 * hand-written storage rows.
 *
 * Current fixtures cover:
 *
 * - small readable todo baseline data;
 * - large todo documents with many items;
 * - long todo event logs with multi-actor field edits;
 * - todo branch fan-out and simple merge-review flows;
 * - large whiteboard documents with many record/tagged-union elements;
 * - whiteboard branch additions and merge materialization.
 *
 * `--date` anchors generated timestamps for stable output. `--size` scales
 * the item/event/element stress fixtures while preserving deterministic ids,
 * actors, branch names, and schema metadata.
 *
 * The fixtures are intended for development, manual QA, and regression tests.
 * They are valid representative states, not exhaustive coverage of every CRDT
 * edge case; destructive edits, conflict-heavy merges, migrations, stale
 * replicas, and malformed payloads should be added as explicit scenarios.
 */
```

## Recommended New Generators

Add fixtures in two layers:

1. broaden valid server seed documents in the existing generator;
2. later expose a shared fixture catalog so local, PeerJS, local-first, and E2E adapters can project the same scenario data into their own persistence shapes.

### High-Priority Server Fixtures

#### `todos-conflicting-fields`

Purpose: same-path and nearby-path conflict behavior.

Suggested shape:

- base todos on `main`;
- branch `copy-a` and branch `copy-b` fork from the same event;
- both branches edit the same todo title differently;
- both branches also edit different fields on the same todo;
- `main` edits the same todo after the fork;
- merge both branches into `main`.

Why it matters: merge preview, CRDT last-writer behavior, path labeling, and conflict inspection need same-path cases. Current branch fixtures only have non-overlapping changes.

#### `todos-array-operations`

Purpose: array item identity and order behavior.

Suggested shape:

- start with a moderate todo list;
- insert at front, middle, and end;
- delete or remove an item if supported by the command/update layer;
- edit an item after insertions shift visible indexes;
- run many adjacent insertions between the same neighbors;
- optionally branch and merge array edits from different branches.

Why it matters: todo updates currently locate items by current index and mostly push at the end. This does not stress stable CRDT array item ids, fractional ordering, index shifts, or tombstones.

Open implementation detail: confirm the preferred high-level patch op for removals in Umkehr draft patches. If removal is not currently supported, this fixture should still cover front/middle insertion and index-shifted edits.

#### `todos-deletes-and-readds`

Purpose: tombstones, id reuse, and stale references.

Suggested shape:

- create todos with stable app ids;
- remove some items;
- re-add a todo with the same app-level `id` but a new CRDT array identity;
- edit deleted-neighbor items after deletion;
- branch before deletion and merge source edits after target deletion.

Why it matters: app-level ids and CRDT array item ids are different. Seed data should make it obvious when code accidentally keys by the wrong identity.

Open implementation detail: this depends on remove/delete support in draft patches.

#### `todos-recursive-merges`

Purpose: merge materialization beyond one-hop source branches.

Suggested shape:

- `dependency` forks from `main` and edits a todo;
- `feature` forks from `main`, merges `dependency`, and adds its own edits;
- `main` merges `feature`;
- a second branch merges `dependency` directly before or after `main` receives it.

Why it matters: `materializeServerBranch` and merge-impact code already have tests for recursive merges, but there is no manual seed document that exercises the UI and server sync path with this topology.

#### `todos-partial-repeat-merge`

Purpose: repeated merge bookkeeping.

Suggested shape:

- source branch has several update events;
- target merges source through event `1`;
- source gets more updates;
- target merges source through the later tip;
- target attempts or records another merge through an already-merged index.

Why it matters: merge impact distinguishes effective, already-merged, and no-effect updates. A fixture should make those states visible.

#### `todos-wide-branch-list`

Purpose: branch picker and branch metadata scale.

Suggested shape:

- one base event;
- 25 to 100 branches forked from `main`;
- each branch has one small unique edit;
- a subset are merged into `main`.

Why it matters: current branch fixtures have only three branches. UI layout, branch sorting, sync payload size, and branch discovery should be exercised with a wider branch set.

### High-Priority Whiteboard Fixtures

#### `whiteboard-element-editing`

Purpose: realistic edit paths on tagged-union record entries.

Suggested shape:

- create notes, strokes, and emoji stamps;
- move and resize notes;
- edit note text/color;
- append stroke points and change stroke style;
- change emoji size/position;
- archive elements by setting `archived`, `archivedBy`, and `archivedAt`.

Why it matters: current whiteboard stress data is mostly static creation. The UI and CRDT path model need nested tagged-union field edits and optional fields.

#### `whiteboard-dense-overlap`

Purpose: visual stress and z-order edge cases.

Suggested shape:

- many elements in a small area;
- repeated z-order changes;
- negative/large coordinates;
- rotations across a wider range;
- mixed archived and active elements.

Why it matters: current generated positions form a neat grid. Real whiteboards often have overlap, offscreen content, and stacking problems.

#### `whiteboard-conflicting-element-edits`

Purpose: merge conflicts within a record entry.

Suggested shape:

- two branches edit the same element's position and text;
- another branch archives the element;
- `main` edits the same element before merging branches.

Why it matters: this gives branch merge review a tagged-union same-object conflict case, which is not covered by adding different elements on different branches.

#### `whiteboard-many-events`

Purpose: replay cost for whiteboard operations.

Suggested shape:

- moderate element count;
- thousands of small updates moving elements, editing text, adding stroke points, and archiving/unarchiving;
- actors rotate through the update stream.

Why it matters: `whiteboard-many-elements` stresses state size but not event replay. Whiteboard sync can be expensive when many small updates hit nested paths.

### Local-First and Server-Client Fixture Projections

Some requested "seed database" edge cases are not just additional server documents. They require browser persistence states.

#### `local-first-retained-log`

Create a local-first replica with retained batches corresponding to many update events. Preserve multi-actor vectors so replay, export/import, and sync reconciliation can be tested.

#### `local-first-compacted`

Create a replica with a compacted history plus retained batches after a compaction frontier. Pair it with a stale peer vector to test snapshot and replay behavior.

#### `local-first-behind-ahead-pair`

Create two deterministic replicas for the same doc:

- one behind the retained log;
- one ahead with local-only batches.

This would make "database behind the client" and "database ahead of the client" roadmap items concrete.

#### `server-client-pending-offline`

Seed server client IndexedDB with a document that has pending local events not yet acknowledged by the server, plus a server database that is either behind or ahead. This is best as an E2E helper, not a normal server seed JSON fixture.

### Migration and Negative Fixtures

#### `todos-old-schema-v1` / `whiteboard-old-schema-vN`

Generate old-schema documents, retained local histories, or server dumps for migration testing. These should probably live beside migration fixtures rather than in the default seed database output unless the current app can intentionally open them through migration UI.

#### malformed payload fixtures

Examples:

- branch references missing source branch;
- duplicate event indexes;
- merge through a non-existent source event index;
- update with mismatched schema hash;
- unknown actor/user references.

These should not be part of the default seed database because the importer should reject them. Keep them as test-only fixtures for validation and negative-path tests.

## Implementation Notes

### Add Helpers Before Adding Many Fixtures

The file is already long enough that new scenarios will benefit from a few helper additions:

- `replaceTodoAt`, `insertTodoAt`, `removeTodoAt` if draft patches support them;
- `moveWhiteboardElement`, `resizeNote`, `editNoteText`, `archiveElement`, `appendStrokePoint`;
- `createBranchFromTip` and `createBranchFrom` wrappers that avoid hard-coded fork indexes;
- `mergeBranchThroughTip` wrapper that derives the source tip;
- a branch event count helper for accurate `sizeLabel` strings.

### Prefer Real Command Paths

Continue using `applyLocalCommand` for valid fixtures. Earlier QA notes called out root-level replacement events as less useful for merge review. New fixtures should use the same field-level paths that UI operations would produce.

### Avoid Overloading Default Output

Adding every fixture to default server seed output could make the document picker noisy and slow. Consider one of these:

- always include a curated core set and gate exhaustive fixtures behind `--profile comprehensive`;
- keep `--size` for scale and add `--scenario` or `--include` filters;
- group fixtures by `sizeRank` and title prefixes so the picker remains readable.

For the immediate task, a reasonable first implementation is to add several high-value valid fixtures to the existing output, then add filtering only if generation/import time or picker noise becomes a problem.

### Consider a Shared Fixture Catalog Refactor

`BranchBuilder` already stores branch histories while generating server events. A future refactor should expose a client-owned fixture catalog before converting to `SeedDatabasePayload`.

This would let the same scenario produce:

- server seed JSON;
- solo final state;
- local and PeerJS initial CRDT histories;
- local-first persisted replicas and batches;
- E2E IndexedDB setup data.

This is not required to add more server generators, but it will prevent the server JSON format from becoming the long-term internal source of truth.

## Suggested First Batch

For a compact but meaningful implementation pass:

1. Add the file-level doccomment above.
2. Add `todos-conflicting-fields`.
3. Add `todos-recursive-merges`.
4. Add `todos-partial-repeat-merge`.
5. Add `whiteboard-element-editing`.
6. Add `whiteboard-conflicting-element-edits`.
7. Add tests for deterministic ids, expected document ids, materialized final states, non-root edit paths, and merge topology.

This covers the biggest behavioral gaps without requiring remove/delete support or browser IndexedDB seed projections.

## Open Questions

- Should the next implementation add only server seed documents, or should it also start the shared fixture catalog refactor?
  -> yeah let's refactor
- Should comprehensive edge-case fixtures always appear in `seed:test`, or should there be `--profile basic|comprehensive` or `--include` filtering?
  -> let's have it always do the full work
- What draft patch operation should seed generators use for array removal/deletion, and should delete/tombstone coverage wait until that API is confirmed?
  -> yeah delete/tombstone would be great
- Should fixtures intentionally reuse app-level todo ids after deletion to expose app-id vs CRDT-array-id mistakes?
  -> yeah that could be good
- How noisy can the server document picker become before grouping/filtering is needed?
  -> more than 30 would require some grouping
- Should local-first seed databases be generated from the same fixture catalog in this task, or handled by the broader "seed everything" work?
  -> let's leave it to the "seed everything" work
- Should negative/corrupt seed payloads live in this generator, in server importer tests, or in a separate validation fixture module?
  -> in this generator
- Should migration seeds be included in the normal seed database output, or kept separate so current-schema manual testing stays clean?
  -> I'd love migration seeds here
