# Implementation Log: Blog Visual Demo Gallery

## Phase 1: App Entry And Gallery Shell

- Started implementation from a clean Git worktree. `.tasks` files are not reported by `git status`, so this log is task-local documentation.
- Added a top-level `?demos` branch in `App.tsx` and moved the existing editor UI behind `EditorApp` to avoid conditional hook calls.
- Added `BlogVisualDemos.tsx` with the gallery shell and eight figure sections.

## Phase 2: Shared Figure System

- Added shared inline SVG primitives for panels, nodes, arrows, callouts, rendered strips, range bands, and stage buttons.
- Added CSS for the gallery layout, SVG visual vocabulary, stage controls, and responsive behavior.
- Issue: the compact tree used by the split figures overflowed its panel at full-size node scale. Workaround: the helper renders at a fixed smaller SVG scale while preserving the same node styling.
- Issue: the first build caught widened string inference for the generic stage button helper. Fix: added explicit stage union parameters at each `StageButtons` call site.

## Phase 3: Core Sequence And Split Visuals

- Implemented the RGA/Causal-Tree ordering figure with parent pointers plus a rendered traversal strip.
- Implemented the parent-update split figure with a `Before split` / `After split` staged control.
- Implemented the naive split failure figure contrasting user intent with the sibling-subtree bug.
- Implemented the correct split figure with staged path, sibling-subtree movement, and final order states.

## Phase 4: Conflict, Formatting, And Cycle Visuals

- Implemented the concurrent split conflict figure with replica-intent and LWW-result states.
- Implemented the incidental metadata resolution figure with version-tag and merged-result states.
- Implemented the formatting mark figure with character ID anchors, add/remove ranges, and resolved spans.
- Implemented the block cycle figure with raw cycle, materialized order, ignored edge styling, and deterministic tie-break callout.

## Phase 5: Tests

- Added App tests for the `?demos` route, eight rendered SVG figures, editor UI isolation, and staged-control updates.
- Added URL reset in test cleanup so the demos query parameter does not leak into existing editor tests.

## Phase 6: Build And Visual QA

- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 58 tests.
- `npm run build --prefix examples/block-rich-text` passed.
- Issue: requested Vite port 5174 was already in use. Workaround: Vite selected port 5175, so visual QA used `http://127.0.0.1:5175/?demos`.
- Issue: sandboxed commands could not reach the Vite dev server on newly started ports. Workaround attempted: reran local HTTP checks outside the sandbox.
- Issue: `pnpm exec playwright` failed because the Playwright binary is not installed in this repo. Workaround attempted: use local Chrome headless.
- Issue: Chrome headless became noisy/unstable during screenshot capture and the turn was interrupted. Mobile screenshot partially wrote to `/tmp/blog-demos-mobile.png`, but visual QA was not completed in that pass.

## Feedback Pass

- Reversed parent-pointer arrows so they point from child to parent instead of parent to child.
- Fixed figure 02 sequence arrow alignment and added first-character parent pointers up to the block labels.
- Reworked figure 03 to include a naive after-tree beside the before tree and user intent.
- Reworked figure 04 to include staged after-tree states and removed ambiguous movement arrows.
- Reworked figure 05 to use `the red dog` as the visible context and show `B1`, `B2`, and `B3` states without the previous wonky arrows.
- Reworked figure 06 to mirror figure 05 more closely while showing the metadata/tie-break reason for the merged result.
- Fixed figure 07 mark range bars so the add/remove bands start under the intended characters.
- Reversed figure 08 materialized parent arrows while preserving the ignored raw edge callout.
- Verification after feedback: `npm run build --prefix examples/block-rich-text` passed.
- Verification after feedback: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 58 tests.
