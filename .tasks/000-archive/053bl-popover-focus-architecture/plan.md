# Plan: Popover, Focus, and Hover Architecture

## Goal

Simplify and harden popover lifecycle management in `examples/block-rich-text` while preserving the rich text annotation model and supporting unbounded nested popovers.

Target behavior from research answers:

- Hover popovers close when focus is inside a parent and the child mark is not fully selected or hovered.
- Selecting a popover mark pins that popover, including when the selected mark is inside a focused parent popover body.
- Overlapping popover marks should display all relevant popovers.
- A collapsed caret inside a popover mark should not open it; only hover, click activation, or range selection should.
- Clicking outside the editor closes selected popovers immediately.
- Moving focus from Editor A to Editor B closes popovers in the previous editor.
- Open popovers should reposition when their trigger text moves, wraps, scrolls, or is recreated.
- The 300ms hide delay is not a product requirement and should be removed if explicit transition handling can replace it.
- Add keyboard navigation and dismissal semantics.
- Nesting depth should be unbounded.

## Phase 1: Stabilize Test Setup

Before changing lifecycle logic, make the current popover tests easier to extend.

Tasks:

- Add test helpers in `examples/block-rich-text/src/App.test.tsx`:
  - `createPopoverOnMainText(panel, text, start, end)`
  - `openPopoverFromMark(panel, markOrIndex?)`
  - `typePopoverBody(popover, text)`
  - `createChildPopover(parentPopover, start, end)`
  - `popoverDialogs(panel)`
  - `popoverMarks(scope)`
- Refactor existing popover tests to use these helpers without changing assertions.
- Keep the existing regression coverage intact:
  - editable popover bodies;
  - nested popover creation;
  - parent kept visible while child is clicked;
  - child hover popover hidden when parent has focus and child mark is not selected;
  - selected child popover kept visible.

Verification:

- Run the block rich text UI tests.
- Confirm this phase is mostly test-only and behavior-neutral.

## Phase 2: Extract Popover Controller

Move popover lifecycle state out of `BlockEditor` into a dedicated hook, without intentionally changing visible behavior yet.

New file:

- `examples/block-rich-text/src/useAnnotationPopoverController.ts`

Initial hook responsibilities:

- Own active popover state.
- Own focus tracking.
- Own hover/open/close commands.
- Own coordinate calculation.
- Own cleanup on unmount.
- Provide a render-ready `activePopovers` array compatible with `FloatingAnnotationPopover`.

Candidate public API:

```ts
const popovers = useAnnotationPopoverController({
    panelRef,
    selectedPopoverIds,
    getTriggerForPopover,
});

popovers.activePopovers;
popovers.openFromTrigger(id, element, 'hover' | 'selection');
popovers.closeFromTrigger(id, relatedTarget);
popovers.enterPanel(id);
popovers.leavePanel(id, relatedTarget);
popovers.focusPanel(id);
popovers.blurPanel(id, relatedTarget);
popovers.closeAll();
popovers.closeEditorPopovers();
```

Migration steps:

- Move `activePopovers`, `popoverHideTimerRef`, `popoverHasFocusRef`, `focusedPopoverIdRef`, `showPopover`, `schedulePopoverHide`, `setPopoverFocusPinned`, `popoverContainsFocus`, and `focusedPopoverId` into the hook.
- Keep temporary compatibility with the current `ActivePopover` shape.
- Wire `BlockEditor` to call the hook rather than owning the logic directly.

Verification:

- Existing tests pass before policy changes.
- No source behavior changes are expected in this phase.

## Phase 3: Make Open Reasons and Parentage Explicit

Replace the current implicit stack/index behavior with explicit open reasons and parent ids.

Data model:

```ts
type PopoverOpenReason = 'hover' | 'selection' | 'focus' | 'activation';

type ManagedPopover = {
    id: string;
    parentId: string | null;
    anchor: HTMLElement | null;
    top: number;
    left: number;
    reasons: Record<PopoverOpenReason, boolean>;
};
```

Parent detection:

- Start with DOM containment:
  - If a trigger is inside `.annotationFloatingPopover`, parent id is that popover's `data-popover-id`.
  - Otherwise parent id is `null`.
- This supports unbounded nesting without needing CRDT parent traversal.

Derived visibility rule:

- A popover is visible if it has any active reason.
- Ancestors of visible popovers are visible.
- Hover-only descendants close when their trigger and panel are no longer hovered and they are not selected/focused/activated.
- If focus is inside a parent, an unselected and unhovered child closes.
- If a child mark is fully selected, the child remains visible even while parent has focus.

Tasks:

- Replace `source: 'hover' | 'selection'` with reason tracking.
- Replace index slicing with ancestor/descendant traversal.
- Keep `activePopovers` as a derived array sorted by parent path for rendering.
- Prune stale nodes when their annotation id is no longer present.

Verification:

- Add direct tests for the controller reducer/hook logic if practical.
- Existing nested behavior tests should still pass.

## Phase 4: Preserve Transition Context and Remove Timer Reliance

Replace delayed hide behavior with explicit pointer/focus transition handling.

Tasks:

- Change trigger callbacks to preserve `relatedTarget`:
  - `onPopoverTriggerEnter(id, element)`
  - `onPopoverTriggerLeave(id, relatedTarget)`
- Change panel callbacks to preserve `relatedTarget`:
  - `onPopoverPanelEnter(id)`
  - `onPopoverPanelLeave(id, relatedTarget)`
  - `onPopoverPanelFocus(id)`
  - `onPopoverPanelBlur(id, relatedTarget)`
- Teach the controller to classify transitions:
  - trigger to own panel;
  - panel to own trigger;
  - parent panel to child trigger;
  - parent panel to child panel;
  - child panel back to parent panel;
  - inside the same popover subtree;
  - outside the editor/popover system.
- Remove the 300ms hide delay if the transition classifier covers the pointer gap cases.
- If a short delay is still needed for a browser edge case, keep it as an implementation fallback, not as the primary lifecycle rule.

Verification:

- Tests should no longer need to advance fake timers for ordinary hover transitions.
- Add explicit tests for trigger-to-panel and panel-to-trigger transitions.

## Phase 5: Track Selected Popover Paths and Overlaps

Replace the single selected popover id with a list/path so overlapping marks and nested selected marks can all be represented.

Tasks:

- Replace `selectedPopoverIdForSelection` with a function returning multiple ids:
  - range selections only;
  - no collapsed caret opening;
  - include every popover mark whose visible range is fully covered by the selection;
  - support overlapping stacked marks.
- Derive selected popover paths using controller parent ids.
- Pin all selected popovers with the `selection` reason.
- Ensure ancestors of selected popovers remain visible.

Rendering tasks:

- Update `applyRunClasses` / trigger rendering so overlapping popover marks can expose all relevant popover ids.
- Avoid relying on only `popoverIdsForRun(...)[0]`.
- Decide DOM representation:
  - preferred: keep one visual mark span with `data-popover-ids` and let hover/click open all ids;
  - alternative: split/wrap runs to create separate trigger elements if distinct hit targets are required.

Verification:

- Add tests for two overlapping popovers on one rendered run.
- Add tests that hovering/clicking overlapping text opens all relevant popovers.
- Add tests that selecting overlapping text pins all relevant popovers.

## Phase 6: Closing Rules for Outside Click and Editor Switch

Make global dismissal explicit.

Tasks:

- Add editor-level outside pointer/focus handling:
  - clicking outside the current editor panel closes that editor's popovers immediately;
  - focusing Editor B closes Editor A's popovers immediately, and vice versa.
- Ensure this does not break clicking within a popover, nested popover, toolbar action, or annotation body.
- Decide whether toolbar clicks inside the same editor should preserve selected popovers when they create/edit annotations. The likely answer is yes for annotation toolbar actions and no for unrelated controls.

Verification:

- Add tests for outside click immediate close.
- Add tests for Editor A to Editor B focus transition.
- Add tests that clicking inside parent/child popovers does not close them.

## Phase 7: Reposition Open Popovers

Keep open popovers anchored to their current trigger geometry.

Tasks:

- Store an anchor lookup strategy rather than only fixed coordinates:
  - keep `anchor: HTMLElement | null` when available;
  - re-query by `data-popover-id` or `data-popover-ids` after DOM replacement;
  - support multiple triggers for overlapping ids.
- Recompute positions when:
  - editor state changes;
  - selection-pinned ids change;
  - annotation body text changes;
  - window resizes;
  - scroll occurs.
- If multiple trigger elements exist for one id, choose the first visible trigger or the trigger associated with the active hover/selection event.

Verification:

- Add tests for repositioning after text insertion before a trigger.
- Add tests for stale trigger removal when annotation text is deleted.
- Add lightweight browser-level coverage if JSDOM geometry is insufficient.

## Phase 8: Keyboard Semantics

Add keyboard behavior once controller state is explicit.

Initial semantics:

- `Escape` closes the deepest active popover first.
- Repeated `Escape` walks up the visible popover path, then clears all popovers.
- `Tab` should move naturally through focusable content; do not trap focus unless a future product decision requires modal behavior.
- When focus enters a popover body by keyboard, mark it focused.
- When focus leaves the editor/popover system, close popovers according to outside-focus rules.

Tasks:

- Add keydown handling at the editor/panel level.
- Define "deepest active popover" using parent traversal, not render order.
- Avoid interfering with rich text editing shortcuts.

Verification:

- Add tests for Escape closing child before parent.
- Add tests for Tab moving between popover body and next focus target without stale popovers.

## Phase 9: Optional Browser-Level E2E Coverage

JSDOM is limited for pointer geometry, focus, and contenteditable selection. Add one Playwright spec if the example test setup supports it.

Scenario:

- Create a parent popover in Editor A.
- Type body text.
- Create a child popover inside the body.
- Move the mouse:
  - parent trigger to parent panel;
  - parent panel to child trigger;
  - child trigger to child panel;
  - child panel back to parent panel;
  - outside the editor.
- Assert dialog count, focused element, and close behavior.

This should be added after the controller exists so failures point at policy, not old event timing.

## Implementation Notes

- Keep the annotation CRDT model unchanged.
- Keep popovers local to each `BlockEditor`.
- Prefer extracting small pure helpers from the hook:
  - `deriveVisiblePopoverIds`
  - `isPopoverAncestor`
  - `popoverDepth`
  - `resolveTriggerParentId`
  - `classifyPopoverTransition`
- Avoid introducing a floating-positioning library until lifecycle policy is clean.
- Be careful with existing dirty worktree changes in `examples/block-rich-text/src/App.tsx` and `App.test.tsx`; preserve user changes and make focused edits.

## Suggested Landing Order

1. Refactor tests/helpers only.
2. Extract behavior-neutral controller hook.
3. Add explicit reasons and parent ids behind the same UI.
4. Preserve `relatedTarget` and remove timer dependence.
5. Implement multi-selected/overlapping popovers.
6. Add outside/editor-switch dismissal.
7. Add repositioning.
8. Add keyboard semantics.
9. Add browser-level coverage if needed.

