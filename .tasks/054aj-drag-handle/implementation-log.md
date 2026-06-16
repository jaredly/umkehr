# Implementation Log: Unified Block Markers and Drag Handles

## Phase 1-2: Affordance Refactor and Pending Drag

- Started implementation against the existing dirty working tree. Existing unrelated edits in `examples/block-rich-text/src/App.tsx`, `style.css`, and tests were preserved.
- Refactored normal block rows to render one leading block affordance instead of separate drag handle and marker elements.
- List item bullets and ordered numbers now render as `Move block` marker buttons.
- Todo rows render a non-button drag slot around the checkbox so the checkbox remains valid and accessible.
- Updated `useBlockReorder` to use a pending pointer gesture with a 4px movement threshold. This was needed so todo checkbox clicks still toggle while checkbox/slot movement starts a drag.
- Added a short-lived click suppression marker when a drag actually starts. This avoids the todo checkbox accidentally toggling if the browser emits a click after a checkbox drag.
- Updated UI drag test helpers to include a pointer move before pointer up.
- Added tests for unordered marker drag, ordered marker drag, compact paragraph affordance structure, and todo click-vs-drag behavior.
- Verification: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 101 tests.
- Verification: `npm --prefix examples/block-rich-text run build` passed.
- Visual check: the in-app browser connector reported `Browser is not available: iab`, so I fell back to headless Chrome and captured `/tmp/054aj-drag-handle.png` from `http://127.0.0.1:5174/`. Chrome wrote the screenshot but did not exit cleanly, so I terminated the stuck headless process by its unique `/tmp/054aj-drag-handle-chrome` user-data-dir argument.
- Issue encountered: `pnpm exec playwright screenshot ...` was not usable because `playwright` is not installed in this workspace.
