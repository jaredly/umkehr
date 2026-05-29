# TodoPanel Refactor Plan

## Goals

- Make `examples/react-crdt/src/apps/todos/TodoPanel.tsx` easier to read by splitting unrelated responsibilities into focused todo-local modules.
- Keep behavior and CSS class names stable.
- Keep drag/drop todo-local for now, while shaping it so it can be reused later if another consumer appears.
- Keep row reorder animation separate from drag state so local and remote reorders can both animate.
- Do not add keyboard reorder controls or unit tests for drop math in this task.

## Product And Scope Decisions

- The generic reorder helper can stay under `examples/react-crdt/src/apps/todos/` for this refactor.
- The reorder animation helper should be separate from the drag/drop hook.
- Undo/redo controls remain todo-local.
- The color picker and `pastelColors` remain todo-local.
- Manual smoke coverage is enough for this demo UI, plus the build/typecheck.
- Existing visual behavior should remain unchanged:
  - drag starts from the handle;
  - drag handle is hidden while editing;
  - row drop indicators use existing classes;
  - row animations continue for both local and remote reorder changes;
  - read-only mode blocks all mutations.

## Phase 1: Establish Todo-Local Module Boundaries

Create focused files next to `TodoPanel.tsx`.

Files:

- `examples/react-crdt/src/apps/todos/TodoPanel.tsx`
- `examples/react-crdt/src/apps/todos/TodoList.tsx`
- `examples/react-crdt/src/apps/todos/TodoItem.tsx`
- `examples/react-crdt/src/apps/todos/TodoHistoryControls.tsx`
- `examples/react-crdt/src/apps/todos/TodoColorPicker.tsx` if extracting the color picker reads cleaner

Steps:

1. Move row rendering into `TodoItem.tsx`.
   - Move `TodoItemSlot`.
   - Move `TodoItem`.
   - Move `useDropPosition` only if the drag/drop hook still exposes a drop-target store.
   - Move `isLastEditStatusData`.
   - Move the `hasPathScopedCrdtMeta` guard if it is only used by `TodoItem`.
2. Move history controls into `TodoHistoryControls.tsx`.
   - Move `UndoRedoButtons`.
   - Move `CrdtUndoRedoButtons`.
   - Move `HistoryUndoRedoButtons`.
   - Move `UndoRedoButtonPair`.
   - Move `hasCrdtHistory` and `hasHistory`.
3. Move list mapping into `TodoList.tsx`.
   - Keep `TodoPanel` from knowing about row refs, drop target subscriptions, or drag state after later phases.
   - Keep the existing `editor.$.todos[index]` path pattern.
4. Optionally move the color picker into `TodoColorPicker.tsx`.
   - Keep `pastelColors` todo-local.
   - Preserve preview behavior and `editor.clearPreview()` on mouse leave.

Acceptance:

- `TodoPanel.tsx` reads as panel composition: header, summary, history controls, color picker, add form, and `TodoList`.
- No CSS classes or user-facing labels change in this phase.
- TypeScript imports are acyclic and local to the todo app.

## Phase 2: Extract Reorder State And Pointer Handling

Create a todo-local hook for vertical drag-to-reorder.

Files:

- `examples/react-crdt/src/apps/todos/useTodoReorder.ts`
- `examples/react-crdt/src/apps/todos/TodoList.tsx`
- `examples/react-crdt/src/apps/todos/TodoItem.tsx`

Suggested API:

```ts
export type TodoDropTarget = {id: string; after: boolean};

export function useTodoReorder({
    todos,
    disabled,
    onMove,
}: {
    todos: readonly Todo[];
    disabled: boolean;
    onMove(move: {fromIdx: number; targetIdx: number; after: boolean}): void;
}) {
    // draggingId, dropTargetStore/useDropPosition, registerRow, startDrag
}
```

Steps:

1. Move `DropTarget` and `isNoopMove` into the hook file.
2. Move drag refs into the hook:
   - `rowRefs`
   - `latestTodos`
   - `draggingIdRef`
   - `dropTargetRef`
3. Move `findDropTarget(...)`, `clearDrag(...)`, and pointer listener setup into the hook.
4. Preserve current stale-index protection:
   - track dragged and target rows by stable todo id;
   - resolve `fromIdx` and `targetIdx` from the latest todo array on pointer up.
5. Preserve current no-op behavior before calling `onMove`.
6. Keep the low-rerender drop-target store behavior unless hiding it behind a returned `useDropPosition(id)` makes the call sites cleaner.
7. Wire `TodoList` to call:

```ts
editor.$.todos.$move({fromIdx, targetIdx, after});
```

Acceptance:

- `TodoList` owns reorder wiring, not `TodoPanel`.
- `TodoItem` still only receives the state/callbacks it needs:
  - `isDragging`
  - `dropPosition`
  - `onDragStart`
  - `registerRow`
- Dragging still works with pointer movement outside the list.
- Read-only mode prevents drag start and final move dispatch.

## Phase 3: Extract Reorder Animation

Create a separate hook for row movement animation.

Files:

- `examples/react-crdt/src/apps/todos/useReorderAnimation.ts`
- `examples/react-crdt/src/apps/todos/useTodoReorder.ts`
- `examples/react-crdt/src/apps/todos/TodoList.tsx`

Suggested API:

```ts
export function useReorderAnimation({
    ids,
    getElement,
    durationMs,
}: {
    ids: readonly string[];
    getElement(id: string): HTMLElement | null;
    durationMs: number;
}) {
    // captures previous rects and animates changed top positions
}
```

Steps:

1. Move `reorderAnimationMs` and the `useLayoutEffect(...)` FLIP logic into the animation hook.
2. Keep `prefers-reduced-motion` handling inside the hook.
3. Let the hook receive the same ordered ID list currently used by `TodoPanel`.
4. Use the same row ref source as the reorder hook.
   - If both hooks need row refs, prefer one owner that exposes `registerRow` and `getRowElement`.
5. Preserve current animation semantics:
   - animate rows when their top position changes;
   - skip tiny sub-pixel deltas;
   - no animation when reduced motion is requested.

Acceptance:

- Local reorder still animates.
- Remote/external reorder still animates because the hook depends on ordered IDs, not active drag state.
- The drag/drop hook does not contain animation code.

## Phase 4: Clean Up Panel Composition

After the extractions work, simplify `TodoPanel.tsx`.

Files:

- `examples/react-crdt/src/apps/todos/TodoPanel.tsx`
- Extracted todo files from earlier phases

Steps:

1. Remove drag/drop imports and state from `TodoPanel.tsx`.
2. Keep only panel-level state:
   - `bgcolor`
   - `todoIds` if needed for summary/list, otherwise move into `TodoList`
   - `draftTitle`
3. Extract the add form into a small helper component only if it improves readability.
4. Keep `TodoSummary` either inline in `TodoPanel.tsx` or in its own small file.
5. Keep prop names stable where possible:
   - `editor`
   - `replicaId`
   - `title`
   - `gridSlot`
   - `readOnly`

Acceptance:

- `TodoPanel.tsx` is short enough to scan without understanding DnD internals.
- Todo-specific feature code lives near the feature it implements.
- No exported app API changes are required in `TodoApp.tsx`.

## Phase 5: Verification

Run type/build checks and perform focused manual coverage.

Commands:

```sh
pnpm --dir examples/react-crdt build
```

Run broader tests only if the build or manual smoke checks expose risk:

```sh
pnpm test
pnpm --dir examples/react-crdt test:e2e
```

Manual smoke checks:

- Add a todo.
- Edit a todo title and commit with blur/Enter.
- Cancel title edit with Escape.
- Check and uncheck a todo.
- Delete a todo.
- Drag a todo before and after other rows.
- Drag and release without changing position; no move should dispatch visibly.
- Verify row drop indicators still appear.
- Verify local reorder animation still appears.
- Verify remote/two-panel reorder animation still appears if using a collaborative mode.
- Verify undo/redo for reorder where history is available.
- Verify read-only panels disable add, edit, delete, color changes, and drag.

## Implementation Notes

- Prefer mechanical moves first, then behavior extraction. This keeps diffs reviewable.
- Avoid renaming CSS classes in `examples/react-crdt/src/style.css`.
- Keep `TodoItemSlot` or an equivalent row subscription boundary. It avoids unnecessary whole-list rendering and should not be flattened into a single list render.
- Keep updater paths (`Updater<Todo>`) flowing into row components. This matches the existing example style and avoids a layer of command callbacks.
- Keep drag target updates out of React state for every row. The existing external store approach is there to limit rerenders during pointer movement.
- Keep cleanup paths explicit for `pointerup`, `pointercancel`, unmount, and disabled/read-only changes.

## Out Of Scope

- Keyboard reorder controls.
- A shared reorder library under `examples/react-crdt/src/lib/`.
- A full drag/drop framework abstraction.
- New unit tests for drop-target math.
- Generic undo/redo controls for all example apps.
- Shared color picker abstractions.
