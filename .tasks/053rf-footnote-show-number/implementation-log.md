# Implementation Log: Inline Footnote Reference Numbers

## Phase 1: Derive Footnote Ordinals

- Started implementation from `plan.md`.
- Confirmed footnote order is already available from `renderedAnnotations(...)`; no CRDT data model changes are needed.
- Added `footnoteNumberById` in `BlockEditor`, derived from visible-order footnote annotations.

## Phase 2: Thread Numbering Through Render Plumbing

- Passed `footnoteNumberById` through block rendering, editable surfaces, sidebars, footnotes, and floating popovers.
- Added footnote-number entries to `serializeRuns(...)` so number-only changes force editable DOM rerendering.

## Phase 3: Identify Footnote Marks Per Run

- Split generic annotation mark extraction from presentation-specific filtering.
- Preserved popover-specific behavior while adding footnote ID lookup.
- De-duplicated extracted annotation IDs defensively.

## Phase 4: Render Superscripts At Reference End Boundaries

- Reworked `renderRunNodes(...)` to render from chunks in both decorated and undecorated paths.
- Added end-boundary comparison so numbers render once when a footnote is active in the current chunk and inactive in the next chunk.
- Added non-editable `sup.footnoteReferenceNumber` nodes with `data-offset-sentinel="true"` so visual numbers are ignored by offset calculations.

## Phase 5: Style Inline Numbers

- Added `.footnoteReferenceNumber` styling in `style.css`.

## Phase 6: Tests

- Added DOM tests for visible-order numbering, text exclusion from `blockText(...)`, multi-run references, overlapping references, and annotation-body footnotes.
- First focused test run exposed a test harness issue: `rangeAtBlockOffset(...)` counted visual footnote superscripts even though the app's selection code skips `data-offset-sentinel` nodes. Updated test offset helpers to skip sentinels for parity with app behavior.

## Phase 7: Verification

- `npm exec vitest -- examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/annotations.test.ts` passed: 97 tests.
- `npm run build --workspace examples/block-rich-text` failed because the repo is not configured with that npm workspace.
- Fallback `npm run build` from `examples/block-rich-text` passed. The command printed `Error connecting to agent: Operation not permitted` before the npm script, but `tsc -p tsconfig.json --noEmit` and `vite build` completed successfully.
- Started a local Vite server at `http://127.0.0.1:5174/` for a browser smoke check and confirmed it served HTTP 200 with `curl -I`.
- Could not complete the in-app browser smoke check because the Browser plugin could not acquire the `iab` browser in this session.
- Stopping the Vite server required an escalated `kill` because sandboxed process control could not access the process list or signal the PID.
