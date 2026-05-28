# Implementation Log

## Phase 1

- Extracted `TodoAddFormView` as a controlled, JSX-only form component.
- Kept `TodoAddForm` as the v2 editor-aware wrapper that trims input, creates the v2 todo payload, pushes through `editor.$.todos.$push(...)`, and clears the draft after a successful submit.
- Verified with `pnpm --dir examples/react-crdt build`; it passed with Vite's existing large-chunk warning.
- Added Testing Library coverage for `TodoAddFormView` callback wiring, prevented submit, and read-only disabled state.
- Verified with `pnpm vitest run examples/react-crdt/src/apps/todos/TodoAddForm.test.tsx`; 3 tests passed.
- Re-ran `pnpm --dir examples/react-crdt build`; it passed with the same Vite large-chunk warning.

## Phase 2

- Extracted `TodoItemView` as a JSX-only row component with plain props for title, done state, drag state, presence cursors, extra actions, details, and callbacks.
- Kept `TodoItemSlot` and its v2 wrapper behavior editor-aware: row `useValue(...)`, drop-target subscription, presence statuses, CRDT title blame, and `Updater<Todo>` writes remain outside the view.
- Added Testing Library coverage for `TodoItemView` checkbox/delete callbacks, inline title commit/cancel behavior, cursor rendering, drag registration/start, and read-only disabled state.
- Verified with `pnpm vitest run examples/react-crdt/src/apps/todos/TodoItem.test.tsx examples/react-crdt/src/apps/todos/TodoAddForm.test.tsx examples/react-crdt/src/lib/solo/solo-render.test.tsx`; 12 tests passed.
- Tried `pnpm --dir examples/react-crdt build`, but it is currently blocked by unrelated CRDT/type errors outside the todo component changes.

## Phases 3-5

- Updated `TodoVersionApps` to pass `actor` into v1/v3 panels and use `TodoAddFormView` plus `TodoItemView` instead of duplicated static row/form markup.
- Added v1 adapters for add, check/uncheck, inline text edit, delete, and editable `archived` state.
- Added v3 adapters for add, check/uncheck, inline title edit, delete, editable `priority`, and editable `notes`.
- Added scoped todo CSS for the extracted row content area, metadata text, notes input, extra controls, and priority select.
- Added Testing Library coverage for v1/v3 version panels through their exported app definitions.
- Verified with `pnpm vitest run examples/react-crdt/src/apps/todos/TodoVersionApps.test.tsx examples/react-crdt/src/apps/todos/TodoItem.test.tsx examples/react-crdt/src/apps/todos/TodoAddForm.test.tsx examples/react-crdt/src/lib/solo/solo-render.test.tsx`; 14 tests passed.
- Re-tried `pnpm --dir examples/react-crdt build`; it is still blocked by pre-existing CRDT/type errors in migration fixture/server materialization code.
