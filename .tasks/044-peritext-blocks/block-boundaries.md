# Block boundary behavior

## Problem

With explicit block `start` / `end` anchors, normal typing at range edges can become ambiguous:

- typing at the beginning of a block: should inserted text belong to this block or the previous
  block?
- typing at the end of a block: should inserted text belong to this block or the next block?

The naive answer is to update the block range after every edge insertion. That is not acceptable
for the common interaction of placing the caret at the end of a paragraph and typing a sentence.
It would turn ordinary text editing into a stream of structural block updates.

The block model should support typing at the beginning and end of a block without requiring a
block range update for every inserted character.

## Constraints

- Text identity remains in the global Peritext character sequence.
- Blocks claim ranges in that sequence with `start` and `end`.
- Drag-to-reorder should move structural placement without moving text characters.
- Split/join can update block ranges, but normal typing should usually only emit text insert ops.
- Materialization must remain deterministic under concurrent edits.

## Option 1: rely on plain anchors

Use only the existing Peritext anchors:

```ts
type BlockRange = {
    start: RichTextAnchor;
    end: RichTextAnchor;
};
```

The hope is that choosing `before` / `after` anchors carefully is enough:

- `start` can be inclusive;
- `end` can be exclusive for static range math;
- appending at the end inserts after the previous character and still falls inside the block.

Benefits:

- No new boundary metadata.
- Keeps block range shape simple.

Costs:

- Boundary insertion behavior becomes implicit and fragile.
- It is hard to express "text typed here should stick to this block" when multiple blocks share or
  nearly share the same text position.
- Drag-to-reorder makes visual neighbors diverge from text-stream neighbors, increasing ambiguity.
- Concurrent inserts at the same anchor may be assigned to surprising blocks.

This is probably too underspecified for reliable editor behavior.

## Option 2: update ranges on edge insert

When inserting at a block edge, also emit a structural range update:

- typing at block start may move `start` to before the inserted text;
- typing at block end moves `end` to after the inserted text.

Benefits:

- Very explicit.
- Materialization can stay simple.

Costs:

- Bad write amplification for ordinary typing.
- Typing a sentence at the end of a block produces many block updates.
- Undo/redo and history grouping become noisier.
- It couples text insertion hot paths to structural metadata churn.

This should be avoided.

## Option 3: block-local insertion intent

Add an optional block ownership hint to character insert operations:

```ts
type RichTextInsertOperation = {
    action: 'insert';
    opId: RichTextOpId;
    afterId: RichTextOpId | null;
    char: string;
    blockId?: RichTextBlockId;
};
```

Materialization can assign the character to `blockId` when the character lands at an ambiguous
boundary.

Benefits:

- Normal typing only emits insert operations.
- The editor can express the intended block directly.
- Handles visually reordered blocks better than global-index-only insertion.

Costs:

- Character operations now know about block structure.
- It is unclear what happens if the target block is deleted, moved, or has its range changed.
- Imported or non-editor-generated text may lack block hints.
- Ownership hints can conflict with range claims, so materialization still needs repair rules.

This is useful as a possible editor hint, but it should not be the core range model unless sticky
boundaries prove insufficient.

## Option 4: implicit edge stickiness in materialization

Keep `start` / `end` as plain anchors, but define materialization rules:

- text inserted exactly at a block's start sticks to that block;
- text inserted exactly at a block's end sticks to that block;
- orphan/contested repair only applies after these edge rules.

Benefits:

- No extra stored metadata.
- Normal typing can avoid range updates.

Costs:

- The behavior is hidden in materialization policy.
- Different block types cannot choose different boundary behavior.
- It is harder to test and reason about than explicit boundary metadata.

This is viable, but explicit boundary metadata is clearer.

## Option 5: sticky boundary markers

Represent block range edges as anchors plus affinity/stickiness:

```ts
type RichTextBlockBoundary = {
    anchor: RichTextAnchor;
    affinity: 'before' | 'after';
};

type RichTextBlockRange = {
    start: RichTextBlockBoundary;
    end: RichTextBlockBoundary;
};
```

The boundary says how inserts at the same text position should be classified relative to the
block. This is similar to cursor/selection affinity in editors.

Possible default behavior:

- block `start` includes text typed at the beginning of the block;
- block `end` includes text typed at the end of the block;
- split/join operations may create or change boundaries;
- ordinary typing does not update block ranges.

Benefits:

- Avoids structural churn during ordinary typing.
- Keeps text insert operations independent of block structure.
- Makes edge behavior explicit and testable.
- Supports moved blocks because ownership is tied to the block's own boundaries, not visual
  siblings.

Costs:

- Range resolution becomes more complex.
- Affinity semantics must be specified against Peritext's character ordering rules.
- Concurrent inserts at the same anchor still need deterministic tie-breaks.

This is viable, but newline-anchored ranges are currently more attractive if we accept structural
newline sentinels.

## Option 6: newline-anchored block ranges

Keep newline characters in the global character stream and require block `start` / `end` to anchor
only to newline boundary characters.

In this model, a block's text is the span between two newline sentinels:

```text
\nFirst block\nSecond block\n
  ^ start A   ^ end A / start B
```

Typing behavior becomes much simpler:

- typing before the ending newline adheres to the previous block;
- typing after the starting newline adheres to the following block;
- a block start is "after this newline";
- a block end is "before this newline".

Suggested shape:

```ts
type RichTextBlockBoundary = {
    newlineId: RichTextOpId;
    side: 'after' | 'before';
};

type RichTextBlockNode = {
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
    start: {newlineId: RichTextOpId; side: 'after'};
    end: {newlineId: RichTextOpId; side: 'before'};
    attrs: RichTextBlockAttrs;
    deleted: boolean;
};
```

Benefits:

- Edge typing mostly falls out of ordinary character-stream insertion:
  - insert before end newline to append to this block;
  - insert after start newline to prepend to this block.
- No range update is needed for normal typing at the start or end of a block.
- The boundary markers are visible in the CRDT sequence and have stable character IDs.
- The renderer can hide structural newlines while `plainText` can synthesize or expose them
  consistently.
- Split creates a new newline sentinel; join deletes/removes a newline sentinel.

Costs:

- Every block range depends on structural newline characters that must not be casually deleted by
  ordinary text editing.
- Empty blocks are represented by adjacent newlines.
- Blocks now have both explicit block nodes and newline boundary sentinels, so there is some
  duplication.
- Drag-to-reorder still means visual order can differ from text-stream order; newline sentinels
  solve edge typing but not all split/join semantics.
- Nested blocks need clear rules for whether container boundaries also use newlines or only leaf
  text blocks do.

This is very attractive for edge typing. It is probably better than arbitrary sticky boundaries if
we are comfortable treating newlines as structural sentinels in the character stream.

## Split and join with moved blocks

Drag-to-reorder separates visual adjacency from text-stream adjacency. That creates an important
semantic question:

> If two neighboring rendered blocks are attached to far-apart spans in the character stream, what
> does it mean to join them?

There are two possible notions of adjacency:

- visual adjacency: blocks are next to each other under `parentId + order`;
- text adjacency: one block's `end` boundary is the same as, or directly touches, the other block's
  `start` boundary in the global character stream.

Split is local and remains well-defined:

- splitting a block creates a new boundary inside that block's own text range;
- with newline sentinels, split inserts a new structural newline at the caret;
- the two resulting blocks are text-adjacent at the new newline;
- structural order can place the new block immediately after the old block.

Join is only semantically clean for text-adjacent blocks:

- if two blocks share/touch a boundary in the character stream, join can remove that boundary and
  merge their ranges without moving text;
- with newline sentinels, join deletes/removes the separating newline sentinel;
- no character identity is lost.

For visual-adjacent but text-disjoint blocks, a "join" cannot mean ordinary paragraph join without
one of these extra choices:

- move text in the character stream, which violates the non-destructive movement goal;
- create a new block that claims two disjoint ranges, which complicates rendering and editing;
- retarget one block's range to cover the gap, which may sweep in unrelated/orphaned text;
- reject the join as not text-adjacent.

Recommended rule:

- `joinBlock` should require text adjacency.
- If the previous/next visual block is not text-adjacent, Backspace/Delete at the visual boundary
  should perform a structural move/reorder action or do nothing, not a text join.
- Editor UI can expose this distinction: visual drag order is not the same as underlying text
  adjacency.

This keeps join coherent and non-destructive. It also suggests that moved blocks may need a
separate "normalize text order" command if we ever want to rewrite the character stream to match
visual block order.

## Proposed semantics

Use newline-anchored block ranges if possible. If newline sentinels prove too constraining, fall
back to sticky boundaries for arbitrary anchors.

```ts
export type RichTextBlockBoundary = {
    newlineId: RichTextOpId;
    side: 'before' | 'after';
};

export type RichTextBlockNode = {
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
    start: RichTextBlockBoundary;
    end: RichTextBlockBoundary;
    attrs: RichTextBlockAttrs;
    deleted: boolean;
};
```

Interpretation:

- `start` should be the `after` side of a newline sentinel.
- `end` should be the `before` side of a newline sentinel.
- block text is the visible character span between those newline boundaries.
- block-aware editor insertion should still know the current block ID for command routing, but it
  should not need to store that block ID on every inserted character.

Default typing behavior:

- typing at the start inserts after the start newline.
- typing at the end inserts before the end newline.
- the structural newlines are hidden or specially handled by the editor.
- ordinary character insertion does not move block ranges.

## Materialization order

Materialization should resolve text ownership in this order:

1. Resolve block `start` / `end` newline boundary positions.
2. Clamp block ranges to parent ranges.
3. Assign characters strictly inside a block range.
4. Treat structural newline sentinels as hidden block boundaries, not rendered block content.
5. Repair contested text by deterministic block ID ordering.
6. Repair orphaned text by attaching it to the preceding touching block when possible.

Contested text should use parsed block ID ordering, not raw lexical string ordering.

## Tests to add

- Typing at the beginning of a block inserts text into that block without a range update.
- Typing at the end of a block inserts text into that block without a range update.
- Typing at the boundary between two blocks is deterministic.
- Drag-to-reordered blocks keep edge typing inside the active block.
- Splitting a block inserts a newline sentinel and creates two text-adjacent blocks.
- Joining text-adjacent blocks removes the separating newline sentinel.
- Joining visual-adjacent but text-disjoint blocks is rejected or treated as a non-text structural
  command.
- Concurrent inserts at the same block start converge.
- Concurrent inserts at the same block end converge.
- Contested text repair still works after applying newline-boundary range resolution.
- Orphaned text repair still works after applying newline-boundary range resolution.

## Recommendation

Prefer newline-anchored block ranges. They make ordinary start/end typing cheap and coherent:
insert after the start newline or before the end newline, without updating block ranges. Keep
sticky arbitrary boundaries as a fallback design if newline sentinels become too restrictive.

For split/join, define join in terms of text adjacency, not visual adjacency. Visual-adjacent
blocks that are far apart in the character stream should not be joined by silently moving or
retargeting text.
