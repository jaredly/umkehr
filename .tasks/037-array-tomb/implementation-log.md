# Array tombstone implementation log

## 2026-05-28

- Added a dedicated CRDT `insert` update for array item creation.
  - Array `add` patches now emit `op: 'insert'` with `arrayPath`, stable item `id`, initial
    fractional `order`, item `value`, and `ts`.
  - `set` remains the update for existing logical values and no longer creates missing array items.
- Removed array order from CRDT path segments.
  - `CrdtPathSegment.type === 'arrayItem'` now carries only item id and parent incarnation.
  - Removed `crdtPathForExisting(..., {includeLeafArrayOrder: true})`.
  - Array item deletes now use ordinary CRDT paths without order.
- Reworked array item metadata so tombstones do not track order.
  - `ArrayItemMeta` is now a live/deleted union.
  - Live items carry `{order, value}`.
  - Deleted items carry only `{deleted}`.
  - Materialization and path mapping filter on live array items.
- Updated apply semantics.
  - `insert` creates or LWW-replaces array item records.
  - Delete of an unknown array item remains pending until the insert arrives.
  - Delete of a live array item writes an order-free deleted record.
  - `setOrder` for unknown ids remains pending; live ids apply LWW order updates; deleted ids are
    handled without writing order back onto tombstones.
- Renamed update-level command grouping metadata.
  - `meta?: CrdtUpdateMeta` became `command?: CrdtCommandInfo`.
  - This avoids confusion with `doc.meta` / `CrdtMeta`.
  - Local CRDT history now reads and writes `update.command` for edit/undo/redo grouping.
- Updated validation.
  - `insert` is accepted and schema-validated against the array item schema.
  - `command` is validated instead of `meta`.
  - `arrayItem.order` path segments are rejected.
- Updated CRDT proof/reference coverage.
  - The independent proof reference model now supports `insert` and live/deleted array item
    metadata.
  - The proof suite continues to cover reordered/duplicated delivery, pending behavior, arrays,
    records, tagged unions, and differential reference-model agreement.
- Updated migration helpers for the new update shape.
  - General migration helpers now handle `insert.arrayPath`.
  - Todo migration fixtures now migrate `insert` updates and no longer assume every non-`setOrder`
    update has `path`.

Verification:

- `npm run typecheck`
- `npm test -- src/crdt/validation.test.ts src/crdt/crdt.test.ts src/crdt/history.test.ts`
- `npm test -- src/crdt/proof.test.ts`
- `npm test -- src/migration/migration.test.ts`
- `npm test -- src/crdt`
- `npm test -- examples/react-crdt/src/apps/todos/migrationFixture.test.ts`
- `npm test -- examples/react-crdt/src/lib/seed/generate.test.ts`
- `npm test`

Full-suite result: 37 test files passed, 327 tests passed.
