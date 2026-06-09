# Research: Block CRDT State Visualization

## Goal

Create a clear visualization of the `block-crdt` internal state for the blog post in
`src/block-crdt/Blog Post.md`, with a possible live version shown at the bottom of each
editor in `examples/block-rich-text`.

The visualization should explain both the user-facing materialized document and the
stored CRDT records behind it:

- character parent trees and tombstones
- block ordering and nesting
- split records and incidental character reparenting
- join records and join sentinels
- cycle breaking for block parent paths
- formatting marks when present

SVG is a good target because the blog can embed static diagrams and the demo can render
the same model live in React.

## Current Implementation Shape

Relevant files:

- `src/block-crdt/types.ts`
- `src/block-crdt/cache.ts`
- `src/block-crdt/traversal.ts`
- `src/block-crdt/blocks.ts`
- `src/block-crdt/changes.ts`
- `src/block-crdt/marks.ts`
- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/style.css`

The CRDT state is stored as:

- `state.blocks`: stable block records keyed by Lamport id string.
- `state.chars`: stable character records keyed by Lamport id string.
- `state.marks`: formatting mark records.
- `state.splits`: split records, keyed by split block id.
- `state.joins`: join records.
- `state.maxSeenCount`: Lamport counter bookkeeping.

The cache derived by `cachedState` / `organizeState` is the most useful visualization
entry point:

- `cache.blockChildren[parentId]`: materialized block children sorted by LSEQ index.
- `cache.charContents[parentId]`: materialized character children sorted by Lamport id
  descending.
- `cache.joinSentinels[rightBlockId]`: synthetic char-like sentinels inserted into the
  character tree so joined block contents appear after the left block tail.
- `cache.joinedBlocks[rightBlockId]`: hidden right blocks for active joins.

Important traversal helpers already expose the user-facing view:

- `visibleBlockOutline(state)` gives visible block ids with depth and visible parent.
- `visibleBlockChildren(state, parentId)` resolves hidden/deleted/joined blocks away.
- `orderedCharIdsForBlock(state, blockId, {visibleOnly})` gives character order for a
  block.
- `blockContents(state, blockId)` and `stateToString(state)` are text-oriented summaries.
- `materializeFormattedBlocks(state)` resolves visible text into formatting runs.

Important raw/materialized block parent helpers:

- `materializedBlockPath(state, blockId)`
- `materializedBlockParent(state, blockId)`
- `materializedBlockPaths(state)`

`blocks.ts` computes cycle-broken parentage from raw `block.order.path`. The rejected
root set is currently internal to the module, but it is exactly the kind of information a
cycle-breaking visualization should surface.

## Blog Post Needs

The current blog post has placeholder diagram slots for:

1. A causal-tree/RGA character sequence where each char has a Lamport id and parent.
2. Moving text by updating character parent references.
3. A naive split that only reparents one character and mishandles sibling nodes.
4. A correct split that also reparents following sibling subtrees.
5. Concurrent splits where incidental reparenting can conflict with intentional splits.
6. The richer incidental reparent timestamp containing an ancestor path.
7. Peritext-style formatting marks anchored to start/end character ids.
8. Cycle breaking for block nesting and joins.

The visualization should be able to render canonical hand-authored examples for these
sections, not only live demo state. A static blog diagram benefits from labels and
controlled layout more than a faithful dump of a large state.

## Recommended Architecture

Introduce a small visualization-model layer before rendering SVG.

Suggested module:

- `src/block-crdt/visualization.ts`, if it should be a reusable library helper.
- Or `examples/block-rich-text/src/stateVisualization.ts`, if it should stay demo-only.

I recommend starting demo-local, then moving the stable model builder into
`src/block-crdt` once the shape is proven. The renderer can stay in the example/blog
tooling.

Suggested split:

1. `buildCrdtVisualizationModel(state, options)` converts `CachedState` into plain
   structured data.
2. `CrdtStateSvg` renders that model as SVG/React.
3. Blog-specific examples can build either real `State` objects or hand-authored
   `CrdtVisualizationModel` fixtures.

This keeps layout and styling separate from CRDT semantics. It also makes tests simple:
verify the model contains the right nodes, edges, hidden blocks, join sentinels, and mark
coverage without snapshotting a whole SVG.

## Suggested Visualization Model

The model should preserve both raw and materialized relationships:

```ts
type CrdtVisualizationModel = {
    blocks: VisualBlock[];
    chars: VisualChar[];
    blockEdges: VisualEdge[];
    charEdges: VisualEdge[];
    splitRecords: VisualSplitRecord[];
    joinRecords: VisualJoinRecord[];
    marks: VisualMark[];
    warnings: VisualWarning[];
};
```

Useful block fields:

- `id`
- short display id, for example `1:A`
- `meta.type`
- `deleted`
- `joinedInto?: string`
- `rawParentId?: string | null`
- `materializedParentId`
- `depth`
- `orderIndex`
- `orderTs`
- `orderPath`
- `cycleRejected?: boolean`

Useful char fields:

- `id`
- short display id
- `text`
- `deleted`
- `parentId`
- `parentTs`
- `parentTsKind: 'normal' | 'incidental-split'`
- `blockId`, if resolved for the materialized visible block
- `visible`
- `isJoinSentinel`

Useful mark fields:

- `id`
- `type`
- `data`
- `remove`
- `start`
- `end`
- `crossedSplits`
- resolved covered char ids

The model should include unresolved/raw information instead of only the nice view. The
point of the visualization is to show why the nice view emerges.

## Granularity Modes

### 1. Outline Mode

Shows only blocks:

- block nodes arranged as a tree using `visibleBlockOutline`
- block type badges for paragraph, quote, bullets, checkboxes
- deleted blocks greyed out when raw mode is enabled
- joined right blocks shown as hidden/absorbed
- raw parent edges shown faintly
- materialized parent edges shown strongly
- cycle-broken parent candidates highlighted

This is the best default for a compact panel under each editor.

### 2. Block Detail Mode

Shows one selected block's character tree:

- root node is the block id
- each character is a node with visible text and short Lamport id
- parent edges from each char to its parent
- deleted chars as hollow or struck nodes
- ordering from `cache.charContents` represented left-to-right
- join sentinel nodes when a joined right block is grafted under the left tail
- split record edges between `left` and `right`
- incidental reparent moves rendered with a distinct edge style

This mode maps directly to the main blog diagrams about split behavior.

### 3. Document Detail Mode

Shows all visible blocks and their character trees, probably in stacked rows:

- each block row begins with block id/meta/path details
- chars appear as a mini tree or ordered strip
- split and join records can cross rows
- formatting overlays can be drawn as arcs or colored underlines across char spans

This is useful for debugging but can become dense quickly. It should be collapsible or
only used in wide layouts.

### 4. Operation Explanation Mode

Given previous state, next state, and a list of ops, show what changed:

- new blocks/chars highlighted
- moved char parent edges highlighted
- new split/join/mark records highlighted
- changed block order path/index highlighted

This would be especially strong for the blog post. It also matches the existing
`examples/block-rich-text` history replay model, where each action already records ops.
It is more work than a state-only viewer, so it can be a second phase.

## Rendering Approach

SVG should work well for the first implementation.

Recommended layout:

- Use deterministic simple layout first, not a graph layout dependency.
- For outline mode, use tree rows based on `visibleBlockOutline` depth.
- For block detail mode, use recursive character-tree layout from
  `cache.charContents[parentId]`, with stable node widths.
- Use marker arrows for raw parent/move edges.
- Use dashed edges for hidden/raw/non-materialized relationships.
- Use solid edges for current materialized relationships.
- Use color sparingly:
  - text chars: neutral
  - deleted/tombstone: muted
  - split records/incidental reparent: blue or teal
  - join records/sentinels: amber
  - formatting marks: small colored bands or outlines
  - cycle rejection/warnings: red

The SVG renderer should accept dimensions or compute height from the model. For live demo
panels, constrain height with scroll rather than shrinking text.

## Demo Integration

`examples/block-rich-text/src/App.tsx` already has all state needed per editor:

- `BlockEditor` receives `replica: Replica`.
- `replica.state` is a `CachedState`.
- `materializeFormattedBlocks(replica.state)` is computed in `BlockEditor`.
- The history slider can replay to any state.

A first live integration could add below `.blockList`:

```tsx
<details className="stateVizPanel">
    <summary>State</summary>
    <CrdtStateSvg state={replica.state} mode="outline" />
</details>
```

Implementation notes:

- Keep it collapsed by default unless the blog/demo specifically wants it visible.
- Add a small mode selector for `outline`, `block`, and `document`.
- In `block` mode, default to the primary selection's focused block.
- Use existing `replica.queue.length` and online/offline status only as panel context, not
  part of the CRDT model.
- Avoid coupling visualization to DOM selection. Use CRDT state and retained selection
  only for choosing the active block or highlighting selected chars.

CSS can extend the existing editor panel style:

- `.stateVizPanel` as a bottom region with top border
- fixed max height and `overflow: auto`
- SVG labels at 11-12px, no viewport-scaled type
- neutral background to avoid competing with the editor

## Formatting Representation

Formatting is currently represented by `Mark` records:

- `start` and `end` are character boundaries.
- `remove` marks cancel prior marks of the same type by Lamport id.
- `type` is currently used for `bold` and `italic` in the demo.
- `data` can hold arbitrary mark payload.
- `crossedSplits` records split ids that the mark intentionally crosses.

For high-level rendering, `materializeFormattedBlocks` is enough: draw formatted runs as
text spans or bands.

For internal-state rendering, show raw mark records:

- draw an arc/band from start char to end char
- label type and short mark id
- draw remove marks as red/struck bands
- show crossed split ids on the mark label or in a side legend
- optionally show resolved covered char ids from the same logic used by
  `materializeFormattedBlocks`

The mark coverage logic in `marks.ts` is currently private. If the visualization needs
accurate raw mark spans, consider exporting a helper that returns mark coverage instead
of duplicating the traversal logic in the example.

## Cycle Breaking Representation

Block parent cycle detection is implemented in `blocks.ts`:

- raw parent is derived from `block.order.path`.
- cycles are detected from raw parent links.
- the winner to reject as a root is the cycle item with the smallest
  `blocks[item].order.id` by Lamport comparison.
- rejected blocks are materialized as roots.

The visualization needs `rawParents` and `rejectedRoots`. Today
`deriveBlockParentsForBlocks` is not exported from `src/block-crdt/index.ts`, and its
return type includes exactly this information. Options:

1. Export `deriveBlockParentsForBlocks` and `BlockParentDerivation`.
2. Export a narrower `blockParentDiagnostics(state)` helper.
3. Keep visualization inside `src/block-crdt` where it can import from `blocks.ts`
   directly.

Option 2 is cleanest for public API: it exposes diagnostic data without making the
internal strategy name part of the API.

## Testing Strategy

Model-builder tests should cover:

- plain text in one block
- deleted chars/tombstones
- split in a sequential block
- split in a block with sibling character subtrees
- concurrent split records
- join record and join sentinel
- moved/nested blocks
- block parent cycle with rejected root diagnostics
- bold/italic marks and remove marks
- mark crossing a split

Renderer tests can be lighter:

- assert SVG contains expected accessible labels/text for a small state
- optionally screenshot the live demo with Playwright if the visualization is always
  visible

The existing test suite already has focused block CRDT and rich text tests that can
provide fixture patterns:

- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`
- `src/block-crdt/organizeState.stress.test.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`

## Implementation Phases

### Phase 1: Static State Model and Outline SVG

- Build `CrdtVisualizationModel` from `CachedState`.
- Render outline mode under each editor in a collapsed details panel.
- Show visible/materialized block tree and raw parent hints.
- Add tests for model generation.

### Phase 2: Character Detail Mode

- Add selected-block char tree.
- Show char parent edges, tombstones, split records, and join sentinels.
- Add a block selector or use current selection focus.

### Phase 3: Formatting and Diagnostics

- Add mark bands/arcs.
- Add cycle rejection diagnostics.
- Consider exporting `blockParentDiagnostics` and mark coverage helpers.

### Phase 4: Blog Diagram Fixtures

- Create deterministic fixtures for each blog diagram.
- Render static SVG files or a small route/page that can be screenshotted/exported.
- Add operation-diff mode if the blog needs before/after explanation panels.

## Open Questions

1. Should the visualization be primarily a debugging tool in the live demo, or primarily
   a polished blog-figure generator? The best default layout differs.
    - primarily a polished blog-figure generator
2. Should blog diagrams be generated from real CRDT states/ops, or hand-authored
   visualization fixtures that only mimic the model? Real states are more honest;
   fixtures are easier to label and compose.
    - real states
3. Do we want to expose new public diagnostic APIs from `src/block-crdt`, such as
   `blockParentDiagnostics` and mark coverage, or keep the visualization demo-local?
    - probably not exposing new apis
4. How much raw detail should be visible by default under the editors? Full char trees can
   overwhelm the editing demo.
    - we'll keep the number of characters down to a manageable number for the "char trees" demo, and for larger documents we'll want a different visualization
5. Should operation-diff visualization be in scope for the first implementation? It would
   make split/join explanations much clearer, but it is more than a state snapshot.
    - yeah that would be great
6. Should deleted blocks and joined-right blocks be shown in outline mode by default, or
   only when a "raw records" toggle is enabled?
    - let's show everything
7. What id formatting is preferred for the blog: compact Lamport ids like `3:A`, full
   string ids, or semantic labels assigned by fixtures?
    - compact ids
8. Should formatting marks be shown as raw CRDT mark records, user-facing resolved
   formatting runs, or both?
    - both (set by a toggle)
9. For cycle breaking, should the diagram show the exact rejected root winner rule, or
   only show that one raw edge was ignored to restore an acyclic tree?
    - only the ignored edge
10. Should live visualization include selections/presence from `examples/block-rich-text`,
    or stay focused on document state only?
    - so it could be nice to highlight the currently selected block/char

## Recommendation

Start with a deterministic model builder plus a compact outline SVG under each editor.
That gives immediate value in the live demo and establishes the data contract. Then add a
selected-block character detail mode for the blog's split/join diagrams. Avoid trying to
make one graph view explain every concept at once; the CRDT has multiple meaningful
graphs, and separate modes will be clearer than a single dense diagram.
