# Plan: Block CRDT State Visualization

## Direction

Build a blog-quality SVG visualization system from real `block-crdt` states and ops. The
live editor integration is useful, but secondary. The implementation should prioritize
small deterministic examples that can become polished diagrams for
`src/block-crdt/Blog Post.md`.

Important decisions from research:

- Generate diagrams from real CRDT states/ops, not hand-authored fake graph fixtures.
- Keep visualization APIs local/internal for now; do not expand the public package API
  unless implementation pressure makes it necessary.
- Use compact Lamport id labels, for example `3:A`.
- Include operation-diff visualization in scope.
- Show deleted blocks, joined-right blocks, tombstones, join sentinels, and other raw
  records by default.
- Show formatting as both raw mark records and resolved user-facing formatting, selected
  by a toggle.
- For cycle breaking, show the ignored raw edge, not the full winner-rule explanation.
- In live demo usage, optionally highlight the currently selected block/char.

## Phase 1: Visualization Model

Create a state-to-visualization model that is independent of SVG layout.

Files:

- Add `examples/block-rich-text/src/stateVisualization.ts`.
- Add `examples/block-rich-text/src/stateVisualization.test.ts`.

Tasks:

- Define `CrdtVisualizationModel` with blocks, chars, edges, splits, joins, marks,
  warnings, and optional highlighted ids.
- Include raw and materialized block relationships:
  - raw parent from `block.order.path`
  - materialized parent from existing block parent derivation behavior
  - deleted and joined blocks
  - ignored raw cycle edges when detectable
- Include raw and materialized char relationships:
  - char parent ids
  - deleted/tombstone status
  - join sentinel pseudo-nodes from `cache.joinSentinels`
  - char membership for visible/materialized blocks
  - normal versus incidental split parent timestamps
- Include split and join records directly from `state.state.splits` and
  `state.state.joins`.
- Include formatting data:
  - raw mark records from `state.state.marks`
  - resolved formatted runs from `materializeFormattedBlocks`
- Add compact id formatting helpers for Lamport ids and root/sentinel labels.
- Accept options:
  - `mode: 'outline' | 'block-detail' | 'document-detail' | 'operation-diff'`
  - `selectedBlockId?: string`
  - `highlightedCharIds?: string[]`
  - `formattingView?: 'resolved' | 'raw' | 'both'`
  - `includeRawRecords?: boolean`, default `true`

Notes:

- Keep this example-local initially to avoid public API churn.
- If cycle diagnostics require too much duplication from `src/block-crdt/blocks.ts`,
  import from the source module if feasible inside the repo. If that becomes brittle, add
  a narrowly named internal helper rather than exporting a broad public API.

Verification:

- Tests should assert the model for:
  - one block with plain text
  - tombstoned chars
  - split record and moved char parent
  - join record and join sentinel
  - nested/moved blocks
  - cycle-broken raw block edge, if practical to construct
  - raw mark plus resolved formatting

## Phase 2: Operation Diff Model

Add support for rendering what changed between two real states.

Files:

- Extend `examples/block-rich-text/src/stateVisualization.ts`.
- Add/extend `examples/block-rich-text/src/stateVisualization.test.ts`.

Tasks:

- Define `CrdtVisualizationDiff` or add `diff` fields to `CrdtVisualizationModel`.
- Build diff metadata from `{before, after, ops}`:
  - added blocks
  - added chars
  - deleted chars/blocks
  - moved char parent edges
  - moved block order/path edges
  - added split records
  - added join records
  - added raw marks
- Preserve access to both before and after materialized relationships so diagrams can
  draw old edges faintly and new edges strongly.
- Support operation-focused labels such as `char:move`, `split-record`, `join-record`,
  and `mark`.

Verification:

- Tests should use real ops from `insertTextOps`, `splitBlockOps`, `joinBlocksOps`,
  `moveBlockOps`, and `markRangeOp`.
- Assert that changed ids and changed edges are identified without relying on SVG output.

## Phase 3: SVG Renderer

Render the visualization model as deterministic SVG suitable for screenshots and blog
embedding.

Files:

- Add `examples/block-rich-text/src/CrdtStateSvg.tsx`.
- Add `examples/block-rich-text/src/CrdtStateSvg.test.tsx` if existing test setup makes
  React SVG assertions straightforward.
- Extend `examples/block-rich-text/src/style.css`.

Tasks:

- Implement shared SVG primitives:
  - compact node boxes
  - char circles/boxes
  - block rows
  - directed edges with markers
  - dashed ignored/raw edges
  - highlighted changed edges/nodes
  - small legends for mark/split/join colors
- Implement `outline` rendering:
  - show all blocks, including deleted and joined-right blocks
  - show materialized tree strongly
  - show raw ignored/cycle edge faintly or dashed
  - show joined blocks as absorbed/hidden, not omitted
- Implement `block-detail` rendering:
  - show selected block's char tree
  - show tombstones
  - show join sentinel pseudo-nodes
  - show split record connectors
  - show incidental reparent edges distinctly
- Implement `document-detail` rendering:
  - show manageable documents as stacked block rows with char strips/trees
  - show formatting overlays according to `formattingView`
- Implement `operation-diff` rendering:
  - show before/after or overlaid changed nodes/edges
  - make changed ops visually obvious enough for blog diagrams
- Keep layout deterministic and simple. Do not add a graph layout dependency unless the
  manual layout becomes unworkable.

Design constraints:

- Use stable dimensions, fixed label sizes, and scrollable containers for large diagrams.
- Avoid dense color palettes; use color for semantic categories only.
- Keep text readable in exported screenshots.

Verification:

- Unit tests can assert rendered labels, SVG roles/labels, and important CSS class names.
- Manual visual check with Vite/Playwright once integrated.

## Phase 4: Blog Diagram Fixtures

Create real CRDT scenarios that correspond to the blog post's diagrams.

Files:

- Add `examples/block-rich-text/src/stateVisualizationFixtures.ts`.
- Optionally add `examples/block-rich-text/src/StateVisualizationGallery.tsx`.
- Add tests for fixture construction if they build non-trivial states.

Fixtures:

- Causal-tree/RGA character sequence with parent arrows.
- Text move by changing a char parent.
- Naive split illustration, if representable as a comparison or deliberately constructed
  state.
- Correct split with following sibling subtree reparenting.
- Concurrent split conflict showing intentional versus incidental parent timestamps.
- Rich incidental reparent timestamp with ancestor path.
- Formatting marks anchored to start/end character ids.
- Join record and join sentinel.
- Block nesting cycle with ignored raw edge.

Tasks:

- Build each fixture using real `block-crdt` state and real ops wherever possible.
- For cases that represent an intentionally naive/wrong algorithm, either:
  - construct the state manually but using real `State` shape, or
  - document that it is an explanatory counterexample fixture.
- Add a gallery view that renders all fixtures in the intended blog order.
- Add stable names and captions near the gallery for screenshot/export workflow.

Verification:

- Tests should ensure each fixture can build a `CachedState` and a visualization model
  without throwing.
- The gallery should render all diagrams without overlapping labels at desktop width.

## Phase 5: Live Editor Integration

Add the visualization to `examples/block-rich-text` as an optional panel below each
editor.

Files:

- Update `examples/block-rich-text/src/App.tsx`.
- Update `examples/block-rich-text/src/style.css`.

Tasks:

- Add a collapsed `details` panel beneath `.blockList`.
- Render `CrdtStateSvg` using `replica.state`.
- Add controls for:
  - mode: outline, selected block, document, operation diff if available
  - formatting view: resolved/raw/both
- In block-detail mode, default to the primary selection's focused block.
- Highlight the currently selected block and, when feasible, selected chars.
- Keep the panel independent of DOM selection mechanics; derive highlights from retained
  selection and CRDT ids.
- If operation-diff mode needs history context, wire it at the `App` level where
  `history.actions` and `history.cursor` are available rather than inside `BlockEditor`.

Verification:

- Existing rich-text behavior should remain unchanged.
- Run the block-rich-text tests.
- Start the Vite dev server and inspect the panel in at least:
  - initial empty state
  - text insertion
  - split
  - join
  - formatting
  - offline edit and replayed sync

## Phase 6: Screenshot/Export Workflow

Make it easy to produce blog assets.

Files:

- Add a gallery route/page if the app structure supports it cleanly, or a gallery
  component toggled from the main demo.
- Optionally add a script under the example package for screenshots.

Tasks:

- Provide a deterministic page containing the fixture gallery.
- Use Playwright to capture SVG diagrams or full-page screenshots.
- Decide whether the final blog assets are:
  - checked-in SVG files
  - checked-in PNG screenshots
  - generated on demand from the gallery
- Document the workflow in the task implementation log or a short README near the
  fixtures.

Verification:

- Screenshot command produces repeatable output.
- Exported diagrams have compact ids and readable labels.

## Suggested Order of Work

1. Build and test the visualization model.
2. Build the operation-diff model.
3. Implement SVG renderer for outline and block-detail first.
4. Create the blog fixture gallery.
5. Add formatting and document-detail polish.
6. Integrate the optional live panel in the editor.
7. Add screenshot/export workflow.

This order keeps the core semantics testable before investing in visual polish, while
still aiming at the real goal: blog-ready diagrams from real CRDT states.
