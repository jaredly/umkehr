# Plan: Unified Block Markers and Drag Handles

## Scope

Implement this in `examples/block-rich-text` only. No `src/block-crdt` API changes appear necessary: block type, depth, list numbering, table membership, and move commands are already available at the example layer. The work is primarily React rendering, drag gesture handling, CSS layout, and UI tests.

## Phase 1: Refactor the Block Affordance Slot

Update `EditableBlock` in `examples/block-rich-text/src/App.tsx` so each normal block renders one leading affordance slot instead of separate drag-handle and marker columns.

- Remove the standalone leading `.dragHandle` button from normal block rows.
- Expand `BlockAffordance` to receive `blockId`, `isTableCell`, `listNumber`, `meta`, `onStartDrag`, and `onToggleTodo`.
- For table-cell blocks, preserve current behavior: no block-level move affordance inside cells.
- For unordered and ordered list items, render the marker itself as the drag source.
- For paragraph/heading/code/callout/blockquote/table-title style rows with no list marker, render an empty-slot drag handle that is hidden until row hover/focus/focus-within.
- Keep `aria-label="Move block"` on draggable list markers and fallback handles so existing role-based tests can still find them.
- Keep keyboard reorder out of scope for now; marker buttons can remain pointer drag affordances.

## Phase 2: Support Todo Checkbox Drag Without Breaking Toggle

Change `useBlockReorder` so todo checkboxes can be both toggle controls and drag sources.

- Introduce a pending drag state on pointer down instead of immediately starting the drag.
- Start the actual drag only after pointer movement passes a small threshold.
- If pointer up happens before the threshold, treat it as a normal click so the checkbox can toggle.
- Keep existing immediate-feeling behavior for list markers and fallback handles by using the same threshold path; a small threshold should not be noticeable for real drags.
- Ensure `event.preventDefault()` is applied only when a drag actually begins, so checkbox click/toggle is not suppressed.
- Preserve subtree drag, drop target resolution, no-op detection, and pointer cancel behavior.

Implementation detail: `startDrag(id, event)` can keep the same public signature and internalize the pending-vs-active distinction. That avoids changing all existing call sites except for the new affordance component.

## Phase 3: CSS Layout and States

Update `examples/block-rich-text/src/style.css` to collapse the bulky two-control layout.

- Change normal `.blockRow` from four columns to three columns: affordance, content, inline controls.
- Replace or retire `.blockMarker`, `.todoToggle`, and `.dragHandle` styling as needed with a unified affordance class set.
- Keep the leading slot dimensions stable so content does not shift when a fallback handle appears.
- Add hover/focus-visible styling for all draggable markers: bullets, ordered numbers, todo checkbox/slot, and fallback handles.
- Show fallback handles on `.blockRow:hover`, `.blockRow:focus-within`, and direct handle focus.
- Re-check `.blockRow.dropBefore::before` and `.blockRow.dropAfter::after` left offsets after the grid changes.
- Keep table cell overrides compatible with the new class names, especially the existing rule that table cells do not show block-level move buttons.

## Phase 4: Todo Affordance Details

Render todo affordances so the checkbox itself and surrounding slot are draggable while preserving valid HTML semantics.

- Do not nest an `<input>` inside a `<button>`.
- Prefer a non-button wrapper for the affordance slot with `onPointerDown` for drag, containing the checkbox input.
- Keep the checkbox accessible as a checkbox with `aria-label="Toggle todo"`.
- Decide whether the wrapper itself needs `aria-label="Move block"` or whether tests should use the checkbox/slot DOM directly for todo drag. Since the wrapper is not keyboard-operable, avoid giving it misleading button semantics.
- Stop duplicate events carefully: pointer down on the checkbox should enter pending drag, but a non-drag click should still reach `onChange`.

## Phase 5: Tests

Update `examples/block-rich-text/src/App.test.tsx`.

- Update `dragBlockHandle` helper if needed so it can drag from any `Move block` affordance by index.
- Add a test that unordered list bullets are rendered as `Move block` controls and can reorder blocks.
- Add a test that ordered list numbers are rendered visibly as numbers and can reorder blocks.
- Add a test that a paragraph row has only one leading affordance slot and the fallback handle is represented in the DOM without a separate marker column.
- Add a todo test covering both behaviors:
  - clicking the checkbox toggles the todo
  - dragging from the checkbox/slot reorders the block without toggling
- Keep/update the table test asserting table cells do not render block `Move block` buttons.
- Keep the existing peer-created block drag regression passing.

## Phase 6: Verification

Run focused tests:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

If `useBlockReorder` changes substantially, also run:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
```

Run the example build/typecheck:

```sh
npm --prefix examples/block-rich-text run build
```

For visual verification, start the example and inspect the two-editor UI:

```sh
npm run dev -- --host 127.0.0.1
```

Check these manually in the browser:

- Bullet, number, and todo markers all feel draggable.
- Todo click still toggles without accidental drag.
- Paragraph/heading/code rows show the fallback handle on hover/focus.
- Content alignment is less bulky and does not jump when handles appear.
- Drop indicators still align with nested block depth.
- Table cells still omit block-level drag handles.
