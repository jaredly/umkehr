# Diagnosis: Server Branch Todo Insert Merge

## Short version

The current branch merge code is already mostly CRDT-path based, so the original `Cannot translate CRDT path: array index 4 is missing` crash is probably not coming from the current `buildMergePathPreview` path directly.

However, the new regression test exposes the remaining design bug: insert updates are represented in merge review as the parent array path (`items` / `todos`) instead of the inserted array item path (`items.[arrayItem:id]`). That loses the stable CRDT identity of the inserted item exactly where merge review needs it most.

My opinion: the fix should make merge changed paths for `insert` updates point at the inserted `arrayItem` CRDT path, then generate revert updates from that stable item path. Do not translate inserted items through normal numeric array indexes.

## What the regression shows

The test added to `examples/react-crdt/src/lib/server/materialize.test.ts` creates:

1. initial state: `items = [{id: 'one'}]`;
2. feature branch inserts `{id: 'two'}` at normal index `1`;
3. main builds a merge preview from feature.

The merged preview state is correct:

```ts
['one', 'two']
```

The failing assertion is about changed path identity. Current received value:

```ts
[
  [
    {type: 'objectField', key: 'items', parentCreated: '...'}
  ]
]
```

Desired value:

```ts
[
  [
    {type: 'objectField', key: 'items', parentCreated: '...'},
    {type: 'arrayItem', id: '<insert update id>', parentCreated: '<items array created ts>'}
  ]
]
```

The outer array is correct because `changedPaths` is a list of paths. The problem is that the single path currently stops at the parent array.

## Why this matters

CRDT arrays are stable by item id, not by normal array index.

For ordinary local editing, this is fine:

- the UI gives a normal path like `todos[1].title`;
- `crdtPathForExisting` translates the current live index into an `arrayItem` id;
- the update stores the stable CRDT path.

For branch merge review, a source-only inserted item is different:

- the inserted item exists in the source/merged document;
- it does not exist in the target `before` document;
- any normal path like `todos[4]` is not meaningful against target `before`.

So merge review must preserve the inserted item id from the `insert` update. Falling back to the parent array path avoids an immediate missing-index translation, but it creates a coarse and ambiguous merge path.

## What is likely happening

`examples/react-crdt/src/lib/server/materialize.ts` currently does this:

```ts
function pathForUpdate(update: CrdtUpdate): CrdtPathSegment[] {
    return update.op === 'set' || update.op === 'delete' ? update.path : update.arrayPath;
}
```

That means both `insert` and `setOrder` collapse to the array path.

For `setOrder`, the array path is reasonable: the operation changes ordering for the array as a collection.

For `insert`, the array path is too broad. The operation creates a specific array item with:

```ts
update.id
update.arrayPath
update.value
update.order
```

The merge changed path should be:

```ts
[
  ...update.arrayPath,
  {type: 'arrayItem', id: update.id, parentCreated: array.created}
]
```

This is already the shape used by local CRDT history for insert effects in `src/crdt/history.ts`.

## Relationship to the original crash

The original crash string comes from `crdtPathForExisting`, which translates normal paths to CRDT paths by indexing into live array items.

The current merge preview code path does not appear to call `crdtPathForExisting` while computing merge changed paths. It uses CRDT paths from updates and `getMetaAtPath`.

So I see two possibilities:

1. The original crash was observed on an older implementation that still converted merge paths through normal numeric indexes.
2. The crash still exists, but from a UI hook such as `useCrdtPath` / `useCrdtMeta` translating a stale normal todo row path while branch preview or branch switching changes the visible document.

Either way, the correct merge fix is the same: source-only inserted items should stay in CRDT path space and should be addressed by `arrayItem` id, not normal index.

## What needs to change

### 1. Make insert changed paths item-specific

Change `pathsForBranchThrough` / `pathForUpdate` so insert updates return the inserted item CRDT path.

The function currently lacks a document/meta argument, but `arrayItem.parentCreated` requires the parent array's `created` timestamp. Options:

- Materialize the source branch as we collect paths and read the array metadata after applying each update.
- Or add a small path helper that resolves `parentCreated` from a known document where `update.arrayPath` exists.

I prefer materializing as part of path collection because it scales to nested arrays and recursive merges. It avoids assuming the target `before` document has the same parent incarnation as the source update.

### 2. Keep `setOrder` at the array path

Do not make reorder operations item-specific. Reorder is naturally an array-level change.

### 3. Revert inserted items with CRDT delete

Once changed paths include the inserted `arrayItem` path, existing `createRestoreUpdates` is close:

- `getMetaAtPath(before.meta, insertedItemPath)` returns `undefined`;
- `metaToUpdate` returns `{op: 'delete', path: insertedItemPath, ts}`;
- applying that delete to the merged preview tombstones the inserted item.

That is the desired behavior.

### 4. Add/keep tests at two levels

Keep the new unit regression because it pins the internal invariant:

- inserted branch item appears in merged preview;
- changed path is the inserted `arrayItem`;
- reverting that path removes only that item.

After the unit passes, update the Playwright server branch test to use an inserted todo again, so the full workflow is covered.

## Open questions

1. Is the original crash still reproducible on this exact branch after the current CRDT-path merge code?
2. If yes, what component is calling `useCrdtPath` or `useCrdtMeta` during the crash?
3. Should merge review collapse follow-up field edits under a newly inserted item into the inserted item path?
4. Should path labels for array items show stable ids only, or should they try to display a best-effort title/index from the merged preview?

## Recommendation

Fix insert path granularity first. It is a small, defensible semantic change and it is directly covered by the new failing regression. Then rerun the attempted E2E todo-insert branch merge. If the original crash still reproduces after that, investigate stale UI normal-path translation separately.
