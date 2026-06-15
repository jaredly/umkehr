# Implementation Log: Popover, Focus, and Hover Architecture

## 2026-06-15

### Starting State

- `research.md` and `plan.md` exist for the task.
- Git reports no tracked source diffs at the start of implementation.
- Beginning with Phase 1: stabilize popover test setup before changing behavior.

### Phase 1: Stabilize Test Setup

- Added popover-specific test helpers to `examples/block-rich-text/src/App.test.tsx`.
- Refactored the nested popover tests to use helper setup while preserving their assertions.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 75 tests.
- Issues: one refactor initially placed fake timers before an async helper; moved `vi.useFakeTimers()` after child popover creation to keep `waitFor` under real timers.

### Phase 2: Extract Popover Controller

- Added `examples/block-rich-text/src/useAnnotationPopoverController.ts`.
- Moved active popover state, focus tracking, hide timer cleanup, show/hide callbacks, and selection-pinned popover effect out of `BlockEditor`.
- Kept the current behavior and `ActivePopover` render shape intact for this phase.
- Verification:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 75 tests.
- Issues: none.

### Phases 3 and 4: Explicit Reasons, Parentage, and Transition-Based Hiding

- Replaced the controller's implicit active array policy with `ManagedPopover` nodes that track parent id, anchor element, position, and explicit open reasons (`hover`, `selection`, `focus`, `activation`).
- Derived rendered popovers from nodes with open reasons plus their ancestors.
- Passed `relatedTarget` through trigger/panel leave and popover blur callbacks.
- Removed timer-dependent hiding from the controller; pointer leave now clears hover immediately unless the pointer moved inside the same popover subtree.
- Updated one old delayed-hide assertion: blurring a child popover body to `document.body` now leaves the parent visible and closes the unselected/unfocused child.
- Verification:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 75 tests.
- Issues/workarounds:
  - JSDOM did not expose global `Element`; transition classification now resolves `Element` from the target's owning document.
  - A mechanical replacement was accidentally done with a short script; subsequent edits are back to `apply_patch`.

### Phase 5: Selected Paths and Overlapping Popovers

- Changed selected popover derivation from one id to all fully covered popover ids.
- Kept collapsed caret behavior unchanged: carets inside a mark do not open popovers.
- Rendered overlapping popover marks with both `data-popover-id` for compatibility and `data-popover-ids` as a whitespace-separated list.
- Updated hover/click handling so one overlapping trigger opens/closes every attached popover id.
- Added coverage for overlapping marks: hover and range selection over the overlap display both popovers.
- Issue/workaround: selected id arrays caused a hook render loop because annotation materialization can recreate arrays; added a stable `selectedPopoverIdsKey` dependency.

### Phase 6: Outside Click and Editor Switch Dismissal

- Added controller-level document `mousedown` handling for each editor panel.
- Clicking outside an editor panel closes that editor's popovers immediately.
- Clicking/focusing Editor B closes Editor A's popovers because Editor B is outside Editor A's panel.
- Added tests for body click dismissal and Editor A to Editor B transition.
- Issue/workaround: manually setting a caret in tests did not trigger the new mouse-down close path, so the popover close helper now fires `mouseDown` before selection and `mouseUp`.

### Phase 7: Repositioning

- Added anchor re-query and coordinate recomputation for open popovers.
- Repositioning now runs after renders and on window resize/scroll.
- If a trigger node is replaced by contenteditable rerendering, the controller re-queries by `data-popover-id` / `data-popover-ids`.
- If no trigger remains for an open popover id, the stale popover is pruned.
- No separate geometry-heavy test was added because JSDOM returns synthetic/default rects; existing tests cover that stale/replaced nodes do not break popover lifecycle.

### Phase 8: Keyboard Semantics

- Added Escape dismissal.
- Escape closes the deepest visible popover first; repeated Escape can close the parent.
- Added coverage for child-before-parent Escape behavior.

### Final Verification

- `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.
- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 79 tests.
- `npm exec vitest -- run examples/block-rich-text/src` passed with 193 tests across 9 files.

### Bug Fix: Parent Left Visible After Child Leave

- Fixed a bug where leaving a child popover to outside could hide only the child while leaving a parent visible with a stale hover/activation reason.
- The controller now clears hover/activation reasons from ancestors too when the related target is outside that ancestor's popover subtree.
- Parents with real remaining reasons, such as focus or selection, are still preserved.
- Added regression coverage for leaving a child popover when the parent has no remaining reason.
- Verification:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 80 tests.
  - `npm exec vitest -- run examples/block-rich-text/src` passed with 194 tests across 9 files.

### Intent Delay for Trigger-to-Popover Hover

- Added a 100ms pointer-intent bridge when leaving an inline popover trigger toward the floating popover panel.
- Kept ordinary panel exits and pointer movement away from the panel immediate.
- Added per-popover hide timers so overlapping or nested ids do not overwrite one another.
- Panel mouse enter, popover show, close-all, and Escape dismissal now cancel any pending intent hide timers.
- Added regression coverage for delayed trigger-to-panel hover and immediate away-from-panel hover.
- Issue/workaround: JSDOM/React events can provide default `clientX/clientY` values of `0`; the controller treats `(0, 0)` as missing pointer evidence so coordinate-less legacy tests and exits remain immediate.
- Verification:
  - `npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit` passed.
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 82 tests.
  - `npm exec vitest -- run examples/block-rich-text/src` passed with 196 tests across 9 files.

### Bug Fix: Popover Marks Painting Over Cursors

- Raised retained cursor markers above positioned popover mark spans with a local `z-index`.
- Kept popover mark positioning and pointer behavior unchanged.
