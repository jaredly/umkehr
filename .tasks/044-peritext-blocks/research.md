# Peritext blocks research

## Summary

Use explicit block nodes as structural ranges over the existing global Peritext character
sequence.

The key constraint is that blocks must not own independent text CRDTs. Character identity should
stay in the current flat Peritext sequence. Blocks should own structure: stable block IDs,
parent/child relationships, sibling ordering, block type/attrs, and start/end anchors into the
global text sequence.

The earlier start-only model is attractive for split/join, but drag-to-reorder changes the design
pressure. If visual block order can diverge from text-stream order, a block's text range can no
longer be inferred from the next visual sibling's start. To support non-destructive block movement,
blocks need explicit `start` and `end` anchors.

This model gives us stable block identity and room for nested structure while preserving
character-level IDs, inline marks, comments, and old anchors.

## Existing state

The current rich text model is a faithful inline Peritext core:

- `RichTextState` is a flat `chars: RichTextCharMeta[]` sequence.
- Each character has a stable `opId`, `afterId`, `char`, and `deleted` flag.
- Inline formatting uses historical `addMark` / `removeMark` operations anchored to
  `startOfText`, `endOfText`, or `before` / `after` a character op ID.
- Mark boundary behavior is encoded by choosing anchors, with public presets in
  `anchorsForMarkRange`.
- `materializeRichTextState` returns `plainText` and inline `spans`; tombstones are hidden.
- `RichTextImportSnapshot` is currently only `{spans: RichTextSpan[]}`.
- The React editor treats content as inline text and maps browser selections to plain-text
  indexes.

There is no block model yet. Newlines can exist as normal inserted characters, but they have no
structural meaning beyond being part of `plainText`.

## Design goals

A block implementation should support:

- Stable block identity for comments, presence, selection, future reordering, and nested editing.
- Non-destructive split/join that does not delete/reinsert text.
- Import/export for paragraphs and basic HTML-ish block types.
- Changing the current block type, for example paragraph to heading or quote.
- Rendering a block-oriented view for React/editor use.
- CRDT convergence when peers concurrently insert text, split blocks, join blocks, or change block
  attributes.
- Nested structure without forcing character ownership into block-local text sequences.

The model should continue to make editor-facing commands index-based while replicated operations
use stable anchors.

## Candidate A: block attributes on newline characters

This is the Quill/Delta-style approach: each logical line ends with a newline character, and the
newline carries block-level attributes such as paragraph, heading, or list item metadata.

Example materialized text:

```text
hello\nworld\n
```

With block attributes:

```ts
[
  {text: 'hello'},
  {text: '\n', block: {type: 'heading', level: 1}},
  {text: 'world'},
  {text: '\n', block: {type: 'paragraph'}},
]
```

Benefits:

- Split and join are ergonomic. Enter inserts a newline; Backspace at start removes one.
- It fits the current flat character sequence and stable char ID model.
- Delayed/concurrent operations can still anchor to characters and tombstones.
- Materialization can derive blocks by scanning visible characters up to visible newlines.
- Basic paragraphs, headings, code blocks, and flat list items are straightforward.

Costs:

- Block identity is tied to a delimiter character, not to a first-class block node.
- Nested structure is awkward. A blockquote containing a list item wants separate quote and item
  identities.
- A newline delimiter is both text and structure, which creates edge cases for inline marks,
  deletion, copy/paste, and selection offsets.
- Empty blocks require visible structural delimiters.
- A document likely needs a trailing newline invariant so the last block has a delimiter.

This remains a useful comparison point, but it is less attractive if we want stable blocks and
nested structure as real concepts.

## Candidate B: block tags as marks over spans

This extends the current mark model so block tags such as `p`, `blockquote`, or `li` apply to
spans of text.

Benefits:

- It resembles the current mark operation machinery.
- Nested structures can be represented as overlapping ranges.
- It does not require special newline delimiter semantics for every block concept.

Costs:

- Ordinary inline mark conflict rules are wrong for many block types. A character should not
  usually be both a paragraph and a heading, but it can be both bold and linked.
- Split/join becomes less ergonomic. Pressing Enter inside a block means splitting a range-shaped
  block operation into two logical blocks or adding override operations at the split.
- Empty blocks are hard because there is no span of text to tag.
- Range overlap can represent invalid DOM-like structures unless materialization applies extra
  normalization rules.
- Current `marksForOperations` resolves one winning value per mark type. That is not expressive
  enough for nested containers such as `blockquote > ul > li`.

This is not a good direct implementation for block identity. Block semantics need separate
validation and materialization rules.

## Candidate C: block nodes as explicit ranges

This is the recommended approach.

Introduce explicit block nodes, but keep all text in the existing global Peritext character
sequence. A block node identifies a structural range and attributes; it does not contain or own a
separate text sequence.

Suggested shape:

```ts
export type RichTextBlockId = `${number}#${RichTextActorId}`;

export type RichTextBlockType =
    | 'paragraph'
    | 'heading'
    | 'codeBlock'
    | 'blockquote'
    | 'list'
    | 'listItem';

export type RichTextBlockAttrs = {
    type: RichTextBlockType;
    level?: number;
    listKind?: 'ordered' | 'bullet' | 'task';
    checked?: boolean;
};

export type RichTextBlockNode = {
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
    start: RichTextAnchor;
    end: RichTextAnchor;
    attrs: RichTextBlockAttrs;
    deleted: boolean;
};
```

Add this to state:

```ts
export type RichTextState = {
    chars: RichTextCharMeta[];
    blocks: RichTextBlockNode[];
    pending?: RichTextOperation[];
};
```

Block content is derived:

- `start` and `end` define the block's claimed text range in the global character sequence.
- `parentId` and `order` define the block's structural/render position.
- moving a block changes structural placement, not its text range.

Because text range and structural order are separate, drag-to-reorder can be non-destructive: no
characters need to be deleted, moved, or reinserted.

## Split and join

The central reason to prefer this model is non-destructive split/join.

Naive block-local text CRDTs would split by deleting/reinserting the right side into a new block.
That would lose character IDs and break anchors/marks/comments tied to those characters.

With explicit range block nodes:

- Split at index/anchor creates a new sibling block whose `start` is the split anchor and whose
  `end` is the old block's previous `end`.
- The original block receives a fresh range operation ending at the split anchor.
- No character is deleted, moved, or reinserted.
- Inline marks and comments remain attached to the original characters.

Join is similarly structural:

- Join adjacent blocks by extending one block's `end` to the other's `end`, then tombstoning the
  removed block node.
- No character identity changes.

Equal starts are allowed. Equal ranges and empty ranges should be handled without treating the
document as corrupt.

If a block range is outside the materialized parent range, clamp it during materialization rather
than rejecting the whole document. Validation can still flag malformed operations in tests, but the
view should be robust to concurrent or old data.

Explicit ranges add two materialization repair cases:

- orphaned text: a visible text span claimed by no block;
- contested text: a visible text span claimed by more than one block.

Recommended repair rules:

- Orphaned text sticks to the preceding block, specifically the block whose `end` touches the start
  of the orphan span when possible.
- Contested text is claimed by the deterministically later block ID using parsed block ID ordering,
  not raw lexical string order. Losing blocks are clamped around the contested span in the
  materialized view.

These are view/materialization rules, not reducer rules. The replicated state can contain gaps or
overlaps; materialization normalizes them into a coherent projection.

## Structural placement

Blocks need a coherent structural position as well as a text range. The previous
`parentId + afterId` shape is risky because the two fields can disagree. For example, a block can
say `parentId: A` while `afterId` points at a sibling that has been concurrently reparented under
`B`.

Two better shapes are worth considering.

### Option 1: `parentId + order`

Store an explicit parent plus a fractional index-like order key:

```ts
export type RichTextBlockNode = {
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
    start: RichTextAnchor;
    end: RichTextAnchor;
    attrs: RichTextBlockAttrs;
    deleted: boolean;
};
```

Placement operations update parent and order together:

```ts
export type RichTextMoveBlockOperation = {
    action: 'moveBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
};
```

Benefits:

- `parentId` and sibling order cannot point at different parents.
- Move/reparent is one coherent value: `{parentId, order}`.
- Sorting children is straightforward: group by parent, sort by `order`, tie-break by `blockId`.
- There is no dangling previous-sibling reference if another block is moved or deleted.
- Concurrent inserts/moves at the same visual slot converge by order plus block ID tie-break.

Costs:

- Requires fractional index allocation for "between these two rendered siblings".
- Repeated insertions into the same gap may create long order strings unless we eventually compact.
- It captures final position more than causal "after this exact sibling" intent.

This is the recommended structural placement model.

### Option 2: `anchorId + anchorType`

Store one placement anchor instead of separate parent and sibling fields:

```ts
export type RichTextBlockPlacement =
    | {anchorType: 'parent'; anchorId: RichTextBlockId | null; position: 'start' | 'end'}
    | {anchorType: 'sibling'; anchorId: RichTextBlockId; side: 'before' | 'after'};
```

The parent is derived from the anchor:

- a `parent` anchor inserts into that parent's child list;
- a `sibling` anchor follows the referenced block's current parent.

Benefits:

- Cannot express a direct parent/sibling mismatch in one node.
- Captures user intent like "place this after that sibling".
- If the anchor sibling is reparented, anchored blocks can follow it, which may be desirable for
  some grouped move semantics.

Costs:

- If the sibling anchor is concurrently reparented, this block's parent changes implicitly. That
  may be surprising for ordinary drag/reorder.
- Deleted or missing anchors require fallback rules.
- Sibling-anchor graphs can create cycles or long dependency chains.
- Materialization is more complex than sorting children by parent/order.
- It is less clear how to generate stable "insert at index N" operations without reconstructing an
  anchor graph.

This is coherent, but it makes rendering depend on anchor graph resolution. It seems more complex
than the value it adds for the first move implementation.

## Replicated operations

Add block operations alongside existing insert/remove/mark operations:

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
    attrs: Partial<RichTextBlockAttrs>;
};

export type RichTextDeleteBlockOperation = {
    action: 'deleteBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
};

export type RichTextMoveBlockOperation = {
    action: 'moveBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    order: string;
};
```

Questions to settle during implementation:

- Should `setBlock` replace the whole attrs object or merge per key?
- Should block IDs share the same counter namespace as char/mark operations?
- Should `deleteBlock` tombstone any descendants, or should descendants remain and be ignored or
  reparented in materialization?
- Should range changes be a separate `setBlockRange` operation, or should split/join use
  specialized operations?

For v1, whole-object last-writer-wins attrs are simpler. Per-attribute LWW is more ergonomic for
concurrent edits like one user changing heading level while another changes task checked state.

## Materialized view

Add a block view alongside the current span view:

```ts
export type RichTextBlockView = {
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    type: RichTextBlockType;
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

For backward compatibility, `spans` can remain the full inline projection. `blocks` should become
the new editor/rendering surface.

Materialization algorithm:

1. Sort visible characters by the existing Peritext sequence rules.
2. Resolve live block ranges from `start` / `end` anchors.
3. Clamp ranges into the parent range for nested blocks.
4. Repair orphaned and contested text for the materialized projection.
5. Sort live block nodes by `parentId`, `order`, and `blockId` as a deterministic tie-breaker.
6. Build each block's `text` and inline `spans` from the repaired range it receives.
7. Nest child block views under their parent.

Clamping is a view concern. A block start before the parent start clamps to the parent start; a
block end after the parent end clamps to the parent end. Empty blocks are valid.

## Public import/export

Extend snapshots without breaking existing span imports:

```ts
export type RichTextBlockSnapshot = {
    type?: RichTextBlockType;
    attrs?: Partial<RichTextBlockAttrs>;
    spans?: RichTextSpan[];
    children?: RichTextBlockSnapshot[];
};

export type RichTextImportSnapshot = {
    spans?: RichTextSpan[];
    blocks?: RichTextBlockSnapshot[];
};
```

Rules:

- Existing `{spans}` imports become one root paragraph block containing those spans.
- `{blocks}` imports create block nodes and insert block text into the global sequence.
- Import can choose whether to insert newline characters between root blocks for plain-text
  fidelity. Those newlines are text export artifacts, not the source of block identity.
- Export should prefer `{blocks}` once block support exists.

The hard import question is how to represent block separation in `plainText`. If blocks do not use
newline delimiters as identity, `plainText` can either include synthesized newlines between blocks
or remain a raw character projection. The block view should become the canonical rich export.

## Editing commands

Add block commands to `$text`:

```ts
$text.splitBlock(index, attrs?)
$text.joinBlock(blockId)
$text.moveBlock(blockId, parentId, order)
$text.setBlock(blockId, attrs)
$text.createBlock(parentId, order, startIndex, endIndex, attrs)
$text.deleteBlock(blockId)
```

Possible command compilation:

- `splitBlock(index)` finds the block containing the index, creates a sibling after it, sets the
  new block range to `[splitAnchor, oldEnd)`, and updates the old block range to
  `[oldStart, splitAnchor)`.
- `joinBlock(blockId)` tombstones `blockId` if it can merge into its previous sibling.
- `setBlock(blockId, attrs)` emits a `setBlock` operation.
- `moveBlock(blockId, parentId, order)` changes structural placement only.
- `createBlock(parentId, order, startIndex, endIndex, attrs)` creates a block range at an explicit
  position.
- `deleteBlock(blockId)` tombstones the block boundary; text remains in the global sequence unless
  the caller also deletes the text range.

Plain `insert` and `delete` should not need special newline semantics. Enter and Backspace at a
block boundary should use block commands, not text newline insertion, unless a specific editor mode
intentionally stores literal newlines.

## Concurrency semantics

Important cases:

- Concurrent text inserts inside the same block already use existing char ordering.
- Concurrent `setBlock` on the same block can use greatest-op-ID-wins for v1.
- Concurrent `moveBlock` on the same block can use greatest-op-ID-wins for placement.
- Concurrent split at the same index creates two sibling block ranges sharing a boundary. That
  materializes deterministically, possibly with an empty block.
- Concurrent join/delete of a block and `setBlock` on that block is deterministic. A deleted block
  does not render; its attrs can remain in metadata.
- Concurrent overlapping block ranges are repaired during materialization using the contested-text
  rule.
- Concurrent orphan ranges are repaired during materialization using the preceding-block rule.
- Concurrent block range outside its parent range is clamped during materialization.
- Concurrent parent deletion can either hide descendants or leave them available for future
  reparenting. V1 should probably hide descendants to keep materialization simple.

The model should not try to merge two concurrently-created blocks into one unless a later explicit
join operation removes one boundary.

## Nested blocks

This approach supports real nesting earlier than newline-delimited attrs:

- `parentId: null` gives root blocks.
- child blocks claim explicit ranges within their parent's materialized range.
- list containers can be actual `list` blocks with `listItem` children.
- blockquote can be a container with paragraph/list children.

However, v1 can still restrict which trees are produced by editor commands:

- root paragraphs/headings/code blocks;
- root blockquotes with paragraph children;
- lists with list item children;
- no arbitrary mixed invalid DOM structures from the editor.

Materialization should be forgiving even if replicated data is odd. The renderer can normalize or
drop invalid combinations while preserving metadata.

## Implementation areas

Likely files to touch:

- `src/peritext/types.ts`: block IDs, block nodes, block operations, block view, snapshot shape.
- `src/peritext/ids.ts`: block ID parsing/comparison/allocation.
- `src/peritext/blocks.ts`: create/set/delete/move block operations, sibling ordering, range
  repair.
- `src/peritext/apply.ts`: route block operations.
- `src/peritext/materialize.ts`: emit `blocks` from global text plus block nodes.
- `src/peritext/importExport.ts`: import/export block snapshots.
- `src/peritext/validation.ts`: validate block IDs, parent/order placement, attrs, and anchors.
- `src/types.ts`: add `$text` block commands.
- `src/crdt/updates.ts`: compile block commands to anchored peritext operations.
- `src/crdt/history.ts`: undo/redo for createBlock/deleteBlock/setBlock/moveBlock and range
  changes.
- `src/react-rich-text/*`: render block view and translate Enter/Backspace/block toolbar actions.

## Suggested implementation order

1. Add block node types and initialize a default root paragraph block for imported/non-empty text.
2. Add block ID allocation, fractional order allocation, and deterministic sibling ordering.
3. Add block materialization with explicit ranges, orphan/contested text repair, empty block
   handling, and clamping.
4. Extend import/export so `{blocks}` round-trips through global text plus block nodes.
5. Add `createBlock`, `setBlock`, `deleteBlock`, and `moveBlock` operations with deterministic
   tests.
6. Add `$text.setBlock` and render block views in React.
7. Add `splitBlock` as range update plus `createBlock` at the split anchor.
8. Add `joinBlock` as range update plus `deleteBlock` of the later block.
9. Add editor Enter and Backspace-at-block-start behavior.
10. Add basic nested structures: blockquote/list containers and list-item children.
11. Add drag-to-reorder through `moveBlock`.
12. Add tests for concurrent splits, equal ranges, parent-range clamping, contested/orphaned text,
    move vs setBlock, and join vs setBlock.

## Open questions

- Should `RichTextState` always contain at least one root paragraph block, even when `chars` is
  empty?
  - yeah
- Should `plainText` synthesize newlines between materialized blocks, or remain only the raw
  visible character sequence?
  - let's synthesize newlines
- Should block attrs be last-writer-wins as a whole object, or should individual attrs resolve
  independently?
  - whole object
- Should block IDs share the rich-text op counter namespace, or use a separate block counter?
  - shared namespace is fine
- Should structural placement use `parentId + order` or `anchorId + anchorType`?
  - recommended: `parentId + order`
- Should `deleteBlock` hide descendants, tombstone descendants, or allow descendants to be
  reparented during materialization?
  - deleteBlock is semantically similar to removeMark. it does not remove any text
- What exact anchor should `splitBlock(index)` use at a caret: `before` the next char, `after` the
  previous char, or `startOfText` / `endOfText` at edges?
  - after previous char
- When splitting a heading, should the new block inherit heading attrs or default to paragraph?
  - inherit heading attrs
- When pressing Enter at the end of a list item, should an empty list item become a paragraph?
  - yes, but that's an editor's concern, not the crdt algorithm's
- Can inline marks span across block boundaries, or should mark commands split per block?
  - marks can span across block boundaries
- How should comments or other multi-value annotations attach to block nodes versus character
  ranges?
  - marks only attach to character ranges
- What invalid nested structures should the materializer normalize, hide, or expose to callers?
  - use your judgement
- How should old span-only snapshots migrate: one paragraph, paragraphs split on `\n`, or preserve
  text exactly in a single block?
  - no need to migrate, there is no production use
- What HTML paste/export fidelity is required for lists, quotes, headings, and code blocks?
  - best effort
- What should undo batching do for Enter followed by typing: one command group or separate undo
  steps?
  - separate steps

## Recommendation

Proceed with explicit block nodes as text ranges over the global Peritext sequence. Use
`start`/`end` for the claimed character range and `parentId + order` for coherent structural
placement. This keeps split/join and drag-to-reorder structural and non-destructive, avoids the
parent/sibling incoherence of `parentId + afterId`, and leaves room for real nested blocks without
sacrificing character-level identity.
