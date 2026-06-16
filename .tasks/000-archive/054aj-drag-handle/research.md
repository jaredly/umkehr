# Research: Unified Block Markers and Drag Handles

## Goal

In `examples/block-rich-text`, make the block drag affordance share the same visual slot as the block's list marker. If a block has a visible marker, that marker should be draggable. If a block has no visible marker, the marker slot should remain visually empty until the block is focused/active, then show a drag handle in that empty space.

This should reduce the current bulk from having both a dedicated drag-handle column and a separate marker column.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/App.test.tsx`

`BlockEditor` wires `useBlockReorder` and passes `startDrag` into `renderBlockNode`. The hook already accepts a `PointerEvent<HTMLElement>`, so the drag source does not need to be a specific button class.

The normal block row is rendered by `EditableBlock` in `App.tsx`.

Current row structure:

```tsx
<div className="blockRow" ...>
    <button className="dragHandle" aria-label="Move block" ...>⋮⋮</button>
    <BlockAffordance meta={meta} listNumber={listNumber} onToggleTodo={onToggleTodo} />
    <RichTextEditableSurface ... />
    <BlockInlineControls ... />
</div>
```

`BlockAffordance` currently owns only marker/toggle rendering:

- `list_item`: `<span className="blockMarker">` with `•` or `N.`
- `todo`: `<input className="todoToggle" type="checkbox">`
- everything else: empty `<span className="blockMarker" aria-hidden="true" />`

The CSS uses four grid columns for normal blocks:

```css
.blockRow {
    grid-template-columns: 34px 24px minmax(0, 1fr) minmax(0, auto);
}
```

The first column is the drag button, the second column is the marker/todo slot. Table cells override this to two columns and hide `.blockMarker` plus `.dragHandlePlaceholder`.

Table rows are already a useful precedent: row drag is represented by row numbers rather than a separate generic handle.

## Implementation Direction

Collapse the normal block row to one affordance column:

```css
.blockRow {
    grid-template-columns: 34px minmax(0, 1fr) minmax(0, auto);
}
```

Then replace the separate drag button plus marker pair with a single component that renders the correct affordance for the block type and starts block drag from that affordance.

Likely shape:

- Rename or expand `BlockAffordance` to accept `blockId`, `isTableCell`, `onStartDrag`, and maybe `selection`.
- For `list_item`, render a button styled like a marker (`aria-label="Move block"`) containing the bullet or ordered number. Attach `onPointerDown={(event) => onStartDrag(blockId, event)}`.
- For ordinary non-marker blocks, render a button in the same slot containing `⋮⋮`, hidden by default and visible when the row is hovered, focused, focused-within, or otherwise active.
- Keep the content column alignment stable by always rendering the affordance slot, even when the visible handle is hidden.
- Preserve table-cell behavior: table cells should continue using the two-column layout with no block-level drag marker inside cells, unless product requirements change.

Potential CSS classes:

- `.blockAffordance`
- `.blockAffordanceButton`
- `.blockAffordanceMarker`
- `.blockAffordanceHandle`
- `.blockRow:hover .blockAffordanceHandle`
- `.blockRow:focus-within .blockAffordanceHandle`

The drop indicator left offset currently assumes the old two-affordance width:

```css
left: calc(42px + var(--drop-offset, 0px));
```

After collapsing columns, this probably needs to become based on the single affordance slot, for example `left: calc(34px + 8px + var(--drop-offset, 0px))`, or be checked visually and adjusted with the final grid gap.

## Todo Checkbox Interaction

The todo marker is the only ambiguous case because the marker is an actual checkbox with its own click behavior.

Options:

1. Make the checkbox itself draggable via `onPointerDown`, but only start drag after movement passes a threshold. A click without movement toggles the checkbox.
2. Wrap the checkbox in a draggable marker button/slot, with the checkbox still clickable. This is semantically awkward because an interactive control inside another interactive control should be avoided.
3. Keep checkbox toggle as the primary click target and add drag behavior from the checkbox's surrounding marker slot only. This keeps semantics cleaner but may make the exact draggable area less obvious.

The existing `useBlockReorder.startDrag` starts drag immediately on pointer down. Supporting option 1 cleanly would require changing `useBlockReorder` to defer `setDraggingId` until pointer movement exceeds a small distance, and to avoid preventing the click when it was just a toggle. That is a broader interaction change but likely the best long-term behavior if todo checkboxes must be both toggles and drag handles.

## Accessibility Notes

The current drag handle is a real button with `aria-label="Move block"`. If list markers become the handle, they should also be exposed as a button with the same label unless keyboard drag support is added separately.

For ordered list items, the visible text can remain `1.` while the accessible name remains `Move block`; tests should not rely only on text content for these controls.

For todo items, do not put an interactive checkbox inside a button. Pick either a checkbox with drag behavior or separate sibling elements inside the affordance slot.

## Tests To Update/Add

Current UI tests use:

```ts
within(panel).getAllByRole('button', {name: 'Move block'})
```

That can continue working if list markers and fallback handles are rendered as buttons named `Move block`.

Suggested coverage in `examples/block-rich-text/src/App.test.tsx`:

- A list item marker is the block drag source and can reorder blocks.
- An ordered list marker displays the list number and is also a `Move block` button.
- A non-list paragraph does not show a bulky marker and still exposes/shows the drag handle on focus/hover. In jsdom, assert class/DOM shape rather than actual hover pixels.
- Todo behavior remains correct: clicking the checkbox toggles it, and the chosen drag gesture for todo blocks can reorder without accidentally toggling.
- Existing table test should keep asserting table cells do not render block `Move block` buttons.

Likely verification command:

```sh
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

If broader drag logic changes in `useBlockReorder`, also run relevant command tests:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
```

## Open Questions

- For todo blocks, should the checkbox itself be draggable, or should only the surrounding marker slot drag while the checkbox remains only a toggle?
    - the checkbox itself and the surrounding slot
- Should the fallback drag handle show on row hover as well as focus/focus-within? The task says "show-on-block-focus", but hover is common for drag affordances and may be expected by mouse users.
    - sure
- Should bullet/number markers look exactly like text markers, or should they get subtle button hover/focus styling to communicate drag affordance?
    - yeah a hover-based drag affordance styling for everything would be great
- Should keyboard users be able to initiate/reorder via the marker button, or is pointer-only parity with the current handle acceptable for this task?
    - pointer-only for now
