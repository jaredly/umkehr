# Todo drag-to-reorder plan

## Goal

Add drag-to-reorder to `examples/react-crdt` Todo app using the object-form `$move` API:

```ts
editor.$.todos.$move({fromIdx, targetIdx, after})
```

The implementation should live in the Todo example UI, work across the existing solo/history and
CRDT runtimes, support desktop and mobile pointer input, hide the drag handle while a title is being
edited, and animate local and remote reorder changes if feasible.

## Confirmed decisions

- Use `$move({fromIdx, targetIdx, after})`; the API is available in the workspace.
- Do not extend `$reorder`.
- Do not add keyboard up/down reorder controls in this pass.
- Use an explicit drag handle, not row-wide dragging.
- Show the drag handle only on row hover/focus.
- Hide the drag handle while that row's title is being edited.
- Include mobile/touch support.
- Add local and remote reorder animation if it can be done cleanly in the example.

## Implementation steps

### 1. Add drag state to `TodoPanel`

In `examples/react-crdt/src/apps/todos/TodoPanel.tsx`:

- Track the active drag by todo ID, not by array index.
- Track the current drop target as `{id: string; after: boolean}`.
- Keep refs for the list item elements keyed by todo ID.
- Clear all drag state on drop, cancel, pointer up, and component-level cleanup.

Use todo IDs because indexes can become stale after local edits, remote sync, deletes, or concurrent
reorders.

### 2. Implement pointer-based dragging

Prefer pointer events over native HTML drag/drop so the same implementation works on desktop and
mobile:

- Add a handle button/span inside each todo row.
- On `pointerdown` on the handle:
  - ignore non-primary pointer events;
  - do nothing while the item is being edited;
  - store the dragged todo ID;
  - capture the pointer;
  - mark the row as dragging after a small movement threshold if needed.
- On `pointermove`:
  - use `document.elementFromPoint` or row bounding rects to find the row under the pointer;
  - compute `after` from the pointer's position relative to the target row midpoint;
  - update the drop indicator.
- On `pointerup`:
  - find `fromIdx` from the latest `todos` array by dragged ID;
  - find `targetIdx` from the latest `todos` array by target ID;
  - skip no-op placements;
  - call `editor.$.todos.$move({fromIdx, targetIdx, after})`;
  - clear drag state.

Keep click/edit/delete behavior unchanged by limiting pointer handlers to the drag handle.

### 3. Preserve row actions and editing behavior

Update `TodoItem` props so it can receive drag state and callbacks from `TodoPanel`.

While `editingTitle !== null`:

- hide or disable the drag handle for that row;
- keep title commit/cancel behavior unchanged;
- continue to use the current `index` for title, done, and delete actions.

When not editing:

- render the drag handle before the checkbox/title area or at the start of `itemActions`;
- expose a short accessible label such as `Move todo`;
- prevent the handle from submitting forms or stealing edit/delete clicks.

### 4. Add drop indicator styling

In `examples/react-crdt/src/style.css`:

- Add a compact `.dragHandle` style that is visible on `.todoItem:hover`, `.todoItem:focus-within`,
  and while dragging.
- Add `.todoItem.dragging` for opacity/outline/cursor state.
- Add `.todoItem.dropBefore` and `.todoItem.dropAfter` indicators using top/bottom borders or
  pseudo-elements.
- Ensure mobile hit target size is reasonable even if the handle is visually subtle on desktop.

Avoid row-wide layout shifts when the handle appears. Reserve a fixed column for the handle.

### 5. Add reorder animation

Use a lightweight FLIP-style animation in `TodoPanel`:

- Before React commits a changed `todos` order, record each row's previous bounding rect.
- After render, compare previous and next rects for rows with the same todo ID.
- For rows whose vertical position changed, temporarily apply a `transform` from old position to
  new position and transition back to `transform: none`.

This should animate both local moves and remote reorders because both arrive as changes to the
materialized `todos` order.

Implementation notes:

- Use `useLayoutEffect` for measuring and applying transforms.
- Respect `prefers-reduced-motion: reduce` and skip animations.
- Keep animation code local to `TodoPanel.tsx`; do not introduce a dependency unless pointer
  dragging proves too brittle.

### 6. Handle no-op and edge cases

Do not dispatch `$move` when:

- no dragged row or target row exists;
- dragged ID cannot be found in the latest `todos`;
- target ID cannot be found in the latest `todos`;
- `fromIdx === targetIdx`;
- the requested before/after placement would leave the item in the same visible position.

Also test behavior after a row is deleted during or before a drag. The safe result is to clear drag
state without dispatching a move.

### 7. Verification

Run:

```sh
pnpm --dir examples/react-crdt build
```

Manual smoke test:

- Drag rows with a mouse/trackpad.
- Drag rows with touch or mobile emulation.
- Drag before and after adjacent and non-adjacent rows.
- Verify Edit/Delete/checkbox interactions still target the intended row.
- Verify handle is hidden while editing a title.
- Verify reorder in solo/history mode.
- Verify reorder in CRDT/local-first or two-panel mode.
- Verify undo/redo after local reorder.
- Verify local and remote reorder animations are visible unless reduced motion is enabled.

## Out of scope

- Keyboard reorder controls.
- New `$reorder` API forms.
- New CRDT operation types.
- Adding a drag-and-drop library unless pointer events prove insufficient.
