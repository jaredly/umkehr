# Research: Server Todo Branch Merge Crash

## Problem statement

The reported crash is:

```text
Cannot translate CRDT path: array index 4 is missing.
```

That exact string is thrown only by `crdtPathForExisting` when translating a normal JSON path through an array and the numeric index does not correspond to a live array item in the document being used for translation.

The fragile shape is:

1. A source branch inserts a todo, producing a CRDT `insert` update whose stable identity is an `arrayItem` id.
2. The merge UI or merge acceptance code reasons about that inserted item from the target branch's pre-merge document.
3. If anything re-expresses the inserted item as a normal path such as `todos[4]` and then translates that normal path against the pre-merge target document, `crdtPathForExisting` throws because the target document only has indexes `0..3`.

## Relevant code

### Normal path to CRDT path translation

`src/crdt/path.ts`

- `crdtPathForExisting` walks live CRDT metadata for a normal path.
- For arrays it sorts live items, indexes into that live list, and throws if the numeric index is absent.
- This is correct for editing an existing visible item, but unsafe for a source-only item during merge review.

Key behavior:

- Lines 16-19: accepts a `CrdtDocument` plus normal `Path`.
- Lines 32-40: array segment translation requires a live item at the numeric index.
- Lines 123-164: `normalPathForCrdtPath` does the reverse and returns `undefined` if an `arrayItem` id is not live in the document.
- Lines 167-200: `changedNormalPathsForCrdtUpdate` avoids throwing by trying `after` and `before` CRDT-to-normal translation and returning `null` if neither side can express the path.

### Patch to CRDT update translation

`src/crdt/updates.ts`

- Lines 30-35: `remove` translates the full normal path through `crdtPathForExisting`.
- Line 72: non-array-add `set`/`replace` translates the full normal path through `crdtPathForExisting`.
- Lines 75-82 and 111-120: reorder/move translate the array path through `crdtPathForExisting`.
- Lines 52-70 and 119-135: array add is safer because it translates only the parent array path; the inserted item id is the timestamp, not a translated normal index.

This means normal-path translation remains expected for local UI edits, but merge machinery should avoid representing source-only array items as normal indexed paths when applying/reverting merge choices.

### Current merge preview/materialization path

`examples/react-crdt/src/lib/server/materialize.ts`

- Lines 123-134: `buildMergePathPreview` materializes target `before`, materializes a preview target with a synthetic merge event, and collects `changedPaths`.
- Lines 257-285: `pathsForBranchThrough` returns paths directly from CRDT updates via `pathForUpdate`, not normal paths.
- Lines 426-428: `pathForUpdate` returns `update.path` for `set`/`delete`, or `update.arrayPath` for `insert`/`setOrder`.
- Lines 430-452: `createRestoreUpdates` reads `before` metadata at CRDT paths; missing/tombstoned metadata becomes a CRDT `delete` update.

This is important: the current `materialize.ts` code path does not appear to call `crdtPathForExisting` while building ordinary merge preview changed paths or revert updates. For a source-only insert, `changedPaths` will currently be the parent array path, not the inserted item path. If the user reverts that path, `getMetaAtPath(before.meta, todos-array-path)` returns the pre-merge todo array metadata and `metaToUpdate` emits a `set` for the whole array value, rather than a targeted delete for the inserted item.

### Merge acceptance path

`examples/react-crdt/src/lib/server/useServerSync.ts`

- Lines 959-976: `mergeBranch` calls `buildMergePathPreview`.
- Lines 977-1004: it records a merge event plus any preview-generated revert updates.
- Lines 1005-1017: it rematerializes the target branch and replaces the visible history.
- Lines 1020-1037: merge preview uses the same `buildMergePathPreview` function.

Accepting a merge with no reverted paths should only record the merge event. It should not need normal indexed path translation.

### React CRDT subscription and notification paths

`src/react-crdt/react-crdt.tsx`

- Lines 189-202: `useCrdtPath(node)` calls `crdtPathForExisting(visibleHistory(ctx).doc, path)`.
- Lines 203-224: `useCrdtMeta(node)` also translates normal paths with `crdtPathForExisting`.
- Lines 456-478: remote updates apply, then `changedNormalPathsForCrdtUpdate` computes normal paths for invalidation.
- Lines 532-550: undo/redo notification uses `changedNormalPathsForCrdtUpdate`.

The notification path should not throw for source-only inserts because `changedNormalPathsForCrdtUpdate` translates CRDT-to-normal and returns `null` on failure. The hook path can throw if a component asks for CRDT metadata using a stale normal index under a preview/branch state where that item is absent.

## Current hypothesis

The crash is not caused by the current `pathsForBranchThrough` implementation directly, because it collects CRDT paths, not normal paths.

The most likely remaining causes are:

1. **A stale or mismatched UI path is being translated through `useCrdtPath` or `useCrdtMeta`.**
   A row/component may retain a normal path like `todos[4]` while the visible history has switched back to `main` or to the pre-merge target, where index `4` is absent. Calling `useCrdtMeta(editor.$.todos[4]...)` or similar would produce the exact throw.

2. **Older failing code may have translated merge changed paths from normal paths.**
   The bug note names `createRestoreUpdates`/`metaToUpdate`, but current code already uses CRDT paths and `getMetaAtPath`. If the crash was observed before this shape landed, the immediate source may already have been partially fixed.

3. **Merge path granularity for inserts is still wrong even if it no longer throws.**
   `pathForUpdate(insert)` returns the parent array path. That makes the preview path label less specific and makes partial revert semantics coarse. Reverting a source insert currently restores the entire target-side array value at that CRDT array path, rather than deleting the inserted `arrayItem` id from the merged preview. This can wipe out independent source changes inside other array items or interact poorly with concurrent target edits.

## What a robust fix should preserve

- Merge review should keep changed paths in CRDT path space.
- Insert updates should probably expose the inserted item path:

```ts
[
  ...update.arrayPath,
  {type: 'arrayItem', id: update.id, parentCreated: <array-created-ts>}
]
```

- The `parentCreated` value should come from the array metadata in a document where the parent array exists. For a todo insert into the root `todos` array, it should be available from either source materialization or target `before`; for nested arrays, source materialization may be necessary.
- Reverting a source-only inserted item should generate a CRDT `delete` for the inserted `arrayItem` path. That does not require the item to exist in `before`; it only needs to exist in the merged preview when the delete is applied.
- UI labels may still convert CRDT paths to display strings, but they should not require normal numeric indexes from the target `before` document.

## Regression coverage target

A focused unit test in `examples/react-crdt/src/lib/server/materialize.test.ts` would be faster and more diagnostic than starting with E2E:

1. Use a test schema with an array field, or reuse the todo app schema if convenient.
2. Materialize initial main.
3. Create a feature branch from main.
4. Add an item on feature with `createCrdtUpdates(..., {op: 'add', path: [{key: 'items'}, {key: initialLength}], ...})`.
5. Build merge preview from main.
6. Assert:
   - no throw;
   - merged preview contains the inserted item;
   - changed paths include a CRDT `arrayItem` path for the inserted id, not just the parent array;
   - selecting that path for revert removes only the inserted item.

Then update `examples/react-crdt/tests/server/server-branches.spec.ts` to add a todo on the branch and assert the inserted todo appears after accepting the merge. The E2E test should remain a broad workflow guard, while the unit test should pin the exact path/revert semantics.

## Open questions

1. Is the crash still reproducible on the current branch, or was it observed before `pathsForBranchThrough` became CRDT-path based?
2. Does any todo component currently call `editor.useCrdtPath` or `editor.useCrdtMeta` for per-row metadata? If so, can branch switching or preview rendering leave a row mounted with a stale numeric path?
3. Should merge review expose inserted array items as individually revertible paths, or is whole-array revert acceptable for the initial UX?
4. If inserted items become individually revertible, should child field edits under the same inserted item be deduped/collapsed under the inserted item path?
5. How should merge preview labels display source-only array items when they cannot be translated to a normal target index?
6. Should `crdtPathForExisting` remain throwing for missing array indexes, or should callers that handle stale UI paths get a non-throwing helper such as `tryCrdtPathForExisting`?

## Suggested next step

Start with a unit regression around `buildMergePathPreview` for a branch-side array insert. If that already passes for preview/accept but fails for per-path revert granularity, fix `pathForUpdate(insert)` to return an inserted `arrayItem` path with the correct `parentCreated`, and add the E2E todo insertion workflow afterward.
