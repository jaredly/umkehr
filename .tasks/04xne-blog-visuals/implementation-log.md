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

## Static Scroll Pass

- Removed the lightweight interactivity from the demo gallery.
- Removed `StageButtons`, `useState` usage, and the stage button CSS.
- Changed figure 02 to stack the before and after split states vertically in one SVG.
- Changed figure 04 to render the before tree, split-path after tree, sibling-moved after tree, and final rendered order together.
- Changed figure 05 to render replica intents and the LWW merge result together.
- Changed figure 06 to render tagged replica states and the merged materialization together.
- Updated the App test that previously clicked `After split` so it now verifies the formerly staged states are present at once.
- Verification after static scroll pass: `npm run build --prefix examples/block-rich-text` passed.
- Verification after static scroll pass: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 58 tests.

## 02 Feedback Implementation Pass

- Responded to `.tasks/04xne-blog-visuals/02-feedback.md`.
- Figure 02: added concrete `B1` / `B2` root pills above first characters and moved `d.parent := B2` beside the `B2` after-state.
- Figure 03: reflowed from a three-column layout into full-width vertical rows for before tree, intended rendered result, and naive after tree.
- Figure 04: reflowed into larger full-width rows and simplified the final row around `B1`, `B2`, and a larger rendered-order strip.
- Figure 05: reflowed into stacked replica/result rows and added `intentional`, `incidental`, and `lost split` tags.
- Figure 06: mirrored figure 05's arrangement and replaced tiny code blocks with larger semantic metadata tags.
- Figure 07: enlarged the resolved-spans strip and made bold spans more visually prominent.
- Figure 08: moved the deterministic tie-break callout into the materialized-order panel.
- Verification after 02 feedback pass: `npm run build --prefix examples/block-rich-text` passed.
- Verification after 02 feedback pass: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 58 tests.

## 03 Feedback Implementation Pass

- Responded to `.tasks/04xne-blog-visuals/03-feedback.md`.
- Figure 04: replaced the old split-path/pending-dog state with a two-step operation sequence: first `dog.parent := tail(red)`, then `red.parent := B2`.
- Figure 05: rebuilt the conflict visualization around character trees with explicit parent pointers, and fixed Replica B so `B1` contains `the red` while `B3` contains `dog`.
- Figure 06: rebuilt the resolution visualization to mirror figure 05's character-tree layout, with metadata tags explaining why the intentional dog split wins.
- Figure 08: moved the ignored `A -> B` edge to the right side of the materialized-order panel to mirror the raw graph.
- Verification after 03 feedback pass: `npm run build --prefix examples/block-rich-text` passed.
- Verification after 03 feedback pass: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 58 tests.

## 04 Feedback Implementation Pass

- Responded to `.tasks/04xne-blog-visuals/04-feedback.md`.
- Figure 04: simplified the final rendered order card to show only rendered block results, including `B1: the` and `B2: red dog`, and removed the extra `red dog` character strip.
- Figure 05: swapped Replica A and Replica B actions so A is the split before dog and B is the split before red / `red dog` move. Updated the LWW callout to match the new story.
- Updated the demo-route test to assert the swapped Replica A/B labels.
- Verification after 04 feedback pass: `npm run build --prefix examples/block-rich-text` passed.
- Verification after 04 feedback pass: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 58 tests.

## Figure 06 Role Swap

- Updated figure 06 to use the same Replica A/B action swap as figure 05: A splits before dog, B performs the tagged split before red with incidental dog metadata.
- Updated the merge callout to explain that B's incidental metadata yields to A's intentional dog split.
- Issue: the demo-route test initially used a singular text query for `Replica A: split before dog`, but figures 05 and 06 now both contain that label. Fix: changed the test to assert two matching labels.
- Verification after figure 06 role swap: `npm run build --prefix examples/block-rich-text` passed.
- Verification after figure 06 role swap: `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` passed with 58 tests.
