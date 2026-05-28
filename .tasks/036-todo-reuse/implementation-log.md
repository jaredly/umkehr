# Implementation Log

## Phase 1

- Extracted `TodoAddFormView` as a controlled, JSX-only form component.
- Kept `TodoAddForm` as the v2 editor-aware wrapper that trims input, creates the v2 todo payload, pushes through `editor.$.todos.$push(...)`, and clears the draft after a successful submit.
- Verified with `pnpm --dir examples/react-crdt build`; it passed with Vite's existing large-chunk warning.
- Added Testing Library coverage for `TodoAddFormView` callback wiring, prevented submit, and read-only disabled state.
- Verified with `pnpm vitest run examples/react-crdt/src/apps/todos/TodoAddForm.test.tsx`; 3 tests passed.
- Re-ran `pnpm --dir examples/react-crdt build`; it passed with the same Vite large-chunk warning.
