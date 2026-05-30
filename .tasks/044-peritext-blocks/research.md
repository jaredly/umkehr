# Peritext blocks research

## Summary

Use explicit block nodes as structural boundaries over the existing global Peritext character
sequence.

The key constraint is that blocks must not own independent text CRDTs. Character identity should
stay in the current flat Peritext sequence. Blocks should own structure: stable block IDs,
parent/child relationships, sibling ordering, block type/attrs, and a start anchor into the global
text sequence.

For siblings with the same `parentId`, store only each block's start anchor. Do not store both
start and end. A block's end is derived from the next sibling's start, or from the parent/root end.
This avoids denormalized sibling boundaries and makes split/join non-destructive.

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

## Candidate C: block nodes as start boundaries

This is the recommended approach.

Introduce explicit block nodes, but keep all text in the existing global Peritext character
sequence. A block node identifies a structural boundary and attributes; it does not contain or own
a separate text sequence.

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
    afterId: RichTextBlockId | null;
    start: RichTextAnchor;
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

- root children partition `[startOfText, endOfText)`.
- children of a parent block partition that parent's derived content range.
- a block's content range is `[block.start, nextSibling.start)`.
- the last sibling's range ends at the parent range end.

Because sibling blocks only store starts, split and join do not need to mutate or duplicate an
older block's end anchor.

## Split and join

The central reason to prefer this model is non-destructive split/join.

Naive block-local text CRDTs would split by deleting/reinserting the right side into a new block.
That would lose character IDs and break anchors/marks/comments tied to those characters.

With start-boundary block nodes:

- Split at index/anchor creates a new sibling block whose `start` is the split anchor.
- The previous block's derived end automatically becomes the new sibling's start.
- The new block's derived end is the following sibling's start or the parent end.
- No character is deleted, moved, or reinserted.
- Inline marks and comments remain attached to the original characters.

Join is similarly structural:

- Join adjacent blocks by tombstoning the later block boundary.
- The earlier block's derived end automatically becomes the next surviving sibling's start, or the
  parent end.
- No character identity changes.

Equal starts are allowed. If two siblings have the same derived start, sibling ordering decides
which one is first; one of the resulting ranges is empty. Materialization should handle this
without treating it as corruption.

If a block start is outside the materialized parent range, clamp it during materialization rather
than rejecting the whole document. Validation can still flag malformed operations in tests, but the
view should be robust to concurrent or old data.

## Replicated operations

Add block operations alongside existing insert/remove/mark operations:

```ts
export type RichTextCreateBlockOperation = {
    action: 'createBlock';
    opId: RichTextOpId;
    blockId: RichTextBlockId;
    parentId: RichTextBlockId | null;
    afterId: RichTextBlockId | null;
    start: RichTextAnchor;
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
```

Questions to settle during implementation:

- Should `setBlock` replace the whole attrs object or merge per key?
- Should block IDs share the same counter namespace as char/mark operations?
- Should `deleteBlock` tombstone any descendants, or should descendants remain and be ignored or
  reparented in materialization?

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
2. Sort live block nodes by `parentId`, sibling order, and `blockId` as a deterministic tie-breaker.
3. Derive each parent's range from its own materialized range.
4. For each sibling group, resolve and clamp starts into the parent range.
5. Derive `[start, end)` ranges from each start and the next sibling's start.
6. Build each block's `text` and inline `spans` from visible characters in its range.
7. Nest child block views under their parent.

Clamping is a view concern. A block start before the parent start clamps to the parent start; a
block start after the parent end clamps to the parent end. Equal starts produce empty blocks.

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
$text.setBlock(blockId, attrs)
$text.createBlock(parentId, afterId, index, attrs)
$text.deleteBlock(blockId)
```

Possible command compilation:

- `splitBlock(index)` finds the block containing the index, creates a sibling after it, and sets
  the new block's `start` to the anchor at that index.
- `joinBlock(blockId)` tombstones `blockId` if it can merge into its previous sibling.
- `setBlock(blockId, attrs)` emits a `setBlock` operation.
- `createBlock(parentId, afterId, index, attrs)` creates a block boundary at an explicit position.
- `deleteBlock(blockId)` tombstones the block boundary; text remains in the global sequence unless
  the caller also deletes the text range.

Plain `insert` and `delete` should not need special newline semantics. Enter and Backspace at a
block boundary should use block commands, not text newline insertion, unless a specific editor mode
intentionally stores literal newlines.

## Concurrency semantics

Important cases:

- Concurrent text inserts inside the same block already use existing char ordering.
- Concurrent `setBlock` on the same block can use greatest-op-ID-wins for v1.
- Concurrent split at the same index creates two sibling block starts at the same anchor. That
  materializes as one empty block plus one non-empty block, ordered deterministically.
- Concurrent join/delete of a block and `setBlock` on that block is deterministic. A deleted block
  does not render; its attrs can remain in metadata.
- Concurrent block start outside its parent range is clamped during materialization.
- Concurrent parent deletion can either hide descendants or leave them available for future
  reparenting. V1 should probably hide descendants to keep materialization simple.

The model should not try to merge two concurrently-created blocks into one unless a later explicit
join operation removes one boundary.

## Nested blocks

This approach supports real nesting earlier than newline-delimited attrs:

- `parentId: null` gives root blocks.
- child blocks partition their parent's derived text range.
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
- `src/peritext/blocks.ts`: create/set/delete block operations, sibling ordering, range derivation.
- `src/peritext/apply.ts`: route block operations.
- `src/peritext/materialize.ts`: emit `blocks` from global text plus block nodes.
- `src/peritext/importExport.ts`: import/export block snapshots.
- `src/peritext/validation.ts`: validate block IDs, parent/after references, attrs, and anchors.
- `src/types.ts`: add `$text` block commands.
- `src/crdt/updates.ts`: compile block commands to anchored peritext operations.
- `src/crdt/history.ts`: undo/redo for createBlock/deleteBlock/setBlock.
- `src/react-rich-text/*`: render block view and translate Enter/Backspace/block toolbar actions.

## Suggested implementation order

1. Add block node types and initialize a default root paragraph block for imported/non-empty text.
2. Add block ID allocation and deterministic sibling ordering.
3. Add block materialization with derived ranges, equal-start empty block handling, and clamping.
4. Extend import/export so `{blocks}` round-trips through global text plus block nodes.
5. Add `createBlock`, `setBlock`, and `deleteBlock` operations with deterministic tests.
6. Add `$text.setBlock` and render block views in React.
7. Add `splitBlock` as a `createBlock` at the split anchor.
8. Add `joinBlock` as a `deleteBlock` of the later sibling boundary.
9. Add editor Enter and Backspace-at-block-start behavior.
10. Add basic nested structures: blockquote/list containers and list-item children.
11. Add tests for concurrent splits, equal starts, parent-range clamping, and join vs setBlock.

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

Proceed with explicit block nodes as start boundaries over the global Peritext sequence. This keeps
split/join structural and non-destructive, avoids denormalized sibling start/end ranges, supports
empty blocks and equal starts, and leaves room for real nested blocks without sacrificing
character-level identity.
