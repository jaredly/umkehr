# Array tombstone / insert op implementation plan

## Goal

Rework array CRDT metadata so deleted array items do not retain an order value, and remove order
from CRDT path segments entirely. Array creation should be represented by a dedicated `op: 'insert'`
update. Update-level command grouping metadata should be renamed from `meta` to `command` so it is
not confused with CRDT document metadata.

## Decisions

- Add a dedicated `CrdtInsertUpdate`.
- Remove `order` from `CrdtPathSegment.type === 'arrayItem'`.
- Rename update-level `meta?: CrdtUpdateMeta` to `command?: CrdtCommandInfo`.
- Array item metadata becomes a discriminated union:

```ts
type ArrayItemMeta =
    | {kind: 'live'; order: {value: FractionalIndex; ts: HlcTimestamp}; value: CrdtMeta}
    | {kind: 'deleted'; deleted: HlcTimestamp};
```

- Delete-before-insert for an array item may remain pending until the insert arrives.
- Canonical metadata convergence is only required once causal parents are delivered.
- `set` does not create missing array items anymore.
- `insert` owns array item creation, initial order, and initial value.
- `setOrder` behavior:
  - unknown id: pending;
  - live id: apply LWW to `item.order`;
  - deleted id: handled without storing order on the tombstone. Prefer idempotent no-op `applied`
    for deleted ids so pending queues drain while metadata stays order-free.
- If an array item id is reused, LWW applies.
- No compatibility migration is needed for persisted current-format CRDT documents.

## Phase 1: Update public/internal CRDT types

Files:

- `src/crdt/types.ts`
- `src/crdt/index.ts` if exports need adjustment
- `.tasks/037-array-tomb/research.md` if the final type names drift during implementation

Steps:

- Rename `CrdtUpdateMeta` to `CrdtCommandInfo`.
- Rename every CRDT update variant field from `meta?: CrdtUpdateMeta` to
  `command?: CrdtCommandInfo`.
- Add:

```ts
export type CrdtInsertUpdate = {
    op: 'insert';
    arrayPath: CrdtPathSegment[];
    id: ItemId;
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: JsonValue;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};
```

- Include `CrdtInsertUpdate` in `CrdtUpdate`.
- Remove optional `order` from `CrdtPathSegment` array item segments.
- Change `ArrayItemMeta` to the live/deleted union above.
- Check any type tests or generated declaration expectations after compilation.

## Phase 2: Generate `insert` updates

Files:

- `src/crdt/updates.ts`
- `src/crdt/path.ts`

Steps:

- Remove `includeLeafArrayOrder` from `crdtPathForExisting`.
- For array `add`, return an `op: 'insert'` update instead of a `set` update whose leaf path segment
  contains `order`.
- For non-array `add`, keep emitting `set`.
- For `remove`, call plain `crdtPathForExisting(doc, patch.path)`.
- Keep `reorder` and `move` emitting `setOrder`.
- Ensure `arrayAddTarget` still computes:
  - parent CRDT array path;
  - item id;
  - parent creation timestamp;
  - fractional order between live neighbors.
- Since `arrayPath` points to the array, not the item, update any helper names or returned shape if
  it makes the code clearer.

## Phase 3: Apply semantics

Files:

- `src/crdt/apply.ts`
- `src/crdt/schema.ts` if a helper is needed to get an array item schema from `arrayPath`

Steps:

- Route `op: 'insert'` before the set/delete path walker.
- Implement `applyInsert`:
  - resolve `update.arrayPath` with `getMetaAtPath`;
  - pending if the array parent is missing or future-incarnation;
  - discard if the resolved target is a tombstone or non-array;
  - build item value metadata using the array item schema;
  - if id is absent, create `{kind: 'live', order: update.order, value}`;
  - if id exists and is deleted/live, apply LWW using `update.ts` vs deleted timestamp or value
    version;
  - on winning insert, replace with a live item containing the insert order and built value.
- Make array delete explicit:
  - when deleting an array item and the item id is missing, return `pending`;
  - when deleting a live item, compare `update.ts` against `versionOf(item.value)`;
  - write `{kind: 'deleted', deleted: update.ts}` on winning delete;
  - when deleting an already-deleted item, apply LWW/idempotence using `deleted`.
- Ensure generic `setChild` no longer creates missing array items.
- For `set` targeting a missing array item, return `pending`.
- For child `set` under a deleted array item, keep discarding via traversal.
- Update `applySetOrder` for the item union:
  - if any id is absent, return `pending`;
  - live items receive LWW order updates;
  - deleted items do not store order and should be treated as handled;
  - return `applied` if any live order changed or if all referenced ids are present and deleted
    no-ops were processed; return `discarded` only when every referenced live order was older/equal
    and there were no deleted no-ops.
- Update `pendingReason` / `updateTimestamp` for `insert`.
  - `insert` timestamp is `update.ts`.
  - missing array parent should report `missing-parent` or `future-incarnation` consistently with
    existing path behavior.

## Phase 4: Metadata helpers and materialization

Files:

- `src/crdt/metadata.ts`
- `src/crdt/path.ts`
- `src/crdt/materialize.ts`
- `src/crdt/proofTestHelpers.ts` if canonicalization assumes old item shape

Steps:

- Update `buildMeta` for arrays to create live item records:

```ts
items[id] = {
    kind: 'live',
    order: {value: order, ts},
    value: buildMeta(item, itemSchema, ctx, ts),
};
```

- Update `liveArrayItems` to filter `item.kind === 'live'`.
- Update sorting to read `item.order`.
- Update `lastArrayOrder` to use live items.
- Update `getChild`:
  - array live item returns `item.value`;
  - array deleted item returns its tombstone-like deletion state or `undefined` depending on what
    traversal needs. Prefer explicit array delete handling in `apply.ts`; for normal path walking,
    deleted items should behave like tombstones/discard.
- Update `normalPathForCrdtPath` so deleted array items do not map to normal paths after delete.
- Update `materialize` to filter live items and materialize `item.value`.
- Update `versionOf` only if deleted array item metadata is represented as `ArrayItemMeta` and not
  `CrdtMeta`. Avoid forcing array item tombstones into `CrdtMeta` if the whole point is separating
  item lifecycle from value metadata.

## Phase 5: Validation

Files:

- `src/crdt/validation.ts`
- `src/crdt/validation.test.ts`

Steps:

- Add `'insert'` to allowed ops.
- Validate `command` instead of `meta`.
  - Rename `validateMeta` to `validateCommandInfo` or similar.
  - Error paths should use `command/...`.
  - Error messages should say "CRDT update command info" or similar, not generic metadata.
- Validate `insert` envelope:
  - `arrayPath` is a CRDT path array;
  - `id` is a non-empty string;
  - `order.value` is a non-empty string;
  - `order.ts` is a valid timestamp;
  - `value` is present;
  - `ts` is a valid timestamp.
- Validate `insert.arrayPath` walks to an array schema.
- Validate `insert.value` against the array item schema.
- Remove validation support for `arrayItem.order`.
- Keep `set.path` validation as address-only.
- Update validation tests:
  - accepts insert into array with valid item value;
  - rejects insert whose `arrayPath` points to non-array;
  - rejects invalid insert order/id/value;
  - rejects `arrayItem` path segments containing `order`;
  - accepts `command` and rejects old/malformed command info paths;
  - update old `meta` tests to `command`.

## Phase 6: Local history / undo-redo command field rename

Files:

- `src/crdt/history.ts`
- `src/crdt/history.test.ts`
- Any docs that mention update command metadata

Steps:

- Rename import/type use from `CrdtUpdateMeta` to `CrdtCommandInfo`.
- Rename field access `update.meta` to `update.command`.
- Rename `withCommandMetadata` to `withCommandInfo` or `withCommand`.
- Stamp generated edit/undo/redo updates with `command: {...}`.
- Update tests to assert `updates[0].command`.
- Update command grouping logic to remain otherwise unchanged.
- Update `updateActors` for `insert`:
  - non-`setOrder` updates still use `update.ts`;
  - `setOrder` uses order timestamps.
- Extend local effects if undo/redo needs to support insert as a first-class effect:
  - capture insert as an add effect, or map it into the existing set/delete effect model carefully;
  - undoing an insert should generate a delete for the inserted array item;
  - redoing an insert should generate a fresh insert or set depending on current semantics. Prefer
    fresh `insert` with a new timestamp/id only if redo is intended to create a new logical array
    item; otherwise preserve the original item id and use LWW rules. This needs careful test
    coverage.

## Phase 7: Update server/example protocol guards

Files to inspect:

- `examples/react-crdt/src/lib/peerjs/protocol.ts`
- `examples/react-crdt/src/lib/local-first/protocol.ts`
- `examples/react-crdt/src/lib/server/materialize.ts`
- `examples/react-crdt/src/lib/server/migration.ts`
- `examples/react-crdt/src/lib/server/useServerSync.ts`
- `examples/react-crdt-server/src/protocol.ts`
- `examples/react-crdt-server/src/store.ts`

Steps:

- Search for update envelope parsing that expects `meta`.
- Rename wire field to `command`.
- Add `insert` to any update op validators or serializers.
- Update materialization/export code that reconstructs CRDT updates from metadata so inserted array
  items, if emitted, use `insert` rather than path order.
- Confirm server storage treats CRDT updates opaquely enough that no schema changes are needed.

## Phase 8: Proof/reference model and CRDT tests

Files:

- `src/crdt/crdt.test.ts`
- `src/crdt/proof.test.ts`
- `src/crdt/proofTestHelpers.ts`
- `src/crdt/proof.md` if behavior claims need clarification

Steps:

- Update expected generated updates:
  - array add now expects `op: 'insert'`;
  - delete paths have no order;
  - array item path segments never include order.
- Add targeted tests:
  - array insert materializes in correct fractional position;
  - delete after insert leaves an order-free deleted item;
  - delete before insert stays pending, then settles when insert arrives;
  - child edit before insert stays pending, then applies if insert arrives before delete;
  - child edit after delete is discarded;
  - setOrder before insert stays pending, then applies after insert;
  - setOrder after delete does not add order back to deleted metadata;
  - duplicate insert is idempotent;
  - id reuse resolves by LWW.
- Update bounded array permutation proof from insert/edit/order/delete.
- Update reference model:
  - add `insert`;
  - use live/deleted array item union;
  - remove path order handling;
  - mirror `setOrder` deleted-item no-op behavior.
- Ensure canonical metadata checks assert deleted array item records do not contain order.

## Phase 9: Documentation cleanup

Files:

- `Readme.md`
- `CONTRIBUTING.md`
- `src/crdt/proof.md`
- `.tasks/proof/implementation-log.md` only if adding a note is useful
- `.tasks/037-array-tomb/research.md`

Steps:

- Update CRDT path description: paths include stable array item ids, but not array order.
- Update update-op documentation to include `insert`.
- Replace "command metadata" examples from `meta` to `command`.
- Mention that array tombstones do not store order.
- Mention that array item deletes can remain pending until the item insert is delivered.

## Phase 10: Verification

Run focused checks first:

```sh
npm test -- src/crdt/validation.test.ts
npm test -- src/crdt/crdt.test.ts
npm test -- src/crdt/history.test.ts
npm test -- src/crdt/proof.test.ts
```

Then broader checks:

```sh
npm test -- src/crdt
npm test -- src/migration/migration.test.ts
npm test
npm run typecheck
```

If example protocol code changes:

```sh
npm test -- examples/react-crdt/src/lib
```

Use the actual package scripts if these direct Vitest targets need adjustment.

## Risks

- Undo/redo for array inserts is the highest-risk area because insert identity has user-visible
  consequences. Tests must define whether redo recreates the same CRDT item or creates a new item.
- `setOrder` deleted-item no-op behavior must be mirrored exactly in the reference model or metadata
  convergence tests will be noisy.
- Wire compatibility changes from `meta` to `command` and from array add `set` to `insert`; peers
  running old code will not understand the new shape.
- Any code that assumes `ArrayItemMeta.value` always exists will fail after the union change.
- Migration helpers that synthesize CRDT updates from metadata may need special handling for arrays.
