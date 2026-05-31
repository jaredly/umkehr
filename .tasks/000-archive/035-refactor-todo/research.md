# TodoPanel Refactor Research

## Task

`examples/react-crdt/src/apps/todos/TodoPanel.tsx` has grown into a mixed UI, data, drag-and-drop, animation, history, presence, and CRDT-metadata component. Refactor it into smaller units so the todo app is easier to read and so the drag/drop machinery can be reused.

## Current Shape

`TodoPanel.tsx` currently owns several distinct responsibilities:

- Panel composition, title, grid placement, color picker, add form, and todo list rendering.
- Todo summary calculation.
- Undo/redo capability detection for both history and CRDT editors.
- Drag-to-reorder state, DOM row registration, drop target detection, pointer listeners, no-op move detection, and `$move(...)` dispatch.
- Reorder animation via FLIP-style `getBoundingClientRect()` snapshots and `element.animate(...)`.
- Per-row subscription through `TodoItemSlot`, including the `useSyncExternalStore` drop-target subscription.
- Todo row rendering, inline title editing, checkbox updates, delete, title blame tooltip, and recent editor presence avatars.
- Local type guards for CRDT editor features and server last-edit status data.

The file is about 560 lines. The most intertwined section is the top-level component: `TodoPanel` holds both user-facing panel state (`draftTitle`) and drag/reorder implementation details (`draggingId`, `dropTargetStore`, row refs, previous rects, latest todos, and drag refs).

## Drag And Reorder Details

The current implementation is pointer-event based, not native HTML drag/drop:

- Drag starts from an explicit handle.
- `setPointerCapture(...)` is called on the handle.
- Window-level `pointermove`, `pointerup`, and `pointercancel` listeners keep tracking after the pointer leaves a row.
- The drop target is computed from live row DOM rects and the pointer `clientY`.
- The dragged item and target are tracked by stable todo IDs, then resolved to current indexes on drop.
- Reorder dispatch uses `editor.$.todos.$move({fromIdx, targetIdx, after})`.
- `isNoopMove(...)` avoids dispatching moves that would not visibly change order.
- `useLayoutEffect(...)` animates any row whose previous and next top positions differ.

Core `$move` support is already present in `src/types.ts` and `src/ops.ts`, with object-form `{fromIdx, targetIdx, after}` semantics. Existing tests also exercise `$move` in React/history contexts.

This DnD implementation is a good candidate for extraction because the only todo-specific pieces are:

- how to read the latest ordered items;
- how to get a stable item ID;
- how to perform the final move;
- what element type the list rows use.

## Recommended Refactor

Keep `TodoPanel.tsx` as the composition entry point, but move most implementation detail into focused files under `examples/react-crdt/src/apps/todos/` plus one generic helper under `examples/react-crdt/src/lib/`.

Suggested split:

- `TodoPanel.tsx`
  - Keep the exported `TodoPanel` and high-level layout only.
  - Own `draftTitle`, `bgcolor`, `todoIds`, and the add/color actions.
  - Render extracted `TodoToolbar`/color picker, `TodoList`, and undo/redo controls.

- `TodoList.tsx`
  - Own mapping `todoIds` to `TodoItemSlot`.
  - Wire the generic reorder hook to todo-specific `$move`.
  - Pass row registration, drag state, and drop target state to items.

- `TodoItem.tsx`
  - Own `TodoItemSlot`, `TodoItem`, inline title editing, checkbox/delete/edit actions, title blame, and presence cursors.
  - Keep row-specific CRDT/presence logic out of the panel.

- `TodoHistoryControls.tsx`
  - Own `UndoRedoButtons`, `CrdtUndoRedoButtons`, `HistoryUndoRedoButtons`, `UndoRedoButtonPair`, and history capability type guards.

- `TodoSummary.tsx` or inline small component
  - Optional. It is small enough to stay near `TodoPanel`, but extracting it makes the panel purely structural.

- `../../lib/reorder/useReorderableList.ts`
  - Extract reusable pointer-driven vertical list reorder behavior.
  - Return `draggingId`, `dropTargetStore` or an equivalent per-item selector, `registerRow`, `startDrag`, and list class state.
  - Accept generic item data and callbacks instead of importing todo types.

- `../../lib/reorder/reorderAnimation.ts` or a hook
  - Extract row-rect snapshot animation, probably as `useReorderAnimation(ids, rowRefs, options)`.
  - Keep `prefers-reduced-motion` handling in the helper.

The first pass can be conservative: extract todo-specific components first, then extract generic reorder hooks once the boundaries are visible. This reduces risk because `TodoPanel` currently mixes generic and app-specific concerns in the same closure.

## Reusable Reorder Hook Shape

A practical generic API could look like this:

```ts
type ReorderTarget<Id extends string> = {id: Id; after: boolean};

function useVerticalReorder<Id extends string, Item>({
    items,
    getId,
    disabled,
    onMove,
}: {
    items: readonly Item[];
    getId(item: Item): Id;
    disabled?: boolean;
    onMove(move: {fromIdx: number; targetIdx: number; after: boolean}): void;
}) {
    // returns draggingId, registerRow, startDrag, dropTargetStore/drop selector
}
```

Notes:

- The hook should keep the current "resolve indexes from latest items on drop" behavior. This matters for CRDT/local-first demos because remote edits can change ordering during a drag.
- `onMove` should receive indexes, not patch builders. That keeps the helper independent of umkehr and reusable outside the todo app.
- The hook should expose enough state for CSS classes, but avoid forcing todo-specific class names.
- If `ExternalStore` stays in the public return shape, keep it typed generically and document that it is used to avoid rerendering every row on each pointer move.

## Component Boundary Notes

`TodoItemSlot` exists for a real reason: it subscribes each row by index/path and separately subscribes only the row matching the current drop target. Keep that render-performance behavior when moving code.

`TodoItem` should probably continue to receive an `Updater<Todo>` instead of command callbacks for every field. The local pattern in this example app uses updater paths directly, and wrapping every operation would add noise without much benefit.

The title blame and presence logic are row concerns. Moving them with `TodoItem` avoids leaving CRDT-specific details in `TodoPanel`.

The history controls are independent of todos except for the `TodoState` type. They could become generic later, but for this task a todo-local extraction is lower risk.

## Styling Impact

The existing CSS already has classes for drag state:

- `.todoList.draggingList`
- `.todoItem.dragging`
- `.todoItem.dropBefore`
- `.todoItem.dropAfter`
- `.dragHandle`
- `.dragHandleSpacer`

The refactor should avoid class renames unless there is a clear reason. Keeping class names stable makes the refactor easier to review and lowers UI regression risk.

## Testing Notes

Recommended checks after implementation:

- `pnpm --dir examples/react-crdt build`
- Existing relevant tests, especially React/history and CRDT move coverage:
  - `pnpm test` at the repo root if time allows.
  - `pnpm --dir examples/react-crdt test:e2e` only if the change touches behavior beyond component boundaries or if a browser smoke test finds an issue.

Manual smoke checks:

- Add, edit, check, and delete still update the intended row.
- Drag reorder works in solo/history mode.
- Drag reorder works in CRDT/local or two-panel modes.
- Undo/redo a reorder still works where history is available.
- Drag handle stays hidden while editing a title.
- Drop indicators and row animation still appear for local and remote reorders.
- Read-only panels do not allow add, edit, delete, color changes, or drag moves.

## Risks

- Accidentally changing subscription granularity can make every todo row rerender during pointer movement.
- Extracting DnD without preserving latest-item refs can dispatch a move using stale indexes if a remote update lands during a drag.
- `useLayoutEffect` animation depends on row refs and ordered IDs being updated in the right order; moving it into a hook needs careful dependency handling.
- Pointer capture is set on the drag handle while movement is tracked on `window`; this currently works, but extracted code should preserve cleanup on `pointerup`, `pointercancel`, unmount, and read-only changes.
- Generic helpers can become over-abstracted. The first reusable target should be "vertical reorderable list", not a complete drag/drop framework.

## Open Questions

- Should the generic reorder helper live in `examples/react-crdt/src/lib/reorder/`, or should it stay todo-local until a second consumer exists?
  - todo-local is fine
- Should the row animation helper be bundled into the reorder hook, or kept separate so non-drag remote reorders can use it without drag state?
  - if it's currently separate, keep it separate
- Should the extracted hook expose the existing `ExternalStore<DropTarget | null>` model, or hide it behind `useDropPosition(id)` returned from the hook?
  - use your judgement
- Should keyboard reorder controls be added during this refactor, or kept out of scope because the current task is readability/reuse rather than new behavior?
  - out of scope
- Should undo/redo controls become a generic shared component for all example apps, or remain todo-local for now?
  - remain todo-local for now
- Should `pastelColors` and color picker be extracted into todo-specific UI only, or is there a broader app-level color picker pattern worth sharing later?
  - todo-local for now
- Do we want unit tests for the extracted drop-target math, or is manual/browser coverage enough for this demo UI?
  - manual coverage is enough
