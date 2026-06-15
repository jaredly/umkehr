# Research: Popover, Focus, and Hover Architecture

## Scope

This assessment covers the popover/focus/hover behavior in `examples/block-rich-text`, centered on `examples/block-rich-text/src/App.tsx`, the related CSS, annotation data model, and the current UI tests in `examples/block-rich-text/src/App.test.tsx`.

The immediate concern is nested popovers: a popover body can contain annotated text, and hovering or selecting that nested mark opens another popover. Recent bug fixes have made the behavior more correct, but the current implementation is still hard to reason about because visibility policy is spread across pointer events, focus events, selection-derived state, mutable refs, delayed timers, and array ordering.

## Current Architecture

### Data model

Annotations are a CRDT mark with a presentation value: `sidebar`, `footnote`, or `popover`.

Relevant code:

- `examples/block-rich-text/src/annotations.ts`
- `examples/block-rich-text/src/App.tsx`

Popover annotations are not a separate model. They are rendered from the same annotation mark data as comments and footnotes. Annotation body blocks are materialized under virtual parents using `annotationVirtualParents`, which allows nested annotations inside annotation bodies.

This is a solid model choice. It means the content model supports nested popovers naturally, but it also means the UI lifecycle must treat popover bodies as first-class rich text surfaces, not as simple tooltip text.

### Rendering and trigger detection

`RichTextEditableSurface` renders all rich text runs imperatively with `renderRunNodes`. If a run has a popover annotation id, `applyRunClasses` adds:

- `.markPopover`
- `data-popover-id`
- `aria-label="Popover"`

Trigger detection is delegated from each editable surface through mouse events:

- `onMouseOver` calls `onPopoverTriggerEnter`
- `onMouseOut` calls `onPopoverTriggerLeave`
- `onClick` also calls `onPopoverTriggerEnter`

`popoverTriggerFromEvent` finds the closest `[data-popover-id]` inside the surface. This allows one handler path for main document blocks, sidebar bodies, footnotes, and popover body editors.

This reuse is good, but it couples low-level editable rendering to high-level popover lifecycle policy. The surface emits only "enter id/element" and "leave id"; it does not express whether the event came from a selected mark, a hover-only mark, a body inside an already focused popover, or a transition between related popover surfaces.

### Active popover state

Each `BlockEditor` owns its own popover state:

```ts
type ActivePopover = {
    id: string;
    top: number;
    left: number;
    source: 'hover' | 'selection';
};
```

State and refs live in `BlockEditor`:

- `activePopovers`
- `popoverHideTimerRef`
- `popoverHasFocusRef`
- `focusedPopoverIdRef`

`showPopover` appends or updates an entry in `activePopovers`. The array order is used as an implicit nesting/path order. This is important: several hide cases use indexes in this array to preserve ancestors and remove descendants.

### Selection-pinned popovers

`selectedPopoverId` is derived from either:

- `activeAnnotationBodySelection`, when selection is inside an annotation body; or
- `primaryResolvedSelection`, when selection is in the main editor.

`selectedPopoverIdForSelection` scans all document blocks plus annotation body blocks and returns a popover id if the current range fully covers all visible ranges for that annotation id.

A layout effect watches `selectedPopoverId`:

- If present, it finds a matching `[data-popover-id]` in the editor panel and calls `showPopover(id, trigger, 'selection')`.
- If absent, it removes selection-sourced popovers unless focus is inside a popover.

This is the part that makes selected nested marks act like pinned popovers. It is also one of the reasons the lifecycle is hard to follow: selection is both content-editing state and popover visibility state.

### Focus-pinned popovers

`FloatingAnnotationPopover` calls `onFocusChange(true, id)` on focus and `onFocusChange(false, id)` on blur leaving the popover.

`setPopoverFocusPinned` stores whether a popover has focus and which popover id is focused. When focused, it trims `activePopovers` to keep the focused popover and possibly a selected descendant. When blurred, it schedules a delayed hide.

The recent local changes improve this by tracking the focused popover id instead of only a boolean. That is directionally correct because nested popovers require knowing which layer owns focus.

### Hover hide behavior

Pointer leave calls `schedulePopoverHide(id)`, which waits 300ms and then updates `activePopovers`.

The hide algorithm currently has several cases:

- If focus is inside a popover and no id was provided, keep current popovers.
- If the focused popover is deeper than the leaving popover, keep current popovers.
- If the focused popover is the leaving popover, keep through the selected descendant if one exists.
- If no id was provided, keep only `source === 'selection'`.
- If an id was provided, remove that popover and later hover descendants, while preserving selection-sourced entries.

This encodes the current desired behavior, but it is operating over `activePopovers` as an implicit stack and over `source` as a partial reason for visibility.

## What Is Working

The current behavior has meaningful coverage and several correct concepts:

- Popover annotations are part of the rich text/annotation model rather than a separate UI-only feature.
- Nested popovers are supported because annotation body blocks are materialized as editable rich text.
- The same trigger detection code works in main blocks, sidebar comments, footnotes, and popover bodies.
- Selection can pin a popover, so selected annotated text stays visible even without hover.
- Focus inside an editable popover body can pin that popover long enough to edit content.
- The current tests cover several high-risk regressions:
  - Editable popover bodies.
  - Creating a child popover inside a parent body.
  - Delayed hide after leaving marks.
  - Keeping a parent visible while clicking a child popover.
  - Keeping a parent visible while clicking a child popover mark.
  - Hiding child hover popovers after leaving the parent.
  - Returning focus to the parent and closing an unselected child.

## Architectural Risks

### 1. Visibility reason is underspecified

`source: 'hover' | 'selection'` is not enough to describe why a popover is open.

In practice, a popover can be open because of:

- pointer hover over its trigger;
- focus inside its panel;
- selection covering its trigger;
- a descendant requiring its ancestor to remain visible;
- delayed grace period after pointer leave;
- click/tap activation without current hover.

The current code represents these reasons through a mix of `source`, refs, focus queries, selected id, timer state, and array position. That is why fixes tend to add more conditional logic rather than simplifying the model.

### 2. The active array is an implicit tree path

Nested popovers are handled by ordering in `activePopovers`. The code assumes that an earlier entry is an ancestor and a later entry is a descendant. That is usually true because `showPopover` appends a new id, but the invariant is not explicit.

Potential issue: if an existing popover is re-shown, `showPopover` replaces it in place rather than moving it to the end. That preserves older order, which may or may not match the current ancestry path after content changes, hover transitions, or reopening. The tests cover common two-level cases, but the architecture does not make the nesting relationship explicit.

### 3. Focus truth is split between DOM queries and refs

There are three related mechanisms:

- `popoverHasFocusRef`
- `focusedPopoverIdRef`
- `focusedPopoverId()` / `popoverContainsFocus()` DOM queries

Refs are needed because timer callbacks need fresh-ish focus state, but maintaining both refs and DOM queries creates risk of drift. The recent fix had to add `focusedPopoverIdRef` and pass ids through blur specifically because a boolean was too lossy.

The next step should be to make focus ownership a first-class part of popover state rather than a separate side channel.

### 4. Pointer leave does not know the destination popover relationship

`RichTextEditableSurface` suppresses mouseout only when `relatedTarget` is another node inside the same trigger. `FloatingAnnotationPopover` forwards `onMouseLeave` without the event, so the hide code cannot inspect whether the pointer moved into a child popover, parent popover, sibling popover, trigger, or outside the popover system.

Some of this is papered over by the 300ms delay and `onMouseEnter` cancellation. That works for many real pointer moves, but tests and browser event timing can expose fragile gaps. The current API has already lost useful information by the time lifecycle policy runs.

### 5. Selection-derived visibility is recomputed globally

`selectedPopoverIdForSelection` scans blocks and annotation body blocks to infer whether a selected range fully covers a popover mark. This is reasonable for an example app, but it gives only one selected popover id.

Open questions:

- What should happen if a selection fully covers multiple nested or overlapping popover marks?
- Should the deepest selected popover win, the first materialized popover win, or should the full selected ancestor path be open?
- Should collapsed caret placement inside a mark open a popover, or only range selection/click/hover?

The current implementation returns the first matching id from a map built in block/run order. That is deterministic, but not clearly tied to user intent.

### 6. Rendered DOM is replaced outside React

`RichTextEditableSurface` uses `replaceChildren` to render rich text runs and strips primary decorations on focus. This is already part of the editor architecture, but for popovers it means trigger elements can be destroyed and recreated during focus, input, selection restoration, and annotation body edits.

`activePopovers` stores coordinates, not live anchors. If the trigger moves or is recreated after content changes, the popover can become stale until another selection/hover path re-shows it.

This may be acceptable for the demo, but it is an architectural constraint worth making explicit.

## Recommended Direction

### Near-term: Extract a popover controller hook

Move the lifecycle rules out of `BlockEditor` into a focused hook, for example:

```ts
type PopoverOpenReason = 'hover' | 'selection' | 'focus';

type ManagedPopover = {
    id: string;
    anchor: HTMLElement;
    top: number;
    left: number;
    reasons: Set<PopoverOpenReason>;
    parentId: string | null;
};
```

Possible API:

```ts
const popovers = useAnnotationPopoverController({
    panelRef,
    selectedPopoverId,
    resolveParentPopoverId,
});

popovers.openFromTrigger(id, element, 'hover');
popovers.closeHover(id, event.relatedTarget);
popovers.pinSelection(id, element);
popovers.focusPopover(id);
popovers.blurPopover(id, event.relatedTarget);
```

The hook can own:

- delayed hide timer;
- focus id;
- pointer hover state;
- open reasons;
- ancestor/descendant retention policy;
- coordinate calculation;
- pruning stale ids when annotation ids disappear.

This would not change behavior immediately, but it would isolate the policy and make tests easier to write at the state-machine level.

### Medium-term: Represent an explicit open path

Nested popovers behave like a path from root annotation to active descendant. Instead of relying on array order, store parent relationships explicitly:

```ts
type PopoverNode = {
    id: string;
    parentId: string | null;
    source: {
        hover: boolean;
        selection: boolean;
        focus: boolean;
    };
};
```

Then the controller can derive visible popovers:

- keep nodes with a direct open reason;
- keep ancestors of kept nodes;
- remove hover-only descendants when their trigger and panel are no longer hovered;
- preserve selected descendants while their selected mark remains selected.

This removes index comparisons like `focusedIndex > index` and `slice(0, keepThroughIndex + 1)` from UI event handlers.

The hardest part is `parentId`. Options:

1. Infer from DOM containment: when a trigger is inside `.annotationFloatingPopover`, its parent id is the containing popover's `data-popover-id`; otherwise `null`.
2. Infer from annotation body parentage in the CRDT model.
3. Pass current popover context down through React context when rendering a popover body.

Option 1 is the smallest change and likely sufficient for this example. Option 3 is cleaner if the app continues to grow.

### Medium-term: Preserve relatedTarget in lifecycle events

Change popover callbacks to keep the original transition context:

```ts
onPopoverTriggerLeave(id, {from, to})
onPopoverPanelLeave(id, {from, to})
onPopoverPanelBlur(id, {from, to})
```

The controller can then answer:

- Did pointer/focus move into this popover's panel?
- Did it move into a child popover panel?
- Did it move back to an ancestor?
- Did it leave the whole popover system?

This is more robust than scheduling a hide and hoping an enter/focus event cancels it before the timer fires.

### Medium-term: Track selected popover path, not one id

Replace `selectedPopoverId` with `selectedPopoverIds` or `selectedPopoverPath`.

This lets the UI intentionally handle:

- a selection inside a parent popover body that covers a child popover mark;
- overlapping annotation marks;
- selected child popovers whose ancestors should remain visible.

Even if the UI only renders one selected descendant at a time, deriving a path makes the retention rule explicit.

### Longer-term: Consider a real floating/overlay primitive

The current positioning is fixed coordinates from `getBoundingClientRect`. For a demo this is fine, but if popovers become more central, a small overlay primitive or a library such as Floating UI would handle:

- viewport flipping;
- scroll/resize repositioning;
- collision handling;
- focus outside / dismissable layer semantics.

This should not be the first move. The main issue is lifecycle policy, not geometry.

## Testing Recommendations

The current tests are valuable but very integration-heavy. They recreate content and nested annotations repeatedly, then assert visible dialog counts. That catches regressions, but it makes the expected state machine hard to see.

Recommended additions:

### 1. Add test helpers for nested popover setup

Create helpers in `App.test.tsx`:

- `createPopoverOnMainText(panel, text, start, end)`
- `openPopoverFromMark(panel, level?)`
- `typePopoverBody(popover, text)`
- `createChildPopover(parentPopover, start, end)`
- `popoverDialogs(panel)`

This will make future tests specify behavior instead of setup ceremony.

### 2. Add direct controller tests after extraction

If a `useAnnotationPopoverController` hook or pure reducer is extracted, test the reducer separately from DOM contenteditable behavior.

Core cases:

- hover opens one popover;
- leave starts grace period;
- entering panel cancels hide;
- focus pins panel;
- blur removes focus reason but keeps selection reason;
- child hover keeps parent visible;
- parent leave with focused child keeps parent visible;
- parent focus with unselected child closes child;
- parent focus with selected child keeps child;
- stale selected id is pruned when no trigger exists.

### 3. Cover more user-level transitions

Add UI tests for cases not currently explicit:

- Moving pointer from trigger directly into the popover panel keeps it open.
- Moving pointer from popover panel back to its trigger keeps it open.
- Moving pointer from parent panel into child panel keeps both open.
- Moving pointer from child panel back to parent panel hides the child only when it is not focused or selected.
- Pressing Escape closes the active popover or descendant path, if Escape dismissal is desired.
- Clicking outside all popovers and editor content closes hover/selection popovers according to the intended product rule.
- Switching focus to the other editor panel closes popovers in the previous editor, or intentionally preserves them if that is desired.
- Deleting a popover annotation mark while its popover is open removes the stale popover.
- Editing text before an open popover trigger either repositions the popover or leaves it stale by design with an explicit test.

### 4. Test overlapping popover marks

The annotation model supports stacked annotation marks. Add tests for:

- hovering text with two popover ids;
- selecting text covered by overlapping popover marks;
- child popover creation inside overlapping marked text.

Current rendering picks the first popover id for a run. That may be acceptable, but it should be intentional.

### 5. Add one browser-level Playwright test if possible

JSDOM event sequencing around `relatedTarget`, focus, and contenteditable selection is approximate. A single Playwright test for nested hover/focus behavior would provide higher confidence:

- create parent popover;
- type child body text;
- create child popover;
- move mouse between trigger, parent panel, child trigger, and child panel;
- assert visible dialogs and focused element.

## Open Questions

1. Should hover popovers close when focus is inside an ancestor popover, or should focus inside a parent keep the whole visible descendant path alive?
    - close when focus is inside the parent and the child's mark isn't fully selected or hovered

2. Should selecting a popover mark always pin that popover, even if the selected mark is inside a focused parent popover body?
    - yes

3. What should happen when multiple popover marks overlap the same rendered run? Today only the first id from `popoverIdsForRun` becomes the DOM trigger.
    - all popovers should display

4. Should a collapsed caret inside a popover mark open the popover, or only click/hover/range selection?
    - only hover/range selection

5. Should clicking outside the editor clear selected popovers immediately, after a delay, or not at all?
    - let's go immediate

6. Should popovers remain open when focus moves from Editor A to Editor B?
    - no

7. Should open popovers reposition when their trigger text changes, wraps, scrolls, or is recreated by `replaceChildren`?
    - yes

8. Is a 300ms hide delay an intentional UX rule, or just a workaround for pointer gaps between trigger and panel?
    - just a workaround. if you can remove it what would be great

9. Do we want keyboard navigation and dismissal semantics for popovers, such as Escape, Tab trapping, or roving through nested popovers?
    - yes

10. Is the desired nesting depth unbounded, or can the UI intentionally cap nested popovers at two levels?
    - unbounded

## Suggested Next Step

The highest-leverage next step is to extract the current behavior into a `useAnnotationPopoverController` hook without changing product behavior. Once isolated, replace the implicit array-order rules with explicit open reasons and parent ids. That should make the recent bug fixes easier to preserve while reducing the need for one-off conditionals in `BlockEditor`.
