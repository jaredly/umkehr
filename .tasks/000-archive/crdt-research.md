# CRDT umkehr research

This document sketches a CRDT layer for umkehr that keeps the current authoring experience as intact as possible:

- callers keep using `createPatchBuilder`, `DraftPatch`, and realized `Patch` values for local edits;
- application state remains plain JSON-like data in the expected shape;
- CRDT metadata lives beside the state, not inside user data;
- a translation layer turns realized umkehr patches into CRDT updates with stable addresses, timestamps, tombstones, and array ordering metadata.

The main conclusion is that this can work, but the CRDT update format cannot be just `Patch + timestamp`. It needs a stronger path format that names object identities/creation timestamps and array item IDs, otherwise deletes followed by recreates can incorrectly absorb delayed child updates.

## Goals

Supported user data:

- primitives: `string`, `number`, `boolean`, and `null`;
- plain objects;
- records;
- arrays, represented internally as records keyed by generated item IDs plus fractional order keys;
- tagged unions, where the discriminant branch is selected as a whole-object creation/replacement event.

Not supported:

- functions;
- non-JSON object values such as `Date`, `Blob`, class instances, `Map`, or `Set`;
- object identity in user data;
- arbitrary array `move` as a first-class CRDT operation.

`undefined` should continue to behave like "missing", matching current umkehr draft realization behavior.

## Non-goals

This layer does not need to make existing `Patch` values themselves commutative. Current patches are intentionally state-relative: array paths use numeric indices, `replace` carries `previous`, and `remove` carries the removed value for inversion. That is useful for local history, but it is not a stable replication format.

Instead, the CRDT layer should expose a separate replicated update format. The current patch layer becomes an authoring/local-history layer; the CRDT layer becomes the network/storage merge layer.

## Existing umkehr constraints

The relevant current behavior:

- `PathSegment` is either `{type: 'key', key}` or `{type: 'tag', key, value}`.
- Array addressing is by numeric index.
- `$push` realizes to `add` at the current array length.
- `$reorder(indices)` is an array-level operation using old indices in their new order.
- `$move` is supported locally for arrays and objects, but it is effectively remove plus add.
- Tagged unions require a tag segment before navigating into branch-specific fields.
- Replacing a tagged union can be expressed at the union object path; updating the discriminant alone is not a valid semantic operation.

Those constraints are compatible with a CRDT layer if translation happens before replication.

## Proposed architecture

Add a new package/module beside the current core:

```ts
type CrdtDocument<T> = {
    state: T;
    meta: CrdtMeta;
    pending: PendingUpdate[];
};

function createCrdtDocument<T>(initial: T, clock: Hlc): CrdtDocument<T>;

function realizeCrdtUpdate<T>(
    doc: CrdtDocument<T>,
    patch: Patch<T>,
    clock: Hlc,
    ids: IdGenerator,
): CrdtUpdate<T>;

function applyCrdtUpdate<T>(
    doc: CrdtDocument<T>,
    update: CrdtUpdate<T>,
): CrdtDocument<T>;
```

The local flow is:

1. Use `resolveAndApply` or the React/history dispatch path to produce ordinary realized `Patch` values.
2. For committed patches, translate each realized patch into one or more `CrdtUpdate` values against the pre- or post-apply CRDT metadata.
3. Apply those CRDT updates locally and send them to peers.
4. Peers apply the same `CrdtUpdate` values using CRDT metadata, not ordinary `applyPatch`.

Preview updates should stay local and should not produce CRDT updates.

## Timestamps

Use a hybrid logical clock timestamp as the total ordering key:

```ts
type HlcTimestamp = string; // comparable by the CRDT module
type ReplicaId = string;
```

Timestamp comparison must be deterministic across replicas. If two events can produce equal physical/logical components, the encoded timestamp must still include a replica tie-breaker or have an associated actor ID so Last Write Wins is total.

For the rest of this document, `newer(a, b)` means the total HLC order says `a > b`.

## Metadata model

The metadata should mirror the user state, but not one-to-one. Containers have creation timestamps, records/arrays retain tombstones, and arrays are internally item-ID addressed.

Sketch:

```ts
type CrdtMeta =
    | PrimitiveMeta
    | ObjectMeta
    | RecordMeta
    | ArrayMeta
    | TaggedUnionMeta
    | TombstoneMeta;

type PrimitiveMeta = {
    kind: 'primitive';
    ts: HlcTimestamp;
};

type ObjectMeta = {
    kind: 'object';
    created: HlcTimestamp;
    fields: Record<string, CrdtMeta>;
};

type RecordMeta = {
    kind: 'record';
    created: HlcTimestamp;
    entries: Record<string, CrdtMeta | TombstoneMeta>;
};

type ArrayMeta = {
    kind: 'array';
    created: HlcTimestamp;
    items: Record<ItemId, ArrayItemMeta>;
};

type ArrayItemMeta = {
    created: HlcTimestamp;
    order: {value: FractionalIndex; ts: HlcTimestamp};
    value: CrdtMeta | TombstoneMeta;
};

type TaggedUnionMeta = {
    kind: 'tagged';
    created: HlcTimestamp;
    tagKey: string;
    tagValue: string;
    tagTs: HlcTimestamp;
    fields: Record<string, CrdtMeta>;
};

type TombstoneMeta = {
    kind: 'tombstone';
    deleted: HlcTimestamp;
};
```

The important design choice is that every container-like thing has a creation timestamp. That includes objects, records, arrays, tagged union objects, and array items. This gives child updates a stable parent incarnation to target.

## State shape

User-visible state should stay clean:

```ts
type State = {
    bgcolor: string;
    todos: Todo[];
};
```

Array IDs, array order keys, tombstones, and container creation timestamps remain in `meta`. The rendered `state.todos` array is derived by:

1. filtering out tombstoned array items;
2. sorting live items by fractional order;
3. materializing each item value into normal JSON.

Records similarly omit tombstoned entries when materialized.

## CRDT update format

A CRDT update should be addressed by stable CRDT path segments rather than ordinary umkehr path segments.

```ts
type CrdtPathSegment =
    | {type: 'objectField'; key: string; parentCreated: HlcTimestamp}
    | {type: 'recordEntry'; key: string; parentCreated: HlcTimestamp}
    | {type: 'arrayItem'; id: ItemId; parentCreated: HlcTimestamp; itemCreated: HlcTimestamp}
    | {
          type: 'taggedField';
          key: string;
          tagKey: string;
          tagValue: string;
          parentCreated: HlcTimestamp;
          tagTs: HlcTimestamp;
      };

type CrdtUpdate =
    | {
          op: 'set';
          path: CrdtPathSegment[];
          value: JsonValue;
          ts: HlcTimestamp;
      }
    | {
          op: 'delete';
          path: CrdtPathSegment[];
          ts: HlcTimestamp;
      }
    | {
          op: 'setOrder';
          arrayPath: CrdtPathSegment[];
          orders: Record<ItemId, {order: FractionalIndex; ts: HlcTimestamp}>;
      };
```

This is only a sketch. The actual format may want a more compact representation, but it needs these logical ingredients:

- the target path;
- the update timestamp;
- parent creation timestamps for each traversed container;
- item IDs for arrays;
- tag timestamp for tagged union branch fields;
- tombstones for deletes.

## Translating current patches

Translation takes a realized `Patch`, the current CRDT metadata, a clock timestamp, and an ID generator.

### `add`

For object/record fields, translate to `set` at the CRDT path with `ts`.

For array indices:

1. resolve the numeric index against the current live ordered array;
2. allocate a new item ID;
3. choose a fractional order between neighboring live items;
4. produce a `set` of the new item value with item metadata `{created: ts, order: {value, ts}}`.

The root timestamp should be recursively applied to the value's metadata. For example, adding a whole object creates the object and all of its children at the same timestamp, unless we later decide to store only container/leaf timestamps that are needed for merging.

### `replace`

For primitives, use LWW: apply if `ts` is newer than the current leaf timestamp.

For container replacement, treat the target as a new incarnation with `created = ts`. This avoids accidentally merging fields from the old incarnation into the new object.

For tagged unions, replacing the whole union object creates a new tagged branch with `created = ts` and `tagTs = ts`. The discriminant itself is not independently updatable.

### `remove`

Translate to `delete` with timestamp `ts`. Application installs a tombstone at the target path if the delete wins against the target's creation/value timestamp.

For records and array items, keep the tombstone in metadata so delayed older updates can be rejected.

### `move`

Do not support as a replicated CRDT update.

A local move can still be converted intentionally into delete plus add, but that changes identity and has the expected replication cost. This is the right tradeoff because "move while preserving identity" across arbitrary object and array paths creates hard conflicts with deletes, recreates, and concurrent edits.

### `reorder`

Translate `reorder` into `setOrder` updates for array item IDs.

Given the current live ordered array and `indices`, compute the new ID order, then assign new fractional indices. Each changed item's order gets the reorder timestamp. Concurrent reorders resolve per item by LWW on the order timestamp.

Open concern: per-item LWW order updates can produce a merged order that no user ever explicitly chose when concurrent whole-array reorders overlap. This is probably acceptable for a lightweight layer, but it should be documented and tested.

## Applying CRDT updates

Applying an update walks the CRDT metadata path rather than the plain state path.

At each path segment:

- If the parent exists and its creation timestamp equals the segment's `parentCreated`, continue.
- If the parent exists but its creation timestamp is newer than the segment's `parentCreated`, discard the update. It targets an older incarnation.
- If the parent is missing, or exists with an older creation timestamp, enqueue the update as pending. It may be waiting for an out-of-order parent creation update.
- If a tombstone exists and its delete timestamp is newer than or equal to the segment's parent/item/tag timestamp, discard the update.
- If a tombstone exists but the incoming update refers to a newer incarnation, enqueue until the newer creation arrives.

At the leaf:

- `set` applies if its timestamp wins for the target value/incarnation.
- `delete` applies if its timestamp wins against the current value/container creation timestamp.
- `setOrder` applies per item if the order timestamp wins.

After applying any update that creates a container or removes a tombstone by winning recreation, retry pending updates. The simple implementation can scan the whole pending queue. That is not optimal, but it is clear and adequate until real workloads prove otherwise.

## Why path creation timestamps are required

Without parent creation timestamps in paths, delayed child updates can attach to the wrong incarnation after delete plus recreate.

Example:

```ts
type Items = Record<string, {title: string; people: Record<string, {name: string}>}>;
```

Events:

- `A`: `items.one = {title: 'One', people: {}}`
- `B`: `items.one.people.me = {name: 'Me'}`
- `C`: delete `items.one`
- `D`: `items.one = {title: 'One1', people: {}}`

If a peer receives `A C D B`, then `B` must not attach `me` to the recreated `items.one`. `B` targets the object incarnation created by `A`, not the one created by `D`.

The same issue appears with tagged union branches and arrays. Stable item IDs solve the array index part, but item creation timestamps are still useful when item IDs are generated externally or tombstones are retained.

## Tagged unions

Tagged unions need stricter rules than plain objects:

- The tag branch is chosen by replacing/creating the whole tagged object.
- The discriminant field is not independently updatable.
- Branch field updates target a specific `tagTs`.
- If the current branch has a newer `tagTs`, discard the incoming branch field update.
- If the current branch is missing or older than the incoming branch field update's required `tagTs`, enqueue the update.
- If the current branch has the same `tagTs`, merge fields normally.

This preserves the invariant that branch fields belong to one selected branch, while still allowing ordinary object-like LWW merges inside that branch.

## Arrays

Arrays should be modeled as an ordered record:

```ts
type ArrayStorage = Record<ItemId, {
    created: HlcTimestamp;
    deleted?: HlcTimestamp;
    order: FractionalIndex;
    orderTs: HlcTimestamp;
    value: CrdtMeta;
}>;
```

Numeric umkehr paths are only a local authoring convenience. CRDT updates must refer to item IDs.

For `add` at index:

- find the live item before and after the requested insertion index;
- generate an order key between them;
- generate a fresh item ID;
- create the item at `ts`.

For updates inside an existing array element:

- resolve the numeric index to the current item ID during translation;
- include that item ID and item creation timestamp in the CRDT path.

For deletes:

- tombstone the item ID rather than splicing the array.

For rendering:

- filter tombstoned items;
- sort by `(order, itemId)` or `(order, created, itemId)` for deterministic tie-breaking.

Open concern: fractional indices eventually need compaction or rebalance. Compaction itself is a replicated operation unless order keys are allowed to grow indefinitely.

## Records and tombstones

Record deletes should leave tombstones by key:

```ts
entries[key] = {kind: 'tombstone', deleted: ts};
```

A later `set` of the same key wins only if it has a newer timestamp and creates a new value incarnation. Older delayed child updates must still be rejected because their path carries the previous parent creation timestamp.

Tombstone garbage collection is possible only when the system has a causal stability signal: every replica that could send an older update has seen the tombstone or is known gone. Without that, tombstones must be retained.

## Pending updates

Pending updates are required for out-of-order delivery. A simple implementation can be:

```ts
type PendingUpdate = {
    update: CrdtUpdate;
    reason: 'missing-parent' | 'missing-tag-branch' | 'future-incarnation';
    queuedAt: HlcTimestamp;
};
```

On every successful apply, scan pending updates and retry those that may now be unblocked. Pathological cases can be optimized later with an index keyed by required creation timestamp or parent path.

Updates should be idempotent. Applying the same update twice should either do nothing the second time or reach the same metadata/state.

## Relationship to local history

CRDT updates are not a replacement for local undo/redo history.

Current umkehr history stores realized patches and inverts them. A collaborative document has two different histories:

- local user history: "undo my last command";
- replicated document history: "merge all peers' operations".

The first can continue to use ordinary umkehr patches. The second should use CRDT updates. Undo in a collaborative setting should probably generate new CRDT updates that semantically reverse a local command against the current document, not delete old CRDT updates.

That deserves separate design work.

## Validation and schemas

The current `validation` module validates ordinary `Patch<T>` values against typia/OpenAPI schemas. A CRDT layer would need separate validation:

- update envelope shape;
- HLC format;
- path segment shape;
- JSON value support;
- optional validation of materialized values against the same user schema.

Schema information could also help distinguish fixed objects from records and identify tagged unions, but the runtime layer may need caller-provided hints because TypeScript types are erased.

## Minimal implementation plan

1. Define internal CRDT types and HLC comparison.
2. Define metadata construction from initial state.
3. Implement state materialization from metadata.
4. Implement stable path translation from `Patch` to `CrdtUpdate`.
5. Implement `applyCrdtUpdate` for primitive/object/record paths.
6. Add tombstones and parent creation timestamp checks.
7. Add arrays with item IDs and fractional order keys.
8. Add tagged union branch timestamp checks.
9. Add pending update retry.
10. Add focused convergence tests with permuted update delivery.

The first useful milestone could skip tagged unions and array reorder, then add them once the timestamp/path semantics are proven.

## Test cases to force correctness

Convergence tests should apply the same logical updates in every permutation and assert identical materialized state plus compatible metadata.

Required cases:

- concurrent primitive replace: newer HLC wins;
- delete older than replace: replace wins;
- delete newer than child field update: delete wins and child update is discarded;
- delete plus recreate plus delayed old child update: old child update is discarded;
- create child before parent arrives: child update queues, then applies after parent;
- tagged union branch replacement plus delayed old branch field update: old field update is discarded;
- tagged union branch field arrives before branch creation: field update queues;
- array add/update/delete with delayed element update: tombstoned item rejects old update;
- array delete plus recreate at same numeric position: old item updates do not affect new item;
- concurrent reorders: deterministic final order;
- duplicate update delivery: idempotent application.

## Open questions

- How should the runtime know whether an object-like value is a fixed object or a record? Typia schemas may help, but callers may need explicit schema/hints.
  -> We'll rely on the Typia-generated schema
- Should all containers have creation timestamps, or only deletable/replacable containers? Consistency argues for all containers.
  -> All containers
- Should replacing a fixed object always create a new incarnation, or should it recursively LWW-merge fields? New incarnation is simpler and safer; recursive merge may preserve more concurrent edits.
  -> always new
- How should root replacement interact with pending updates targeting the old root?
  -> root should have a container ts as well, so replacing root ignores stale updates
- Is per-item LWW for `reorder` acceptable, or should reorder be modeled as a stronger array-level operation?
  -> per-item LWW
- What fractional indexing implementation should be used, and when should order keys be compacted?
  -> let's use strings, which can grow indefinitely. compaction will require additional research to coordinate between clients
- What is the tombstone garbage-collection story? Without causal stability, tombstones are permanent.
  -> yeah we'll punt on this for now
- How should collaborative undo work? It likely needs command-level metadata, not only patch inversion.
  -> this will be a separate research topic. let's nail the CRDT implementation first
- Should CRDT update generation happen before or after applying the local ordinary patch? Array index translation and previous metadata access make this choice important.
  -> I think we turn the patch into a CRDT update and then discard the patch
- How much of this should be public API versus internal implementation detail?
  -> good question. let's just nail the CRDT impl first and then we can worry about that.

## Recommendation

The approach is viable if the CRDT layer is treated as a separate replicated update system, not as a small extension of `Patch`. The existing builder and patch types can remain the local authoring surface, but network updates should use:

- stable array item IDs;
- HLC timestamps with deterministic tie-breaking;
- tombstones for records and arrays;
- container creation timestamps;
- CRDT path segments that include the required parent/tag/item incarnation timestamp;
- a pending queue for out-of-order delivery.

The creation timestamp in every container path segment is the key simplification. It makes deletes, recreates, delayed child updates, and tagged union branch changes all follow the same rule: an update applies only to the incarnation it was authored against.

## Notes

- ArrayItemMeta.create feels redundants with the value's created/deleted timestamp
- taggedField parentCreated & tagTs seem like they would be the same?
- array ordering open concern is noted and understood
- the "ArrayStorage" sketch is redundant with the earlier ArrayItemMeta. I prefer the ArrayItemMeta version.
- id generation can use the hlc, we don't need a separate function for that
