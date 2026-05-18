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

## Existing reorder/move support

The core patch builder currently exposes array reorder:

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

There is also a generic `$move(from, to)` API today, but CRDT update creation currently rejects
`move`. Another agent is changing `$move` to support a drag/drop-friendly signature:

```ts
editor.$.todos.$move({fromIdx, targetIdx, after})
```

For the Todo work, assume that updated `$move` is the intended high-level array positioning API and
that it will produce CRDT-compatible reorder semantics rather than remove/add semantics.

## CRDT behavior

CRDT arrays are stored as stable item IDs plus fractional order strings.

- `materialize.ts` sorts live array items by `item.order.value`, then by item ID as a tie-breaker.
- `updates.ts` turns a reorder patch into one `setOrder` update.
- `apply.ts` applies newer order timestamps per item.
- Undo/redo support tracks `setOrder` effects in local command history.
- Local-first vector helpers already include `setOrder` timestamps.

This means drag-to-reorder should not require a new replicated operation. It can be a UI feature
that dispatches the updated `$move({fromIdx, targetIdx, after})`, provided that the core `$move`
change lowers array moves to the existing CRDT `setOrder` behavior.

One caveat: current `createReorderUpdate` assigns fresh order strings to every live item in the
array, not only the dragged item. That is simple and already tested, but it means every reorder
touches all live items. For the small Todo demo that is acceptable.

## Expected `$move` API

The Todo implementation should use the new object-form `$move` API:

```ts
editor.$.todos.$move({fromIdx, targetIdx, after})
```

Semantics:

- `fromIdx`: current index of the dragged item.
- `targetIdx`: current index of the row being targeted.
- `after`: whether the dragged item should land after the target row. If false, it lands before the
  target row.

Examples for `[A, B, C, D]`:

- `{fromIdx: 1, targetIdx: 2, after: true}` moves `B` after `C`, yielding `[A, C, B, D]`.
- `{fromIdx: 3, targetIdx: 0, after: false}` moves `D` before `A`, yielding `[D, A, B, C]`.
- `{fromIdx: 1, targetIdx: 2, after: false}` is a visible no-op because `B` is already before `C`.

Todo should not implement its own full-permutation reorder helper unless the `$move` core work is
not available when this task is implemented.

## Recommended Todo implementation

Use a small focused drag implementation in `TodoPanel.tsx`, backed by the updated `$move` API.

Recommended behavior:

1. Track the dragged todo by stable `todo.id`, not by the starting index alone.
2. Track the current drop target index while dragging.
3. On drop, read the latest `todos` array from the current render and find both indexes by ID.
4. Call `editor.$.todos.$move({fromIdx, targetIdx, after})` only when the resulting order differs.

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
- Implement them with `$move({fromIdx, targetIdx, after})`.

This also gives a useful fallback for touch/mobile browsers, where native HTML drag events can be
inconsistent.

## Testing

Recommended tests if implementing this:

- Add UI-level tests only if this example has an established UI test harness.
- Add or extend core tests in the `$move` task, not in the Todo task, to verify that object-form
  array moves produce CRDT-compatible reorder behavior.
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
- Will the new `$move({fromIdx, targetIdx, after})` API be available before Todo reorder work starts?
  If not, Todo should wait rather than adding a temporary local `$reorder` adapter.
- Is touching every item order on each reorder acceptable long term? It is fine for the Todo demo,
  but a larger app might want a CRDT helper that only changes the moved item's fractional index.
- Should reordering be disabled while a title input is being edited? Recommendation: keep the drag
  handle disabled or hidden for the currently edited row to avoid blur/drop edge cases.
- Should remote concurrent reorders be explained visually in the demo? Current CRDT semantics merge
  by per-item order timestamp; no extra UI is needed, but concurrent drag behavior may surprise
  users in two-panel demos.
