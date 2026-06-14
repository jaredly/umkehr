# Peritext block editing research

## Summary

Use first-class block nodes layered over the existing global Peritext character sequence.

The important constraint is that blocks should not own their own text CRDTs. Text identity should
remain in `chars`, where inserts, removes, marks, comments, selections, and history already refer to
stable character operation IDs. Blocks should own structure:

- stable block identity;
- parent/child relationships;
- sibling order;
- block type and attributes;
- a claimed text range in the global character sequence.

For Notion-style block editing, the block's text range and the block's tree placement need to be
separate. Dragging a block in the tree should update placement only. Splitting and joining should
update block range metadata only. None of these operations should delete and reinsert characters.

The main design change from the earlier start-only block model is that movable blocks need explicit
`start` and `end` anchors. If a block's end is inferred from the next visual sibling, then moving
siblings changes text ownership. That makes non-destructive drag/reparenting impossible once visual
tree order can diverge from text-stream order.

## Current implementation baseline

The current `src/peritext` implementation is an inline Peritext core:

- `RichTextState` contains `chars` and optional rich-text-level `pending`.
- Each character has a stable `opId`, `afterId`, `char`, and `deleted` flag.
- Rich text marks are historical range operations attached at character boundaries.
- `materializeRichTextState` emits `plainText` and inline `spans`.
- There is no block state in `RichTextState` yet.
- `emptyRichTextState()` returns `{chars: []}`.
- Current snapshots are span-only.

Relevant files:

- `src/peritext/types.ts`
- `src/peritext/sequence.ts`
- `src/peritext/marks.ts`
- `src/peritext/materialize.ts`
- `src/peritext/apply.ts`
- `src/peritext/ids.ts`

The earlier `.tasks/044-peritext-blocks` research already settled several useful defaults:

- blocks should be explicit nodes, not newline attributes or ordinary marks;
- blocks should not own text;
- `plainText` can synthesize newlines between materialized blocks;
- block attrs can initially resolve as whole-object last-writer-wins;
- block IDs can share the rich-text operation counter namespace;
- inline marks may span block boundaries.

This note updates that direction for arbitrary nesting, drag/reparent/reorder, and non-destructive
split/join.

## Recommended model

Add explicit block nodes to `RichTextState`:

```ts
export type RichTextBlockId = RichTextOpId;

export type RichTextBlockAttrs = {
    type: 'paragraph' | 'heading' | 'codeBlock' | 'blockquote' | 'list' | 'listItem';
    level?: number;
    listKind?: 'bullet' | 'ordered' | 'task';
    checked?: boolean;
};

export type RichTextBlockNode = {
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
    start: RichTextAnchor;
    end: RichTextAnchor;
    attrs: RichTextBlockAttrs;
    deleted?: boolean;
};

export type RichTextState = {
    chars: RichTextCharMeta[];
    blocks: RichTextBlockNode[];
    pending?: RichTextOperation[];
};
```

`parentId + order` defines tree placement. `start + end` defines text ownership. These are
intentionally independent.

This allows:

- moving/reparenting a block without touching its text;
- editing a block's text concurrently with moving that block;
- splitting a block without deleting/reinserting the right side;
- joining blocks without deleting/reinserting either block's text;
- nested block structures whose tree shape is not encoded in the character stream.

Important limitation: a single `start/end` range cannot represent a true text join between two
blocks whose underlying character ranges are discontiguous. It can represent movement cleanly, and
it can represent joins where the ranges touch in stream order. For discontiguous visible-neighbor
joins, either the editor must define join as boundary suppression over multiple underlying block
pieces, or the core model needs first-class block-content pieces. A mutable `ranges[]` field on a
block is not recommended because it creates an ordered CRDT array inside each block.

## Why not block-local text CRDTs?

One tempting model is to make every block contain an independent Peritext state. That makes
rendering and movement easy, but it makes split/join destructive:

- splitting a block requires moving the right-side characters into a new text CRDT;
- joining requires moving characters from one text CRDT into another;
- character IDs, anchors, comments, marks, and remote edits need translation or are lost;
- concurrent edits to text being split/joined are harder to merge.

The requirement that split/join are non-destructive rules this out as the primary model.

## Why explicit `end` anchors matter

The older block plan used start boundaries: a block starts at its own `start`, and ends at the next
sibling's start or the parent/root end. That works for flat split/join when visual sibling order is
the same as text-stream order.

It fails for drag/reparenting:

1. Block A owns `[aStart, bStart)`.
2. Block B owns `[bStart, cStart)`.
3. The user drags B before A.
4. If ends are inferred from visual sibling order, B may now own `[bStart, aStart)` or another
   nonsensical range.

With explicit ranges, moving B changes only `{parentId, order}`. Its text range remains
`[bStart, bEnd)`.

## Operations

Use block operations alongside existing insert/remove/mark operations.

```ts
export type RichTextCreateBlockOperation = {
    action: 'createBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
    start: RichTextAnchor;
    end: RichTextAnchor;
    attrs: RichTextBlockAttrs;
};

export type RichTextSetBlockOperation = {
    action: 'setBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
    attrs: RichTextBlockAttrs;
};

export type RichTextMoveBlockOperation = {
    action: 'moveBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
};

export type RichTextSetBlockRangeOperation = {
    action: 'setBlockRange';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
    start: RichTextAnchor;
    end: RichTextAnchor;
};

export type RichTextDeleteBlockOperation = {
    action: 'deleteBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
};
```

`setBlockRange` is the key addition for non-destructive split/join. It should be separate from
`moveBlock`, because placement and text ownership have different conflict behavior.

Conflict defaults for v1:

- `createBlock` is idempotent by `blockId`.
- `setBlock` is whole-object last-writer-wins by `opId`.
- `moveBlock` is last-writer-wins by `opId` for placement.
- `setBlockRange` is last-writer-wins by `opId` for that block's range.
- `deleteBlock` hides the block from materialized views, but does not delete text.

If we need more collaborative fidelity later, attrs and range endpoints can move from whole-object
LWW to per-field registers. The simpler version is enough to prove the model.

## Drag, reorder, and reparent

Drag-and-drop should compile to one `moveBlock` operation:

```ts
moveBlock(blockId, newParentId, newOrder)
```

The editor should compute `newOrder` from the latest rendered sibling list using a fractional index
or another dense order key. The replicated operation should not include source index, target index,
or text mutations.

This is non-destructive under concurrent text editing because the moved block keeps the same
`start` and `end` anchors. If another user edits inside that range, the edit remains inside the
same block after the move.

Concurrent moves of the same block can be LWW. Concurrent moves of different blocks converge by
sorting siblings by `(order, blockId)`.

## Split

`splitBlock(blockId, splitAnchor)` should compile to structural range operations:

1. Create a new sibling block after the original block in the same parent.
2. Set the original block's range to `[oldStart, splitAnchor)`.
3. Set the new block's range to `[splitAnchor, oldEnd)`.
4. Inherit attrs from the original block unless the command supplies explicit attrs.

No character operations are emitted.

The split anchor should use existing Peritext boundary semantics:

- at document/block start: `startOfText` or the parent's start-equivalent anchor;
- in the middle: `after` the previous visible char is the default from prior notes;
- at the end: the old block's end anchor.

Concurrent text insert at the split point should follow the anchor's existing bias rules. This is
one of the main choices to test carefully: inserts anchored after the same previous char may appear
on either side depending on op ID ordering and whether the split anchor is interpreted as a boundary
between visible characters or as a stable character-side anchor.

Concurrent splits at the same anchor should produce multiple valid sibling blocks. The materializer
can render deterministic empty/equal-range blocks rather than trying to merge them.

## Join

`joinBlock(leftBlockId, rightBlockId)` should compile to structural operations:

1. Set the kept block range to `[left.start, right.end)`.
2. Delete/tombstone the removed block node.
3. Optionally move or hide descendants according to the descendant policy.

No character operations are emitted.

Concurrent edits inside either block remain valid because the underlying character IDs remain in the
same global sequence. The join changes which block view claims those characters.

A join should probably be generated only for adjacent rendered siblings in the same parent. The
reducer/materializer should still tolerate weird joins and ranges.

There is one hard distinction:

- Contiguous stream join: `left.end` and `right.start` resolve to the same character boundary. This
  can be represented by setting the kept block range to `[left.start, right.end)` and deleting the
  other block boundary.
- Discontiguous stream join: the blocks are visual neighbors because one or both was moved, but
  their character ranges are separated in the underlying Peritext order. Setting one range to
  `[left.start, right.end)` would incorrectly claim unrelated intervening text.

For discontiguous joins, avoid storing a mutable `ranges[]` array on the block. Arrays require
careful insert/delete/reorder semantics in a CRDT, and a range list would quickly need its own
operation model for concurrent split, join, undo, and move.

Two safer options:

1. **V1: only join contiguous ranges.** If visible neighbors are discontiguous in the stream,
   Backspace-at-start can either do nothing, move focus, or wrap the two blocks in a container, but
   it should not pretend to merge their text. This is the simplest convergent model.
2. **Full model: first-class content pieces.** Replace "a block owns one range" with "a logical
   block is rendered from one or more independently identified block-content pieces." Each piece is
   a record in the global rich-text state, not an element in a per-block array:

   ```ts
   export type RichTextBlockPiece = {
       pieceId: RichTextOpId;
       blockId: RichTextBlockId;
       order: string;
       start: RichTextAnchor;
       end: RichTextAnchor;
       deleted?: boolean;
   };
   ```

   In that model, `joinBlock(A, B)` moves or aliases B's pieces under A by LWW registers or creates
   a join edge saying B is rendered as part of A. Piece order is sorted by `(order, pieceId)`, so
   there is no mutable range array to splice. Splitting creates a new piece record or changes piece
   endpoints. Concurrent operations harmonize per piece, using the same register/set style as other
   replicated records.

The full model is more expressive, but it should be introduced deliberately as "block pieces" or
"block fragments", not as an array-valued field.

## Materialization

The materialized view should become block-aware:

```ts
export type RichTextBlockView = {
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
    attrs: RichTextBlockAttrs;
    start: number;
    end: number;
    text: string;
    spans: RichTextSpan[];
    children: RichTextBlockView[];
};

export type RichTextRenderView = {
    plainText: string;
    spans: RichTextSpan[];
    blocks: RichTextBlockView[];
};
```

Materialization should be forgiving. The replicated state may contain odd ranges after concurrent
editing, missing dependencies, old data, or future migrations. The view should produce a stable
projection instead of throwing for every malformed block graph.

Suggested algorithm:

1. Materialize visible chars in existing Peritext order.
2. Resolve block `start` and `end` anchors into character-boundary coordinates.
3. Drop or defer blocks whose anchors are not available yet.
4. Resolve visible block nodes by latest create/set/move/range/delete operations.
5. Group blocks by parent and sort children by `(order, blockId)`.
6. Clamp child ranges into the parent range.
7. Repair orphaned and contested text spans for the projection.
8. Build block `text`, block `spans`, and nested `children`.
9. Synthesize `plainText` newlines between rendered blocks for editor/export convenience.

The top-level `spans` projection can stay as a compatibility view over the whole visible character
sequence.

## Orphaned and contested text

Explicit ranges introduce states the start-only model avoided:

- orphaned text: visible text claimed by no block;
- contested text: visible text claimed by multiple blocks.

These should be materialization concerns, not reducer failures.

Recommended rules:

- Orphaned text attaches to the preceding rendered block when possible, especially the block whose
  `end` boundary touches the orphan span.
- If there is no preceding block, attach orphaned text to a synthetic/default root paragraph view or
  the first root block.
- Contested text is claimed by the deterministically later block ID/op ID. Other blocks are clamped
  around the contested span in the materialized projection.

Use parsed op ID ordering via `compareOpIds`, not raw lexical string sorting.

These rules are not semantically perfect, but they make the UI convergent and recoverable. They also
fit the task's assumption that cycle/malformed recovery can be manual later.

## Arbitrary nesting

Arbitrary nesting is straightforward if tree placement is independent from text ranges:

- root blocks have `parentId: null`;
- child blocks point to a block parent;
- siblings sort by `order`;
- each child range is clamped into its parent range during materialization.

The CRDT layer should allow arbitrary parent IDs, subject to dependency/pending behavior if the
parent is not known yet. The editor can restrict what it creates:

- paragraph/heading/code blocks at the root;
- blockquote/list containers;
- list items under lists;
- nested list items through list/listItem children.

The materializer should not require the tree to be valid HTML. The renderer can normalize invalid
trees for DOM output while preserving block metadata.

Cycles can be detected during tree traversal and surfaced as recoverable document issues. For v1,
break cycles deterministically in the view by ignoring the edge from the later block ID or by
hoisting the cycle root to `parentId: null` in the projection. Do not mutate replicated state as a
side effect of rendering.

## Pending and dependencies

Block operations have dependencies:

- anchor dependencies for `start` and `end`;
- parent block dependencies for `parentId`;
- target block dependencies for set/move/range/delete.

The existing rich-text-level `pending` mechanism is a reasonable place to hold operations waiting on
missing anchors or parent blocks. This matches prior research that rich-text pending should live
inside `RichTextState`.

Avoid throwing for ordinary missing dependencies. `applyOne` should check dependencies directly and
return `pending`, reserving exceptions for malformed operations.

## Import/export

Extend import snapshots to accept either span-only or block snapshots:

```ts
export type RichTextBlockSnapshot = {
    attrs?: RichTextBlockAttrs;
    spans?: RichTextSpan[];
    children?: RichTextBlockSnapshot[];
};

export type RichTextImportSnapshot = {
    spans?: RichTextSpan[];
    blocks?: RichTextBlockSnapshot[];
};
```

Span-only imports can create one root paragraph block containing the whole imported text. Block
imports should insert all text into the global char sequence and create block nodes with explicit
ranges over that sequence.

Export should prefer `blocks` once block materialization exists. `plainText` can synthesize
newlines, but block snapshots should be the canonical rich export format.

## Suggested implementation order

1. Add block types, block operations, and `blocks` to `RichTextState`.
2. Initialize empty/imported rich text with at least one root paragraph block.
3. Add block ID allocation/comparison through existing op ID helpers.
4. Add block operation application with pending dependency checks.
5. Add materialization for explicit block ranges, including clamping, orphan repair, and contested
   repair.
6. Add import/export support for block snapshots.
7. Add command compilation for `setBlock`, `moveBlock`, `splitBlock`, and `joinBlock`.
8. Add React rendering from `view.blocks`.
9. Add editor Enter/Backspace behavior for split/join.
10. Add drag-and-drop UI that emits `moveBlock`.
11. Add tests for concurrency and malformed projection recovery.

## Tests to prioritize

- Creating two blocks at the same range converges.
- Concurrent text insert inside a moved block remains inside that block after `moveBlock`.
- Concurrent `moveBlock` and `setBlock` converge.
- Concurrent moves of different blocks into the same parent/order slot converge by block ID.
- Concurrent moves of the same block converge by LWW placement.
- Split does not emit remove/insert operations.
- Join does not emit remove/insert operations.
- Concurrent edit of A and B with join A+B preserves both edits.
- Concurrent edit at a split point converges and lands deterministically.
- Concurrent splits at the same point produce deterministic block views.
- Child block range outside parent range clamps in the view.
- Orphaned text is rendered somewhere recoverable.
- Contested text is claimed deterministically.
- Deleted parent behavior is deterministic for descendants.
- Cycle in `parentId` graph does not crash materialization.

## Open questions

- Should `RichTextBlockId` literally be a `RichTextOpId`, or should it have a distinct string brand
  while sharing the same counter namespace?
- Should `setBlockRange` be exposed as a public low-level operation, or only emitted by split/join
  command helpers?
- Should block range conflict resolution be whole-range LWW, or per-endpoint LWW?
- Should v1 disallow discontiguous joins, or should the first implementation include
  independently identified block-content pieces?
- If using content pieces, should `joinBlock(A, B)` rewrite B's pieces to `blockId: A`, or create a
  durable join/alias edge that renders B as part of A while preserving B's original piece ownership?
- When a user moves a block while another user splits that same block, should the newly-created
  split sibling stay near the original moved block, stay at the old parent/order location, or follow
  a rule based on operation order?
- When joining blocks with children, do descendants of the removed block hide with the removed
  block, move under the kept block, or remain in metadata but unrendered until manually recovered?
- For orphaned text at the beginning of a document, should materialization create a synthetic block
  view or attach it to the first real root block?
- Should empty documents require one root paragraph block as an invariant, or should the
  materializer synthesize it when absent?
- What exact anchor bias should `splitBlock` use so concurrent inserts at the caret land on the
  expected side?
- Should `plainText` synthesize newlines for every block boundary, only root block boundaries, or
  according to block type?
- How much invalid tree normalization belongs in materialization versus the React renderer?
- Should drag order use the existing CRDT fractional index helper, a new rich-text-specific order
  allocator, or a simple op-ID-based append/prepend strategy for v1?

## Recommendation

Proceed with explicit block nodes using independent text ranges and tree placement:

- `start/end` anchors for text ownership;
- `parentId/order` for arbitrary nested structure;
- `moveBlock` for drag/reparent/reorder;
- `setBlockRange` plus `createBlock/deleteBlock` for split/join;
- forgiving materialization for orphaned, contested, malformed, and cyclic structures.

This is the smallest model that satisfies non-destructive block movement, contiguous
non-destructive split/join, and arbitrary nesting without abandoning the existing Peritext character
identity model.

For true joins between discontiguous moved blocks, do not add a mutable `ranges[]` array. Either
make v1 joins require contiguous ranges, or promote ranges into first-class block-content piece
records sorted by stable IDs/order keys.
