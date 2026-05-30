# Server Todo Branch Merge Crash

## Status

Fixed and covered by E2E.

The server branch regression now inserts a real todo on the source branch,
previews the merge from `main`, accepts the merge, and verifies the inserted
todo appears on `main`:

- `examples/react-crdt/tests/server/server-branches.spec.ts`

Verification:

```text
pnpm test:e2e -- tests/server/server-branches.spec.ts
1 passed (12.4s)

pnpm build
passed
```

## Original Summary

While adding Playwright coverage for server branch/merge workflows in
`examples/react-crdt`, a branch test that inserted a new todo on a branch caused
the app to crash with:

```text
Cannot translate CRDT path: array index 4 is missing.
```

The failure was observed when exercising the server-backed Todos app with a
branched document. Scalar edits to an existing field, such as changing
`bgcolor`, merge successfully. The crash appears specific to array-backed todo
changes where a normal array index is translated against a CRDT document that no
longer contains a live item at that index.

## Impact

This blocks reliable E2E coverage, and likely user-facing behavior, for branch
merge scenarios involving inserted todos. It means a normal server branch merge
can fail when the source branch adds a todo and the merge preview or merge
acceptance path tries to materialize/revert changed paths.

The E2E suite temporarily worked around this by covering server branch/merge
with scalar todo color edits instead of inserted todo rows:

- `examples/react-crdt/tests/server/server-branches.spec.ts`

That workaround verifies the branch/merge UI, but it does not cover array item
insertions in server branch merges.

## Observed Scenario

The attempted test flow was:

1. Start an isolated Bun server with a seeded SQLite database.
2. Open `mode=server&doc=todos-small`.
3. Log in as a seeded user.
4. Create a new branch from `main`.
5. Make todo list changes across `main` and the new branch.
6. Insert a new todo on the branch.
7. Return to `main`.
8. Select the branch as the merge source.
9. Open merge preview or accept the merge.

At that point the app crashed with:

```text
Cannot translate CRDT path: array index 4 is missing.
```

## Expected Behavior

Server branch merge should handle todo insertions the same way it handles scalar
field edits:

- merge preview should render without throwing;
- changed paths should include the inserted todo or relevant todo array path;
- accepting the merge should materialize the inserted todo on the target branch;
- applying/reverting selected merge paths should not require a live normal-array
  index that is absent from the target document.

## Suspected Failure Area

The thrown error string comes from `crdtPathForExisting` in
`src/crdt/path.ts`. That function translates a normal path such as
`todos[4]` to CRDT array-item metadata by looking up the current live item at
that numeric index:

```ts
const live = liveArrayItems(meta);
const item = live[segment.key];
if (!item) {
    throw new Error(`Cannot translate CRDT path: array index ${segment.key} is missing.`);
}
```

For branch merge, that lookup is fragile: an inserted source-branch todo may
exist in the source/merged document, but not in the target/before document at the
same normal index. If the merge or revert code asks for a normal indexed path to
be translated against the wrong document state, the index is missing and the
translation throws.

Related code worth inspecting:

- `src/crdt/path.ts`
  - `crdtPathForExisting`
  - `normalPathForCrdtPath`
  - `changedNormalPathsForCrdtUpdate`
- `examples/react-crdt/src/lib/server/materialize.ts`
  - `mergePreviewForBranch`
  - `pathsForBranchThrough`
  - `createRestoreUpdates`
  - `metaToUpdate`

## Previous Workaround

The Phase 5 E2E branch coverage was changed to use scalar `bgcolor` edits across
main and branch. That avoids normal-array index translation and still verifies:

- branch creation;
- divergent edits;
- merge preview panel;
- changed paths;
- accepting a merge;
- timeline merge event.

This workaround has been removed now that branch merges support inserted todo
items.

## Notes For A Fix

The fix should probably avoid translating source-branch array insertions through
normal numeric indexes on a document that may not contain the inserted item.
Possible directions:

- keep merge changed paths in CRDT path space for array item changes;
- when computing revert/apply paths, derive inserted-item paths from CRDT
  `arrayItem` ids rather than normal array indexes;
- ensure delete/revert updates for inserted source-only items can be generated
  even when the target/before document has no live item at the corresponding
  normal index;
- add regression coverage for a server branch where the source branch inserts a
  todo and the target branch has a different live todo count/order.

## Regression Test Shape

A focused regression test should fail before the fix and pass after it:

1. Seed `todos-small`.
2. Create a branch.
3. Add a todo on the branch.
4. Optionally make an independent target-branch edit or reorder.
5. Open merge preview from `main`.
6. Assert the merge preview renders changed paths without crashing.
7. Accept the merge.
8. Assert the inserted todo appears on `main` and a merge event appears.

`server-branches.spec.ts` now covers todo insertion directly instead of relying
only on scalar color changes.
