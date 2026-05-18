# Todo drag-to-reorder research

This note covers implementing drag-to-reorder in the `examples/react-crdt` Todo app.

## Current Todo app shape

The Todo app lives in `examples/react-crdt/src/apps/todos`.

- `model.ts` defines `TodoState` as `{bgcolor: string; todos: Todo[]}`.
- `TodoPanel.tsx` renders the list and already receives an `AppEditorContext<TodoState>`.
- Adds use `editor.$.todos.$push(...)`.
- Field edits use array indexes, for example `editor.$.todos[index].done(...)`.
- Deletes use `editor.$.todos[index].$remove()`.
- The panel is reused by solo/history and CRDT-backed runtimes through `TodoApp.tsx`.

So reorder should be implemented in `TodoPanel.tsx` and remain runtime-agnostic.

## Existing reorder support

The core patch builder already exposes array reorder:

```ts
editor.$.todos.$reorder(indices)
```

`indices` is a full permutation where each output position points at the old index. For example,
`[1, 0, 2]` swaps the first two items.

Relevant code:

- `src/types.ts` exposes `$reorder(indices: number[], when?: ApplyTiming)` for arrays.
- `src/helper.ts` creates draft patches with `{op: 'reorder', path, indices}`.
- `src/make.ts` validates that reorder indices are a full permutation of the current array.
- `src/ops.ts` applies reorder by replacing the array with `indices.map((index) => value[index])`.
- `src/crdt/updates.ts` translates reorder patches into CRDT `setOrder` updates.

Important: `editor.$.todos.$move(from, to)` exists in the generic patch API, but CRDT update
creation explicitly rejects `move` with `CRDT updates do not support move. Use remove plus add
instead.` The Todo app should use `$reorder`, not `$move`.

## CRDT behavior

CRDT arrays are stored as stable item IDs plus fractional order strings.

- `materialize.ts` sorts live array items by `item.order.value`, then by item ID as a tie-breaker.
- `updates.ts` turns a reorder patch into one `setOrder` update.
- `apply.ts` applies newer order timestamps per item.
- Undo/redo support tracks `setOrder` effects in local command history.
- Local-first vector helpers already include `setOrder` timestamps.

This means drag-to-reorder does not require a new replicated operation. It can be a UI feature that
dispatches a normal reorder patch.

One caveat: current `createReorderUpdate` assigns fresh order strings to every live item in the
array, not only the dragged item. That is simple and already tested, but it means every reorder
touches all live items. For the small Todo demo that is acceptable.

## Recommended API extension

The current `$reorder(indices)` API is correct but awkward for drag/drop. A drag interaction usually
produces:

```ts
{idx: number; targetIdx: number; after: boolean}
```

That means "move the item currently at `idx` before or after the item currently at `targetIdx`."
This is a better app-facing form than asking every UI to build a full permutation.

Recommended type shape:

```ts
type ReorderMove = {
    idx: number;
    targetIdx: number;
    after: boolean;
};

type ReorderSpec = number[] | ReorderMove;
```

Then expose:

```ts
editor.$.todos.$reorder(indices)
editor.$.todos.$reorder({idx, targetIdx, after})
```

Internally, normalize the object form to the existing full `indices` permutation during draft
realization in `src/make.ts`. That keeps the realized `Patch` shape unchanged:

```ts
{op: 'reorder', path, indices: number[]}
```

Keeping realized patches in the old form has several advantages:

- `ops.apply`, `ops.invert`, history, and CRDT update creation can remain unchanged.
- Validation of replicated/raw patches can continue to require `indices: number[]`.
- The object form is limited to the patch builder/draft convenience layer.
- Undo/redo remains based on the canonical permutation.

Normalization helper:

```ts
function reorderMoveToIndices(length: number, move: ReorderMove): number[] {
    const {idx, targetIdx, after} = move;
    if (
        !Number.isInteger(idx) ||
        !Number.isInteger(targetIdx) ||
        idx < 0 ||
        targetIdx < 0 ||
        idx >= length ||
        targetIdx >= length
    ) {
        throw new Error('Cannot reorder: idx and targetIdx must point at array items.');
    }
    if (idx === targetIdx) return Array.from({length}, (_, index) => index);

    const indices = Array.from({length}, (_, index) => index);
    const [moved] = indices.splice(idx, 1);
    const targetPosition = indices.indexOf(targetIdx);
    indices.splice(targetPosition + (after ? 1 : 0), 0, moved);
    return indices;
}
```

Examples for `[A, B, C, D]`:

- `{idx: 1, targetIdx: 2, after: true}` -> `[0, 2, 1, 3]` -> `[A, C, B, D]`
- `{idx: 3, targetIdx: 0, after: false}` -> `[3, 0, 1, 2]` -> `[D, A, B, C]`
- `{idx: 1, targetIdx: 2, after: false}` is a no-op in visible order because `B` is already before
  `C`; it can normalize to identity or the equivalent unchanged permutation.

Files that would need code changes:

- `src/types.ts`: add `ReorderMove`/`ReorderSpec`, make draft reorder accept `ReorderSpec`, and make
  `$reorder` accept `ReorderSpec`.
- `src/helper.ts`: pass the argument as a reorder spec instead of assuming `indices`.
- `src/make.ts`: normalize object specs to canonical `indices: number[]` and keep existing
  permutation validation.
- `src/helper.test.ts` / `src/core.test.ts`: cover object-form reorder and no-op/invalid cases.

Open design point: whether the public `ReorderOp` type should also accept the object form. My
recommendation is no: keep `ReorderOp` canonical and add a separate draft-only type. That prevents
raw patches, validation, persistence, and CRDT replication from gaining a second semantic encoding.

## Recommended Todo implementation

Use a small focused drag implementation in `TodoPanel.tsx`, backed by `$reorder`.

Recommended behavior:

1. Track the dragged todo by stable `todo.id`, not by the starting index alone.
2. Track the current drop target index while dragging.
3. On drop, read the latest `todos` array from the current render and find both indexes by ID.
4. Call `editor.$.todos.$reorder({idx, targetIdx, after})` only when the resulting order differs.

If the core API extension is not implemented first, Todo can use a local helper to convert the same
object shape into the existing full permutation and call `editor.$.todos.$reorder(indices)`.

## UI approach

The repo does not currently depend on a drag-and-drop library, and
`examples/react-crdt/package.json` has no React DnD dependency. For this demo, native HTML drag
events are likely enough:

- Add `draggable` to each `li`.
- Use `onDragStart` to store the dragged todo ID and set `effectAllowed = 'move'`.
- Use `onDragOver` to `preventDefault()` and update the current target.
- Use `onDrop` on each row, or on the list, to compute and apply the reorder.
- Use `onDragEnd` to clear drag state.

CSS can stay local to existing Todo classes:

- `.todoItem.dragging` for opacity/outline.
- `.todoItem.dropBefore` / `.todoItem.dropAfter` or a single insertion indicator.
- Optional `.dragHandle` button/span if drag should not start from the whole row.

Using a drag handle is safer than making the entire row a drag source because rows already contain
checkboxes, text inputs, Edit, and Delete buttons. A handle also avoids accidental drags while
checking or editing todos.

## Accessibility

Native drag and drop is weak for keyboard users. If this is meant to be more than a demo polish
feature, add keyboard reorder controls too.

Low-cost option:

- Add up/down buttons in `itemActions`.
- Disable "move up" on the first item and "move down" on the last item.
- Implement them with the same permutation helper and `$reorder`.

This also gives a useful fallback for touch/mobile browsers, where native HTML drag events can be
inconsistent.

## Testing

Recommended tests if implementing this:

- Add a focused unit test for the permutation helper if it is extracted.
- Add or extend CRDT tests only if changing `createReorderUpdate`; pure UI work should not need CRDT
  core changes.
- Run `pnpm --dir examples/react-crdt build` to typecheck and build the demo.
- Manual smoke test in the local app:
  - reorder in solo/history mode;
  - reorder in local/CRDT mode with two panels;
  - reorder after deleting an item;
  - edit/check/delete still target the intended row after reorder;
  - undo/redo a reorder.

## Open questions

- Should drag be row-wide, or should there be an explicit drag handle? Recommendation: explicit
  handle.
- Should the first implementation include keyboard up/down reorder controls? Recommendation: yes if
  this is intended as a polished example, no if the goal is only to exercise CRDT reorder.
- Should touch/mobile reorder be supported now? Native HTML drag is not a great mobile story; a
  library such as `@dnd-kit` would be better if mobile is important.
- Should `$reorder({idx, targetIdx, after})` be accepted only as a draft-builder convenience, or as
  a persisted/raw `ReorderOp` too? Recommendation: draft-builder only; canonical patches should
  still use `indices`.
- Is touching every item order on each reorder acceptable long term? It is fine for the Todo demo,
  but a larger app might want a CRDT helper that only changes the moved item's fractional index.
- Should reordering be disabled while a title input is being edited? Recommendation: keep the drag
  handle disabled or hidden for the currently edited row to avoid blur/drop edge cases.
- Should remote concurrent reorders be explained visually in the demo? Current CRDT semantics merge
  by per-item order timestamp; no extra UI is needed, but concurrent drag behavior may surprise
  users in two-panel demos.
