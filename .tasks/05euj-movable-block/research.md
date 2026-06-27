# Research: Movable Block Type

## Goal

Add a rich-text block type named `movable` for `examples/block-rich-text`.

A movable block remains a normal CRDT block in the document tree, but eligible renderers take it out of the normal linear layout and render it with absolute positioning. Its metadata stores top/left coordinates.

The behavior should only be respected when the movable block is:

- a direct child of the document root, or
- a direct child of a `slide` block.

In all other positions, a `movable` block should still exist as a valid block type, but render in the normal linear tree.

## Current Architecture

The CRDT core already supports arbitrary block metadata. The core only requires a `ts` field for metadata conflict resolution. The example owns the actual metadata union in `examples/block-rich-text/src/blockMeta.ts`.

Relevant block metadata paths:

- `examples/block-rich-text/src/blockMeta.ts`
  - Defines `RichBlockMeta`, helpers like `sameTypeWithTs`, and type guards such as `isSlideBlock`.
- `examples/block-rich-text/src/blockTypeHelpers.ts`
  - Maps toolbar/menu values to rich block metadata.
- `examples/block-rich-text/src/blockEditorTypes.ts`
  - Defines `BlockTypeMenuValue`.
- `examples/block-rich-text/src/history.ts`
  - Validates persisted/replayed ops through `isRichBlockMeta`.
- `examples/block-rich-text/src/documentFormat.ts`
  - Imports/exports document JSON and enumerates every known block type.
- `examples/block-rich-text/src/pollBlocks.ts`
  - Provides the current custom metadata merge hook, `mergeRichBlockMeta`.

Rendering is editor-layer only:

- `examples/block-rich-text/src/EditorApp.tsx`
  - `buildRenderTree` builds a nested tree from `materializeFormattedBlocks`.
  - `renderBlockNode` renders normal block nodes.
  - `SlideBlockView` renders slide children inside `.slideBody`.
  - Root blocks render from `renderTree.map(...)` in the main editor article.
  - `renderEditableBlock` applies `blockType-${meta.type}` to each `.blockRow`.
- `examples/block-rich-text/src/style.css`
  - `.slideViewport` is already `position: relative`.
  - `.slideSurface` currently uses grid rows for title/body/footer.
  - `.slideBody` is currently flex-column and scrollable.

Block movement and drop targets use the visible CRDT outline, not DOM order alone:

- `examples/block-rich-text/src/blockCommands.ts`
  - `moveBlock`, `indentBlock`, `unindentBlock`, `visibleBlockChildren`, and slide helpers all preserve regular tree semantics.
- `examples/block-rich-text/src/useBlockReorder.ts`
  - Hit testing and drop indicators assume block rows occupy normal document flow.

## Proposed Data Shape

Add a metadata variant:

```ts
export type MovableBlockMeta = {
    type: 'movable';
    left: number;
    top: number;
    ts: HLC;
};
```

Then include it in `RichBlockMeta`.

Use numeric coordinates. The lowest-risk first version should treat them as CSS pixels in the coordinate space of the eligible containing surface:

- document root: the root editor content surface
- slide: the slide's inner positioning surface

For slide children, this raises a scale question because slide decks have logical `width`/`height` metadata and are rendered responsively. See open questions.

## Rendering Model

Keep `buildRenderTree` unchanged. Movable blocks should stay in the normal tree so selection, commands, import/export, undo, and remote sync continue to work with existing CRDT behavior.

Add a small renderer partition only at supported parent boundaries:

```ts
const isMovableBlock = (node: RenderTreeNode) => node.block.block.meta.type === 'movable';

const partitionMovableChildren = (
    parentNodeOrRoot: ...,
    children: RenderTreeNode[],
) => {
    const linear = [];
    const movable = [];
    // If the parent is root or a slide, split direct movable children into movable.
    // Otherwise keep everything in linear.
};
```

Root rendering can wrap the editor block list in a positioned container and render two layers:

- normal layer: all non-movable root children
- absolute layer: eligible root `movable` children

`SlideBlockView` can do the same inside the slide. The slide surface is already positioned indirectly by `.slideViewport`; adding a dedicated `.slideContentLayer` inside `.slideSurface` would avoid fighting the existing title/body/footer grid.

Important detail: children of a movable block should continue to render as descendants of that movable block. Only the movable block itself is removed from its eligible parent's normal child list.

## CSS Sketch

Root container:

```css
.editorCanvas {
    position: relative;
}

.movableBlockLayer {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.movableBlock {
    position: absolute;
    pointer-events: auto;
}
```

Slide surface:

```css
.slideSurface {
    position: relative;
}

.slideAbsoluteLayer {
    position: absolute;
    inset: 0;
}
```

The exact selectors should follow the existing `blockRow`/`renderTreeBranch` conventions. Avoid putting a movable wrapper inside another card-like wrapper; it should just establish positioning.

## Command And UI Touchpoints

Minimum block type plumbing:

- Add `'movable'` to `RichBlockMeta`.
- Add `'movable'` to `BlockTypeMenuValue`.
- Add menu conversion in `blockTypeMeta` and `blockTypeMenuValue`.
- Add `sameTypeWithTs` handling.
- Add history validation in `isRichBlockMeta`.
- Add document format support:
  - `DocumentBlockType`
  - `DocumentBlockMeta` with `top?: number` and `left?: number`
  - `BLOCK_TYPES`
  - `parseMeta`
  - `richMetaForDocumentBlock`
  - `documentBlockForMeta`

Metadata updates:

- Add a command like `setMovableBlockPosition(state, blockId, {top, left}, context)`.
- Use `setBlockMeta`/`setBlockMetaOps`, not a new CRDT op.
- Decide whether position edits should preserve concurrent non-position metadata. With a flat timestamped meta object, concurrent position updates are last-writer-wins for the whole movable meta.

UI options:

- Add `top` and `left` numeric controls in `BlockOptions` when `meta.type === 'movable'`.
- A later pass can add drag-to-position. Manual fields are easier to validate first.

Slash/menu entry:

- If slash commands and toolbar menus are expected to expose all block types, add a Movable entry there too. The type helper alone is not enough if no UI lets the user choose it.

## Eligibility Semantics

Recommended rule:

- A `movable` block is eligible when its visible/materialized parent id is root, or when its visible/materialized parent block has `meta.type === 'slide'`.
- Eligibility should be checked at render time, not stored in metadata.

Reasons:

- Moving a movable block under a normal paragraph should immediately make it linear.
- Moving it back to root or into a slide should immediately make the same metadata positional again.
- This keeps CRDT structure and rendering policy separate.

Be explicit about direct children. A movable grandchild inside a callout inside a slide should render linearly inside the callout, because its direct parent is not the slide.

## Drag/Drop Considerations

Existing block drag/drop is flow-based. Absolute root or slide blocks may not produce good drop indicators with the current row hit-testing.

Lowest-risk first version:

- Preserve existing block reorder drag handles.
- Let movable blocks be dragged/reordered as blocks in the CRDT outline.
- Use manual position fields for `top`/`left`.
- Do not implement drag-to-position in the first pass.

If drag-to-position is added later:

- It should update metadata, not issue `block:move`.
- It needs to distinguish "move this block in layout coordinates" from "reorder this block in the tree".
- Slide coordinate updates should account for current viewport scale.

## Selection And Editing

Because movable blocks still render `renderEditableBlock`, normal text selection and editing should mostly continue to work.

Areas to verify:

- DOM selection lookup in `domSelection.ts` queries `[data-block-id]`, so absolute position should be fine as long as the editable block keeps the same data attribute.
- Vertical caret movement may become surprising across absolute blocks because current logic assumes visual line proximity in normal flow.
- Root movable blocks overlaying normal blocks can interfere with pointer hit testing. Use explicit z-index/layering and keep absolute layer `pointer-events: none` with individual movable blocks `pointer-events: auto`.

## Import/Export And History Compatibility

This example validates historical actions and document JSON strictly. Adding a block type requires coordinated updates.

Without history validation updates, replaying ops containing movable metadata will fail with `block has invalid rich block metadata` or `has invalid rich block metadata`.

Without document format updates, exported movable blocks will either fail to type-check or be omitted from round-trippable metadata.

Suggested JSON shape:

```json
{
  "type": "movable",
  "meta": {"left": 120, "top": 80},
  "content": "Floating note"
}
```

## Testing Plan

Focused unit tests:

- `documentFormat.test.ts`
  - imports and exports a movable block with `top`/`left`
  - rejects non-finite or non-number coordinates
- `history.test.ts`
  - accepts `block` and `block:meta` ops with movable metadata
- `blockTypeHelpers` coverage if there is an existing helper test pattern
  - maps menu value to metadata and back

Rendering tests:

- Add or extend `App.test.tsx` to assert:
  - root movable direct child renders with absolute-position style/class
  - movable nested under a paragraph/callout renders in normal flow
  - movable direct child of a slide renders in the slide absolute layer
  - movable nested below a non-slide child inside a slide renders linearly

Manual QA:

- Create a movable root block and edit its text.
- Create a slide with normal children plus a movable child.
- Move the movable block under a normal block and back to root/slide.
- Verify selection, copy/paste, undo/redo, and history replay.

## Open Questions

1. Should `top`/`left` be CSS pixels in the rendered viewport, or logical coordinates in the slide deck coordinate system?

   For slides, logical coordinates are probably better because decks already store `width` and `height` and render responsively. For root-level movable blocks, CSS pixels may be acceptable unless the root needs zoom/presentation behavior.

2. Should movable blocks have `width` and/or `height` metadata too?

   Absolute positioning with only `top`/`left` leaves sizing to content. That is simple, but slide layouts often need stable boxes. A minimal first version can omit size, but it may make slide authoring less useful.

3. What is the default position when converting an existing block to `movable`?

   Options: `{top: 0, left: 0}`, derive from the block's current DOM rect, or use a small offset such as `{top: 80, left: 80}`. DOM-derived coordinates feel better but make command logic depend on rendering.

4. Should concurrent edits to `top` and `left` merge independently?

   The current metadata model is whole-object last-writer-wins by `ts`, except where `mergeRichBlockMeta` implements custom behavior for polls. If Alice edits `left` and Bob edits `top` concurrently, one update will currently win unless movable metadata gets custom merge logic.

5. Should a `movable` block be selectable/created everywhere, even though only root and slide parents respect it?

   The simplest model allows it everywhere and degrades to linear rendering when ineligible. A stricter model would prevent conversion except in eligible contexts, but that adds command/menu state complexity.

6. What z-order should multiple movable blocks use?

   Existing CRDT sibling order could define stacking order. If users need explicit z-index, that implies another metadata field and merge behavior.

7. How should root-level absolute positioning affect document height?

   Absolute children do not contribute to normal flow. The root canvas may need a minimum height or bottom padding based on movable block extents, otherwise root movable blocks can overflow invisibly or overlap following UI.

8. Should drag-to-position be part of the first implementation?

   It is user-visible and expected for a "movable" block, but it touches pointer handling, scale math, selection suppression, and history batching. A safer implementation can ship metadata, rendering, manual controls, and tests first.

## Recommendation

Implement this in two passes.

First pass:

- Add `movable` metadata with `top`/`left`.
- Add import/export/history/menu plumbing.
- Render eligible root and direct slide children in absolute layers.
- Add manual position controls.
- Add unit/rendering tests.

Second pass:

- Add drag-to-position with slide scale conversion.
- Add optional width/height and/or z-index if the first pass proves they are needed.
- Add custom metadata merge if concurrent independent coordinate edits matter.
