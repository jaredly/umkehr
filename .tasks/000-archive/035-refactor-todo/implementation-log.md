# TodoPanel Refactor Implementation Log

## Phase 1

- Started Phase 1 with a mechanical extraction scope: todo-local components only, no behavior changes intended.
- Existing unrelated working tree changes were present before implementation; this phase will only touch todo app files and this log.
- Extracted `TodoItem.tsx` with `TodoItemSlot`, row rendering, title editing, presence cursors, title blame, drop-position subscription, and row-local CRDT metadata guard.
- Extracted `TodoHistoryControls.tsx` with todo-local undo/redo capability detection and button rendering.
- Extracted `TodoList.tsx` with the existing list mapping, drag/drop state, pointer handlers, row ref registration, and reorder animation still intact.
- Extracted `TodoColorPicker.tsx` with todo-local color swatches and preview behavior.
- Reduced `TodoPanel.tsx` to panel composition, summary, add form, and wiring to the extracted todo-local components.
- Verified Phase 1 with `pnpm --dir examples/react-crdt build`; TypeScript and Vite build completed successfully. Vite reported the existing large chunk warning.

## Phase 2

- Started Phase 2 with the goal of extracting existing pointer-driven reorder behavior into a todo-local hook while leaving animation in `TodoList.tsx` for Phase 3.
- Added `useTodoReorder.ts`, which owns drag state, drop-target external store, row registration, latest todo refs, pointer listeners, stale-index-safe drop resolution, and no-op move detection.
- Updated `TodoList.tsx` to wire the hook to `editor.$.todos.$move(...)` and use the hook's row element lookup for the existing animation code.
- Updated `TodoItem.tsx` to use the hook's exported `TodoDropTarget` type while preserving its row-level drop-position subscription.
- Verified Phase 2 with `pnpm --dir examples/react-crdt build`; TypeScript and Vite build completed successfully. Vite reported the existing large chunk warning.

## Phase 3

- Started Phase 3 with the goal of separating row reorder animation from drag/drop state.
- Added `useReorderAnimation.ts`, which owns the previous-rect snapshot, reduced-motion check, row delta calculation, and `element.animate(...)` call.
- Updated `TodoList.tsx` to call `useReorderAnimation(...)` with ordered todo IDs and `getRowElement` from `useTodoReorder`.
- Kept the existing `180ms` duration and `cubic-bezier(0.2, 0, 0, 1)` easing unchanged.
- Verified Phase 3 with `pnpm --dir examples/react-crdt build`; TypeScript and Vite build completed successfully. Vite reported the existing large chunk warning.

## Phase 4

- Started Phase 4 with the goal of making `TodoPanel.tsx` a composition-only component.
- Extracted `TodoAddForm.tsx`, preserving draft title state, submit behavior, replica-prefixed UUID ids, and read-only handling.
- Extracted `TodoSummary.tsx`, preserving the completed/total subscription and display.
- Reduced `TodoPanel.tsx` to header, extracted controls, add form, and list wiring.
- First Phase 4 build attempt passed TypeScript but Vite transiently failed to resolve the linked `umkehr/crdt` export; verified the export resolved with Node and reran the build.
- Verified Phase 4 with `pnpm --dir examples/react-crdt build`; TypeScript and Vite build completed successfully on rerun. Vite reported the existing large chunk warning.

## Phase 5

- Added `examples/react-crdt/tests/todo-smoke.spec.ts` to automate the manual smoke checks.
- Covered solo-mode add, edit, checkbox, delete, drag reorder, no-op drag release, undo, redo, drop indicators, and reorder animation calls.
- Covered local two-replica reorder sync from Replica A to Replica B, including a right-panel animation call.
- Covered server history preview read-only state by previewing the latest timeline event and asserting add, edit, delete, checkbox, drag handle, and color swatch controls are disabled.
- Updated `examples/react-crdt/playwright.config.ts` to start Vite with `--configLoader runner`, matching the seed/build path so Typia transforms are active during e2e dev-server runs.
- The first targeted Playwright run exposed a stale reused dev server on port 5173 and then selector issues; stopped the stale server, simplified row locators, and previewed the latest server event to avoid an existing older-event preview crash.
- Verified the smoke spec with `pnpm --dir examples/react-crdt exec playwright test tests/todo-smoke.spec.ts -c playwright.config.ts`; all 3 tests passed.
- Verified the example build with `pnpm --dir examples/react-crdt build`; TypeScript and Vite build completed successfully. Vite reported the existing large chunk warning.
