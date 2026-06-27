# Plan: Reversible Char And Block Deletion

## Scope

Implement reversible deletion for `src/block-crdt` characters and explicit block deletion only.

Out of scope for this plan:

- reversible joins / unjoin,
- join-record activation state,
- compaction / garbage collection,
- UI communication for remote delete-vs-restore surprises,
- backwards compatibility with persisted old-format states or ops.

Decisions from research:

- Use LWW semantics for delete/restore.
- Store the field as `deleted?: {value: boolean; ts: HLC}`.
- `undefined` means visible.
- HLC strings already encode actor/session identity, so `ts` alone is enough for ordering.
- Do not add extra HLC validation unless other HLC fields get validation too.
- Delete helpers should require `ts`, not `actor`.
- Subtree delete undo restores exactly the blocks deleted by the original op batch.
- Joins remain as they are. A restored block can still be hidden by an active join.

## Target Semantics

Character visibility:

```ts
deleted === undefined || deleted.value === false // visible
deleted.value === true // hidden
```

Block visibility:

```ts
!isDeleted(block) && !state.cache.joinedBlocks[blockId]
```

Delete/restore merge:

```ts
incoming.ts > current.ts
```

If `current.deleted` is `undefined`, any incoming delete state wins.

Duplicate or stale visibility ops are ignored.

## Phase 1: Types And Helpers

Update `src/block-crdt/types.ts`:

- Add a shared type:

```ts
export type DeletedState = {
    value: boolean;
    ts: HLC;
};
```

- Change `Char.deleted` from `boolean` to `DeletedState | undefined`.
- Change `Block.deleted` from `boolean` to `DeletedState | undefined`.
- Replace delete op shapes with timestamped delete/restore-capable ops.

Recommended op shape:

```ts
| {type: 'char:delete'; id: Lamport; deleted: DeletedState}
| {type: 'block:delete'; id: Lamport; deleted: DeletedState}
```

This keeps the existing op names but lets the same op type carry either `{value: true, ts}` or `{value: false, ts}`. A separate `char:restore` / `block:restore` pair is clearer at the call site, but it creates more op variants without adding CRDT behavior. The helper layer can expose restore helpers even if the wire op is `*:delete`.

Add helpers, probably in a new or existing small utility module:

```ts
export const isDeleted = (record: {deleted?: DeletedState}): boolean =>
    record.deleted?.value === true;

export const deletedStateWins = (
    incoming: DeletedState,
    current: DeletedState | undefined,
): boolean => !current || incoming.ts > current.ts;
```

Then replace direct boolean checks gradually through the implementation.

## Phase 2: Apply Logic

Update `src/block-crdt/apply.ts`.

`charOp` and block creation should emit `deleted: undefined` or omit `deleted` if the type permits it. Since the property name remains present in the type, using `deleted: undefined` is acceptable.

Change `applyCharDelete`:

- Require the target char to exist as today.
- If `deletedStateWins(op.deleted, current.deleted)` is false, return unchanged state.
- Otherwise update `current.deleted = op.deleted`.
- Keep cache unchanged, because char visibility affects rendering/traversal filtering but not parent-child structure.
- Continue updating `maxSeenCount` from op ids as today. Since HLC `ts` is not a Lamport id, `maxLamportCounterForOp` does not need to inspect it.

Change `applyBlockDelete`:

- Require the target block to exist as today.
- Apply the same LWW field merge.
- Keep cache unchanged, because hidden blocks remain in `blockChildren`; visibility is checked during traversal.

Change duplicate `char` and `block` insert merge:

- `applyChar` should not overwrite a newer local delete/restore with stale insert payload visibility.
- If an incoming `char` op has a `deleted` field, merge it by `deletedStateWins`; otherwise preserve current deleted state.
- If current does not exist, accept the incoming deleted state, usually `undefined`.
- Preserve existing text conflict behavior.

- `applyBlock` should merge `deleted` using LWW, not `current.deleted || block.deleted`.
- Preserve existing merge behavior for `meta`, `style`, and `order`.

Update stale/duplicate classification if needed:

- `applyRemote` currently calls unchanged results `ignored`.
- Stale delete/restore ops can be treated as `ignored` with reason `duplicate` under current result typing, or `stale` if the code is already set up to distinguish it later. No API change is required for this task.

## Phase 3: Public Change Helpers

Update `src/block-crdt/changes.ts`.

`deleteRangeOps` currently has no timestamp. Change its signature to require `ts: HLC` or `ts: () => HLC`.

Pragmatic recommendation:

```ts
deleteRangeOps(state, {block, startOffset, endOffset, ts})
```

Use one timestamp per deleted char if `ts` is a function, or one shared timestamp if the caller passes a string. Existing insert helpers use a generator because each char gets a distinct Lamport id; visibility ops do not allocate ids, so a single HLC for the batch may be fine. If the codebase convention expects monotonically distinct HLCs per op, use `ts: () => HLC`.

Given existing helper style, prefer:

```ts
ts: () => HLC
```

and emit:

```ts
{type: 'char:delete', id, deleted: {value: true, ts: ts()}}
```

`deleteBlockOps` should also require `ts: () => HLC` or `ts: HLC`. For subtree mode, each emitted block delete should get a timestamp from the generator if using `ts: () => HLC`.

Add restore helpers:

```ts
restoreCharsOps(state, {chars, ts})
restoreBlockOps(state, {block, ts})
restoreBlocksOps(state, {blocks, ts})
```

At minimum, implement helpers used by undo:

- `restoreCharOp(id, ts)` or inline in `undo.ts`,
- `restoreBlockOp(id, ts)` or inline in `undo.ts`.

Public helper naming can be conservative. If unsure, keep restore op creation internal to undo for this phase and expose only after tests demonstrate a caller need.

Update callers in examples/tests that use `deleteRangeOps` or `deleteBlockOps` to pass timestamps.

## Phase 4: Traversal, Formatting, And Cache Call Sites

Replace boolean deletion checks with `isDeleted`.

Known areas:

- `changes.ts`
  - insert/move/delete precondition checks,
  - subtree delete visibility assumptions.
- `traversal.ts`
  - `charToString`,
  - `stateToString`,
  - `visibleBlock`,
  - `visiblePathForBlockId`,
  - `orderedCharIdsForBlock`,
  - `visibleCount`.
- `cache.ts`
  - likely no filtering needed, but type checks may need updates.
- `blocks.ts`, `marks.ts`, `formatting` helpers if they directly inspect `.deleted`.
- Tests and helper functions that filter with `!state.state.blocks[id].deleted`.

Keep the existing hidden-parent behavior:

- Deleted blocks remain in `blockChildren`.
- Visible descendants of deleted blocks are spliced into the nearest visible ancestor by traversal.
- Restoring a block can make those descendants appear nested under it again.

Keep joined behavior unchanged:

- A restored block is still hidden if it appears in `state.cache.joinedBlocks`.
- Join sentinel pseudo-char remains `deleted: {value: true, ts: join.ts}` or adapts through `charRecord` to satisfy the new type.

For synthetic join sentinel chars in `traversal.ts`, return:

```ts
deleted: {value: true, ts: join.ts}
```

## Phase 5: Undo Planning

Update `src/block-crdt/undo.ts`.

Undo inserted chars:

- Same visible behavior as today: emit delete visibility ops for inserted chars that are currently visible.
- Use `{value: true, ts: nextTs()}`.

Undo char deletion:

- Instead of creating replacement chars, emit restore visibility ops for the original char ids from the deleted batch.
- Restore exactly the deleted ops in the batch.
- If the char is missing from `before`, keep the existing unsupported behavior.
- If the char exists but has been moved or has concurrent children, restore the original id and let current parent/children state stand.

Undo block deletion:

- Instead of creating a fresh block and copied text, emit restore visibility ops for the original block ids.
- For subtree delete, this naturally restores only blocks represented by the original `block:delete` ops in the batch.
- If the block is missing from `before`, keep unsupported behavior.
- Do not attempt to unjoin. If a restored block is hidden by `cache.joinedBlocks`, it remains hidden.

Redo behavior:

- Redoing an undo restore should emit delete visibility ops with newer timestamps.
- Existing `planUndoOps(state, undone, undo.ops, ...)` should be covered by tests.

Remove or simplify replacement-specific code only where safe:

- `restoreDeletedChar`
- `restoreDeletedBlock`
- `restoreBlockWithVisibleText`
- mark remapping for replacement chars may no longer be needed for delete undo, but be careful: replacement logic may still be used by undoing other operations. Remove only after tests confirm it is dead.
- `restoreJoinedBlock` should remain unchanged for now because joins are out of scope.

## Phase 6: Tests

Update existing tests for the new operation shape and helper signatures.

Add focused tests for char deletion:

1. `char:delete` with `{value: true}` hides a char.
2. `char:delete` with `{value: false}` restores the same char id.
3. Stale delete does not hide a newer restore.
4. Applying delete then restore vs restore then delete converges by HLC order.
5. Restore preserves a concurrent insert attached to the deleted char.
6. Restore preserves mark boundaries anchored to the deleted char.
7. Retained selections resolve across delete/restore without replacement ids.

Add focused tests for block deletion:

1. `block:delete` with `{value: true}` hides a block.
2. `block:delete` with `{value: false}` restores the same block id.
3. Stale block delete does not hide a newer restore.
4. Restore preserves concurrent block move.
5. Restore preserves concurrent metadata/style changes.
6. Block-only delete restore moves visible descendants back under the restored block.
7. Subtree delete undo restores exactly the blocks in the original delete batch.
8. Restoring a joined block does not make it visible while the join remains active.

Update undo tests:

- `plans undo for deleted chars by inserting fresh replacement chars` should become `plans undo for deleted chars by restoring original char ids`.
- `plans undo for block delete by creating a fresh visible block with copied text` should become `plans undo for block delete by restoring original block id`.
- Add redo test for delete/restore if not already covered.
- Keep join undo tests unchanged or mark as current behavior. This plan does not improve join undo.

Update property/stress tests:

- Any generated raw `Char` or `Block` should use `deleted: undefined` or `{value, ts}`.
- Cache consistency assertions should continue passing.

## Phase 7: Exports And Documentation

Update `src/block-crdt/index.ts` exports:

- Export `DeletedState` if public types are exported there.
- Export any new helper functions if they are meant to be public.
- Export restore helpers only if implemented as public helpers.

Update docs:

- `src/block-crdt/Readme.md`
  - Data model: `deleted?: {value, ts}` instead of boolean tombstone.
  - Operation format: timestamped delete/restore-capable visibility ops.
  - Change helpers: delete helpers now need `ts`.
  - Undo planning: char/block deletion undo now restores original ids; joins still use the old story / remain separate.

Optional:

- Update `research.md` later to remove or clearly mark join sections as deferred.

## Phase 8: Verification

Run focused tests first:

```sh
npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts
```

Then run the broader package test suite if available:

```sh
npm test
```

Also run TypeScript checking / linting if the repo has scripts for them.

## Migration Notes

No production backwards compatibility is required.

Still, this is a broad type change. Expect many compile errors from direct boolean checks. Treat those as useful guidance and convert them through `isDeleted`.

Avoid a compatibility shim like:

```ts
typeof deleted === 'boolean'
```

unless tests or local fixtures require it. Supporting both shapes will make the implementation easier to misuse and is not needed for this task.

## Implementation Order

Recommended sequence:

1. Change types and add `isDeleted` / `deletedStateWins`.
2. Update `apply.ts` until raw visibility ops work.
3. Update traversal/formatting checks to compile.
4. Update delete helper signatures and call sites.
5. Update undo planner to restore original ids.
6. Rewrite affected tests and add convergence/restore tests.
7. Update exports/docs.
8. Run focused tests, then broader verification.

This order keeps the code compiling as early as possible and isolates the semantic change before undo-specific cleanup.
