# Array Move Operation Plan

## Goal

Change `move` from an arbitrary path-to-path patch:

```ts
{op: 'move', from: Path, path: Path}
```

to an array-local reorder patch:

```ts
{op: 'move', path: Path, fromIdx: number, targetIdx: number, after: boolean}
```

`path` points to the array being reordered. `fromIdx` identifies the item to move in the current array. `targetIdx` identifies the item to place the moved item before or after. `after` selects whether the moved item is inserted after (`true`) or before (`false`) the target item.

There are no current umkehr users, so this can be a breaking semantic change without a compatibility layer.

## Semantics To Lock Down

- `move` only applies to arrays.
- `fromIdx` and `targetIdx` are indexes in the array before the move.
- Indexes must be integers in `[0, array.length)`.
- Moving an item relative to itself is a no-op.
- The operation preserves the moved element identity by reordering the array, not by removing and re-adding at a value path.
- Inversion should express the reverse move with the new post-move index of the moved element and the original neighbor-relative target.

Implementation sketch:

```ts
function moveArrayItem<T>(items: T[], fromIdx: number, targetIdx: number, after: boolean): T[] {
    if (fromIdx === targetIdx) return items;

    const next = items.slice();
    const [moved] = next.splice(fromIdx, 1);
    const targetPosition = targetIdx > fromIdx ? targetIdx - 1 : targetIdx;
    const insertIdx = targetPosition + (after ? 1 : 0);
    next.splice(insertIdx, 0, moved);
    return next;
}
```

Equivalent index-permutation helper, useful for testing and inversion logic:

```ts
const indices = items.map((_, index) => index);
const [moved] = indices.splice(fromIdx, 1);
const targetPosition = targetIdx > fromIdx ? targetIdx - 1 : targetIdx;
indices.splice(targetPosition + (after ? 1 : 0), 0, moved);
return indices.map((index) => items[index]);
```

## Implementation Tasks

1. Update public types in `src/types.ts`.
   - Change `MoveOp<_T>` to `{op: 'move'; path: Path; fromIdx: number; targetIdx: number; after: boolean}`.
   - Keep `MoveOp` in both `Patch<T>` and `DraftPatch<T>`.
   - Restrict `$move` to array builders only.
   - Remove `$move` from object builders, since the new operation is specifically "move within an array".
   - Change the array builder signature to:

```ts
type ArrayMove = {fromIdx: number; targetIdx: number; after: boolean};

$move(move: ArrayMove, when?: ApplyTiming): R;
```

2. Update builder output in `src/helper.ts`.
   - `$move({fromIdx, targetIdx, after}, when)` should emit `{op: 'move', path, fromIdx, targetIdx, after, ...ghost}`.
   - Remove string-to-number path-segment normalization for `$move`; indexes are numeric fields now.
   - Because TypeScript only exposes `$move` on arrays, runtime helper code can still create the method generically, but tests should cover that only array builder usage is public.

3. Update core operation behavior in `src/ops.ts`.
   - Replace the current remove-plus-add implementation with array reorder logic at `op.path`.
   - Error when `path` does not resolve to an array.
   - Validate integer and range preconditions before applying.
   - Apply via `_replace(base, op.path, currentArray, movedArray, equal)` so immutable ancestor cloning and previous-value checking stay consistent with existing internals.
   - Update `rebase()` for `move` to only prepend to `op.path`; there is no `from` path anymore.
   - Update `invertPatch()` for `move`.

Suggested inversion algorithm:

```ts
const movedPostIdx =
    op.targetIdx > op.fromIdx
        ? op.targetIdx - (op.after ? 0 : 1)
        : op.targetIdx + (op.after ? 1 : 0);

const inverse =
    movedPostIdx === op.fromIdx
        ? op
        : {
              ...op,
              fromIdx: movedPostIdx,
              targetIdx: op.fromIdx,
              after: op.fromIdx > movedPostIdx,
          };
```

This does not require array length because the inverse move can target the original index in the post-move array. If the original index is before the moved item's post-move index, move before that index. If it is after the moved item's post-move index, move after that index.

4. Update draft realization in `src/make.ts`.
   - `realizeDraftPatch()` should check that `path` resolves to an array.
   - Validate `fromIdx` and `targetIdx` bounds at realization time for better errors.

5. Update validation in `src/validation/index.ts`.
   - Envelope validation for `move` should require integer `fromIdx`, integer `targetIdx`, and boolean `after`.
   - Remove `from` path validation.
   - Schema validation should require `path` to point to an array, similar to `reorder`.
   - Remove the old source/destination compatibility check and replace tests/messages with array-target checks.

6. Update changed-path tracking.
   - In `src/framework-core/index.ts` and `src/history/history.ts`, remove `op.from` from `move` handling.
   - A move changes the array at `op.path`. If index-level subscriptions are expected to refresh, consider notifying the array path plus affected child index paths. Today `reorder` only reports `op.path`, so match that behavior unless tests show otherwise.

7. Update CRDT behavior in `src/crdt/updates.ts`.
   - It currently rejects `move`; keep rejecting it unless this task intentionally adds CRDT support.
   - Update the error text from "Use remove plus add instead" if the recommendation is no longer accurate for array identity-preserving moves.

8. Update docs.
   - `Readme.md`: change the `$move` API table and patch operation description.
   - `CONTRIBUTING.md`: replace the remove-plus-add explanation with array-local semantics.
   - Any task/research docs do not need to be rewritten unless they are actively misleading for current development.

## Tests

Update or add tests in:

- `src/helper.test.ts`
- `src/core.test.ts`
- `src/validation/validation.test.ts`
- `type-tests/patch-builder.ts`

Core behavior cases:

- `$move({fromIdx: 0, targetIdx: 2, after: true})` on `['a', 'b', 'c']` yields `['b', 'c', 'a']`.
- `$move({fromIdx: 0, targetIdx: 2, after: false})` on `['a', 'b', 'c']` yields `['b', 'a', 'c']`.
- `$move({fromIdx: 2, targetIdx: 0, after: false})` on `['a', 'b', 'c']` yields `['c', 'a', 'b']`.
- `$move({fromIdx: 2, targetIdx: 0, after: true})` on `['a', 'b', 'c']` yields `['a', 'c', 'b']`.
- Moving an item relative to itself is a no-op and still returns a valid realized patch.
- Duplicate values move by index, not by value identity.
- Inverting a realized move restores the original array.
- Nested updates rebase `move.path` correctly.

Failure cases:

- `path` points to a non-array.
- `fromIdx` is out of range.
- `targetIdx` is out of range.
- any index is non-integer.
- `after` is not boolean in validator input.
- object builders no longer expose `$move` in type tests.

Validation cases:

- valid array move patch passes schema validation.
- move patch against an object path fails with an array-target message.
- old `{from, path}` shape fails envelope validation.

## Suggested Order

1. Update `MoveOp` and builder types.
2. Update `$move` builder output.
3. Implement array move apply/realize/invert/rebase.
4. Update validation.
5. Update changed-path tracking and CRDT error text.
6. Update tests.
7. Update docs.
8. Run `pnpm test` and `pnpm typecheck` or the equivalent package scripts in `package.json`.
