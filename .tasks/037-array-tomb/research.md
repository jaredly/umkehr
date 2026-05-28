# Array item tombstones without order

## Problem

Array item tombstones currently keep living inside `ArrayMeta.items`, whose values are
`ArrayItemMeta` objects:

```ts
type ArrayItemMeta = {
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: CrdtMeta;
};
```

That means a deleted array item is represented as an item wrapper with an `order` plus
`value.kind === 'tombstone'`. Conceptually this is odd: deleted items should remember deletion
identity and timestamp, not participate in ordering. It also leaked into path translation:
`crdtPathForExisting(..., {includeLeafArrayOrder: true})` exists only so delete updates for array
items can carry the leaf item's order.

The current behavior came from `.tasks/proof/implementation-log.md` Phase 4. The bounded array
proof found a metadata convergence bug when a delete for a newly inserted array item arrived
before that item's insert/order updates. The receiver synthesized a tombstoned array item with a
fallback order, so its canonical metadata differed from a receiver that saw the insert before the
delete. The fix was to put the authored order on the delete path and let `setChild` use that order
when it synthesizes the missing array item shell.

## Current data flow

- `src/crdt/types.ts`
  - `ArrayMeta.items` maps item id to `{order, value}`.
  - `CrdtPathSegment.type === 'arrayItem'` optionally carries `order`.
- `src/crdt/path.ts`
  - `crdtPathForExisting` normally emits array item id and parent incarnation.
  - With `includeLeafArrayOrder`, it also copies the leaf item order into the path segment.
  - `liveArrayItems` filters out `item.value.kind === 'tombstone'` and sorts by
    `(item.order.value, itemId)`.
- `src/crdt/updates.ts`
  - `remove` calls `crdtPathForExisting(..., {includeLeafArrayOrder: true})`.
  - `add` already carries order for the new item path.
  - `setOrder` carries order values separately in `orders`.
- `src/crdt/apply.ts`
  - `setChild` creates a missing `ArrayItemMeta` shell for array item paths.
  - If the path has `segment.order`, that order is used.
  - Otherwise it falls back to a generated order after `lastArrayOrder(parent)`.
  - Non-delete `set` updates for missing array items without `segment.order` are kept pending.

The smell is therefore real: array order is not needed to identify or delete an item, but it is
being used as a metadata-convergence crutch for early-arriving deletes.

## Invariants to preserve

- Materialized state convergence under duplicate and reordered delivery.
- Canonical metadata convergence in the proof helpers.
- Delayed child edits for a deleted array item should not recreate the item.
- `setOrder` for an unknown item currently remains pending until item creation arrives.
- A delete for an item whose insert never arrives must not materialize the item.
- Paths should still guard parent incarnation via `parentCreated`.
- Existing validation should still reject malformed paths and schema-impossible paths.

## Option A: Keep item slots, make unknown array deletes pending

Remove `order` from delete paths and from array tombstone state. For an array item delete, if the
item id is unknown, keep the delete pending instead of synthesizing a tombstone shell. Once the
insert arrives, retry applies the delete to the real item and preserves the insert-authored order
until the item is tombstoned.

Shape:

```ts
type ArrayItemMeta = {
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: Exclude<CrdtMeta, TombstoneMeta>;
    deleted?: HlcTimestamp;
};
```

or, with a discriminated union:

```ts
type ArrayItemMeta =
    | {kind: 'live'; order: OrderMeta; value: CrdtMeta}
    | {kind: 'deleted'; deleted: HlcTimestamp};
```

How apply would work:

- `remove` emits a normal array item path with no order.
- `applyOne(delete)` on an array item:
  - if item exists, compare against the item value version and mark it deleted;
  - if item is absent, return `pending`;
  - if item is already deleted, use LWW/idempotence behavior and discard or update as appropriate.
- `set` on an absent array item remains pending unless it is an authored insert with order.
- `setOrder` on a deleted item either discards or applies only if the item still has an order-bearing
  live record; this needs an explicit policy.

Pros:

- Minimal conceptual change.
- Removes `includeLeafArrayOrder`.
- Delete updates no longer carry order.
- Tombstoned array items no longer need order.
- Existing pending machinery already handles out-of-order insert-before-edit cases.

Cons:

- If a delete arrives but the insert never arrives, the receiver keeps a pending update forever
  instead of storing a compact tombstone.
- The current proof claim allows permanently missing causal parents to leave non-ready pending
  updates, so this is probably acceptable, but it is a behavior change.
- Canonical metadata convergence only happens once all causal parents are eventually delivered.

This is the smallest implementation I would seriously consider if the system is comfortable
treating item deletes as causally dependent on item creation.

## Option B: Split array item identity from value/order

Represent arrays as item records with separate registers for creation, deletion, order, and value.
The tombstone is no longer the item value; it is a deletion register on the item id. Order belongs
only to the live ordering register.

Shape:

```ts
type ArrayMeta = {
    kind: 'array';
    created: HlcTimestamp;
    items: Record<ItemId, ArrayItemRecord>;
};

type ArrayItemRecord = {
    created?: HlcTimestamp;
    order?: {value: FractionalIndex; ts: HlcTimestamp};
    value?: CrdtMeta;
    deleted?: HlcTimestamp;
};
```

Materialization filters records where `deleted` wins over the item/value version, then sorts only
records with a live `order` and `value`.

How apply would work:

- An insert creates or fills `{created, order, value}`.
- A delete for an unknown item creates `{deleted}` only. No order is stored.
- A later insert fills `order` and `value`; materialization still filters it out if `deleted` wins.
- A later older insert can be retained in metadata while remaining non-materialized.
- `setOrder` can create or update only the order register, or it can stay pending until item creation.
  This is a policy choice.

Pros:

- Most principled model: item identity is independent from item value and item order.
- Unknown deletes can be represented immediately without storing order.
- Less pending buildup for delete-before-insert schedules.
- Future garbage collection has a cleaner target: delete the whole item record once causally stable.

Cons:

- Larger rewrite: `ArrayItemMeta` shape changes, plus all array helpers, materialization, validation
  assumptions, proof reference model, and tests.
- Need to define LWW comparisons between `deleted`, `created`, `value`, and `order`.
- Allows partial item records, so many helpers need to handle missing `value` or missing `order`.
- Canonical metadata may contain order for deleted items if a `setOrder` arrives after delete unless
  apply explicitly discards or clears order for deleted records.

This is the cleanest architecture if arrays are expected to grow more CRDT behavior over time, but
it is more invasive than the current issue strictly requires.

## Option C: Store array tombstones outside `items`

Keep `ArrayMeta.items` live/order-bearing only, and add a separate tombstone map:

```ts
type ArrayMeta = {
    kind: 'array';
    created: HlcTimestamp;
    items: Record<ItemId, ArrayItemMeta>;
    tombstones: Record<ItemId, {deleted: HlcTimestamp}>;
};

type ArrayItemMeta = {
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: CrdtMeta;
};
```

How apply would work:

- Delete removes or ignores the live item record and writes `tombstones[id]`.
- Unknown delete writes only `tombstones[id]`.
- Insert for a tombstoned id can either:
  - remain stored in `items` but hidden by `tombstones[id]`, or
  - be discarded if the tombstone is newer than the inserted item version.

Pros:

- `items` remains simple: every item has order and value.
- Tombstones are explicitly order-free.
- Unknown deletes can apply immediately.
- `liveArrayItems` becomes simpler conceptually: ignore ids with winning tombstones.

Cons:

- Deletes now mutate two structures.
- Rehydrating older inserts after newer tombstones needs careful LWW rules.
- If an older delete and newer insert share an id, the code needs a clear policy, even if honest
  replicas should not intentionally reuse item ids.
- Schema migration or backward compatibility for existing metadata would be required if persisted
  documents exist.

This is a good middle ground if we want immediate tombstone recording but do not want the fully
partial item-record model from Option B.

## Option D: Keep current shape but exclude order from canonical comparison

Leave runtime metadata unchanged, remove the proof failure by teaching canonical metadata
comparison to ignore `order` for tombstoned array items.

Pros:

- Smallest mechanical change.
- Avoids pending behavior changes.

Cons:

- Does not solve the design smell.
- Tombstones still store order.
- `includeLeafArrayOrder` probably remains necessary.
- Hides divergent internal metadata instead of fixing the representation.

I would not recommend this unless the goal is only to make the proof less strict. It does not meet
the task's intent.

## Recommendation

I would choose Option A first unless there is a product or replication requirement that deletes for
never-seen array inserts must be remembered as tombstones rather than pending updates.

The implementation is relatively contained:

- Change array delete translation to use plain `crdtPathForExisting(doc, path)`.
- Remove `includeLeafArrayOrder` from `crdtPathForExisting`.
- Change `ArrayItemMeta` so deleted items do not require `order`.
- Adjust `liveArrayItems`, `materialize`, `lastArrayOrder`, `getChild`, and `setChild`.
- Make delete of a missing array item return `pending` instead of synthesizing an ordered tombstone.
- Update validation to remove optional `arrayItem.order` except for `set` inserts, or better split
  insert order out of the path segment.
- Update proof reference model and the Phase 4 array permutation tests to expect delete-before-insert
  to settle once the insert is delivered.

One refinement worth considering with Option A: introduce a dedicated insert operation shape instead
of overloading `arrayItem.order` on path segments:

```ts
type CrdtSetUpdate = {
    op: 'set';
    path: CrdtPathSegment[];
    value: JsonValue;
    ts: HlcTimestamp;
    insert?: {parentPath: CrdtPathSegment[]; id: ItemId; order: OrderMeta};
};
```

That is a larger wire-format change, but it would remove order from paths entirely, not just from
delete paths. A smaller version is to keep `arrayItem.order` only for `set` updates that create a
new array item and validate/delete-generate paths so deletes never include it.

## Open questions

- Is it acceptable for delete-before-insert of an array item to stay pending until the insert is
  delivered? The existing README proof claim already allows permanently missing causal parents to
  leave non-ready pending updates, but this would make array deletes follow that rule explicitly.
  - yeah that sounds fine
- Do we require canonical metadata convergence even when a delete arrives but its causal insert never
  arrives? If yes, Option A is insufficient and Option B or C is better.
  - no
- Are CRDT documents persisted anywhere with current array tombstone metadata? If yes, this needs a
  metadata migration or compatibility reader.
  - no
- Should `setOrder` for a deleted item be discarded, retained invisibly, or kept pending until the
  item is live? Current code can update order on tombstoned item wrappers because the wrapper still
  exists.
  - eh convergence probably requires it to be applied. "kept pending until the item is live" doesn't make sense because our crdtupdate paths retain 'item creation timestamp' so if an array item was re-created, the order update wouldn't apply to it anymore
- Should array item ids ever be reused by honest replicas? The current id strategy uses timestamps,
  so practical reuse should not happen, but the delete/insert conflict rules should still state the
  assumption.
  - if an ID is reused, LWW applies
- Should `arrayItem.order` be removed from `CrdtPathSegment` entirely, or only stopped for delete
  paths? Removing it entirely likely requires an explicit insert payload.
  - I like the insert payload idea, although maybe I'd like even more a dedicated `op: 'insert'`
- Do remote validation rules need to distinguish "path segment is valid" from "this `set` update is
  an array insert and therefore carries order"? Today validation accepts optional order on any
  `arrayItem` path segment.

## Dedicated `insert` op sketch

Given the answers above, a dedicated array insert op is probably cleaner than an `insert` payload on
`set`. It separates these concepts:

- `insert`: create an array item id with its initial order and value.
- `set`: update an existing value addressed by a CRDT path.
- `delete`: delete an existing value addressed by a CRDT path.
- `setOrder`: update array item order registers.

The path segment can then stop carrying order entirely:

```ts
type CrdtPathSegment =
    | {type: 'objectField'; key: string; parentCreated: HlcTimestamp}
    | {type: 'recordEntry'; key: string; parentCreated: HlcTimestamp}
    | {type: 'arrayItem'; id: ItemId; parentCreated: HlcTimestamp}
    | {
          type: 'taggedField';
          key: string;
          tagKey: string;
          tagValue: string;
          parentCreated: HlcTimestamp;
          tagTs: HlcTimestamp;
      };

type CrdtInsertUpdate = {
    op: 'insert';
    arrayPath: CrdtPathSegment[];
    id: ItemId;
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: JsonValue;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};

type CrdtSetUpdate = {
    op: 'set';
    path: CrdtPathSegment[];
    value: JsonValue;
    ts: HlcTimestamp;
    command?: CrdtCommandInfo;
};

type CrdtUpdate = CrdtInsertUpdate | CrdtSetUpdate | CrdtDeleteUpdate | CrdtSetOrderUpdate;
```

Related naming decision: rename the existing optional update-level `meta?: CrdtUpdateMeta` field to
`command?: CrdtCommandInfo`. The current name is overloaded with CRDT document metadata
(`doc.meta`, `CrdtMeta`) even though the field is only for grouping updates into local edit/undo/redo
commands. `command` makes the purpose clearer and should be applied to every update variant,
including the new `insert` op.

`createCrdtUpdates` would map array `add` to `insert`:

```ts
case 'add': {
    const arrayAdd = arrayAddTarget(doc, patch.path, ts);
    if (arrayAdd) {
        return [{
            op: 'insert',
            arrayPath: arrayAdd.parentPath,
            id: arrayAdd.id,
            order: {value: arrayAdd.order, ts},
            value: patch.value as JsonValue,
            ts,
        }];
    }
    return [{op: 'set', path: crdtPathForExisting(doc, patch.path), value: patch.value, ts}];
}
```

Array `remove` becomes a normal delete with no order-bearing path:

```ts
{
    op: 'delete',
    path: crdtPathForExisting(doc, patch.path),
    ts,
}
```

The apply side gets a separate branch:

```ts
function applyInsert(doc, update): 'applied' | 'discarded' | 'pending' {
    const array = getMetaAtPath(doc.meta, update.arrayPath);
    if (!array) return 'pending';
    if (array.kind === 'tombstone') return 'discarded';
    if (array.kind !== 'array') return 'discarded';

    const existing = array.items[update.id];
    const value = buildMeta(
        update.value,
        schemaAtArrayPath(doc.schema, update.arrayPath),
        doc.schema,
        update.ts,
    );

    if (!existing) {
        array.items[update.id] = {kind: 'live', order: update.order, value};
        return 'applied';
    }

    // LWW for id reuse / duplicate insert. Honest replicas should not reuse ids, but define it.
    const existingVersion =
        existing.kind === 'deleted' ? existing.deleted : versionOf(existing.value);
    if (existingVersion && !newer(update.ts, existingVersion)) return 'discarded';

    array.items[update.id] = {kind: 'live', order: update.order, value};
    return 'applied';
}
```

That example assumes this array item shape:

```ts
type ArrayItemMeta =
    | {kind: 'live'; order: {value: FractionalIndex; ts: HlcTimestamp}; value: CrdtMeta}
    | {kind: 'deleted'; deleted: HlcTimestamp};
```

With that shape, `liveArrayItems` and `materialize` filter on `item.kind === 'live'` instead of
`item.value.kind !== 'tombstone'`, and tombstones have no order field.

Deletes would become array-aware rather than relying on generic `setChild` to synthesize missing
array item shells:

```ts
if (update.op === 'delete' && segment.type === 'arrayItem') {
    if (parent.kind !== 'array') return 'discarded';
    const item = parent.items[segment.id];
    if (!item) return 'pending';

    const targetVersion = item.kind === 'deleted' ? item.deleted : versionOf(item.value);
    if (targetVersion && newer(targetVersion, update.ts)) return 'discarded';

    parent.items[segment.id] = {kind: 'deleted', deleted: update.ts};
    return 'applied';
}
```

`set` no longer creates array items. A `set` targeting a missing array item is pending. That makes
child edits causally depend on `insert`, which matches the existing proof allowance for permanently
missing causal parents.

`setOrder` policy needs to be explicit. With order-free tombstones, I think the practical policy is:

- unknown id: pending, as today;
- live id: apply by LWW to the live item's order;
- deleted id: return `applied` as an idempotent no-op, or `discarded`, but do not store order on the
  tombstone.

The no-op choice preserves the idea that the update has been handled without reintroducing order
into deleted metadata. It also converges: replicas that see `setOrder` before delete will have that
order cleared by the later delete, while replicas that see delete before `setOrder` will keep the
order-free tombstone.

Validation becomes simpler in one place and stricter in another:

- `arrayItem` path segments no longer accept `order`.
- `insert.arrayPath` must walk to an array schema.
- `insert.value` must validate against that array's item schema.
- `set.path` can still walk through array items, but only as an address; it cannot create an array
  item.
- `delete.path` never carries order.

Migration impact is low if there are no persisted current-format CRDT documents. Wire compatibility
still changes, so any network peers must be upgraded together or the protocol needs a version gate.

The main implementation cost is touching all places that currently assume `ArrayItemMeta` always
has `{order, value}`:

- `src/crdt/types.ts`
- `src/crdt/updates.ts`
- `src/crdt/apply.ts`
- `src/crdt/path.ts`
- `src/crdt/materialize.ts`
- `src/crdt/validation.ts`
- `src/crdt/proof.test.ts` reference model
- CRDT validation and convergence tests
