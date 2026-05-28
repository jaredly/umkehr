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
