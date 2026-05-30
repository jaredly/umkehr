# Peritext blocks research

## Summary

The best first implementation is to model blocks as structural metadata over the existing
Peritext character sequence, not as ordinary inline marks and not as a separate tree of
block nodes.

Concretely:

- Keep `src/peritext` as one ordered character sequence with tombstones and stable char IDs.
- Introduce newline characters as explicit structural delimiters for line/block boundaries.
- Store block attributes on those delimiter characters, Quill-style, for the simple cases.
- Add a second layer of range-like block container operations only when nested containers are
  needed, such as blockquotes, lists, or list items.
- Materialize a block view from the character sequence plus block metadata; do not expose block
  metadata as normal inline spans.

This preserves the current strengths of the implementation: index-based editor commands compile
to anchored operations, tombstones keep old anchors resolvable, and rendering is a derived view.
It also avoids making block split/join a special tree-edit CRDT problem before we know the editor
requirements.

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

## Goals for blocks

A block implementation should support these operations naturally:

- Import/export paragraphs and basic HTML-ish block types.
- Split a paragraph by pressing Enter.
- Join blocks by deleting at a block boundary.
- Change the current block type, for example paragraph to heading or quote.
- Render a block-oriented view for React/editor use.
- Preserve CRDT convergence when peers concurrently insert text, split blocks, or change block
  attributes.
- Leave room for nested block structures without forcing a full tree CRDT immediately.

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

In the current implementation this could be represented by adding block-specific operation data
to delimiter characters instead of treating it as an inline `markType`.

Benefits:

- Split and join are ergonomic. Enter inserts a newline with copied/default block attrs; Backspace
  at start removes a newline.
- It fits the current flat character sequence and stable char ID model.
- Delayed/concurrent operations can still anchor to characters and tombstones.
- Materialization can derive blocks by scanning visible characters up to visible newlines.
- Basic paragraphs, headings, code blocks, and flat list items are straightforward.
- Adjacent lines with the same block container attrs can be grouped in the render view.

Costs:

- Nested structures are awkward if all structure must live on the newline. A blockquote containing
  a list item wants at least two structural concepts: the quote container and the item.
- A newline delimiter is both text and structure, which creates edge cases for inline marks,
  deletion, copy/paste, and selection offsets.
- Empty blocks require a visible structural delimiter with no text before it.
- A document must maintain a trailing newline or equivalent terminal block marker; otherwise the
  last block has no place for its attrs.

This approach is the best base layer, but it should not be the whole nested-block story.

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

This is not a good direct implementation for block identity. It may still be useful for
container-style annotations later, but block semantics need separate validation and materialization
rules.

## Candidate C: explicit block tree with text leaves

This would introduce stable block nodes, probably separate from the character sequence:

```ts
type RichTextBlock = {
  blockId: RichTextBlockId;
  parentId: RichTextBlockId | null;
  afterId: RichTextBlockId | null;
  type: 'paragraph' | 'blockquote' | 'list' | 'listItem';
  attrs?: Json;
};
```

Text would either live inside each block as separate Peritext sequences, or the current sequence
would need block membership pointers.

Benefits:

- Nested blocks and DOM-like structure are explicit.
- Empty blocks are easy.
- Block identity can survive split/join, drag/reorder, comments on blocks, and outliner-style UI.
- Materialization does not need to infer as much from newline delimiters.

Costs:

- This is a much larger CRDT design. It needs ordering, parent/child validity, move semantics,
  delete semantics, and conflict rules for concurrent split/join/reparent operations.
- Selections spanning blocks become multi-sequence if each block has its own text sequence.
- The current editor and command surface are flat-index based; a tree model would require a more
  complex position map.
- It risks delaying useful paragraph/heading/list support while solving a harder general problem.

This is probably the right long-term model only if Umkehr wants Notion/ProseMirror-like block
identity and nested block editing as a core feature.

## Recommended model

Use a hybrid, staged model:

1. Represent line/block boundaries with explicit newline characters.
2. Store the primary block type and attrs on the newline delimiter.
3. Keep inline marks applying to visible text characters, not to block structure.
4. Materialize `RichTextBlockView[]` from delimiters and inline spans.
5. Add optional container range operations later for nested structures that cannot be captured by
   one delimiter's attrs.

Suggested initial types:

```ts
export type RichTextBlockType =
    | 'paragraph'
    | 'heading'
    | 'codeBlock'
    | 'blockquote'
    | 'listItem';

export type RichTextBlockAttrs = {
    type: RichTextBlockType;
    level?: number;
    listKind?: 'ordered' | 'bullet' | 'task';
    checked?: boolean;
};

export type RichTextSetBlockOperation = {
    action: 'setBlock';
    opId: RichTextOpId;
    delimiter: RichTextAnchor;
    attrs: RichTextBlockAttrs;
};
```

And extend char metadata:

```ts
export type RichTextCharMeta = {
    opId: RichTextOpId;
    afterId: RichTextOpId | null;
    char: string;
    deleted: boolean;
    markOpsBefore?: RichTextMarkOperation[];
    markOpsAfter?: RichTextMarkOperation[];
    blockOps?: RichTextSetBlockOperation[];
};
```

`blockOps` should only be valid on newline characters. Effective attrs are the greatest op ID per
block-attribute key, or greatest op ID for the whole block attrs object if we want simpler
last-writer-wins behavior in v1.

## Materialized view

Add a block view alongside the current span view:

```ts
export type RichTextBlockView = {
    type: RichTextBlockType;
    attrs?: RichTextBlockAttrs;
    start: number;
    end: number;
    text: string;
    spans: RichTextSpan[];
};

export type RichTextRenderView = {
    plainText: string;
    spans: RichTextSpan[];
    blocks: RichTextBlockView[];
};
```

For backward compatibility, `spans` can remain the full inline projection. `blocks` should be the
new editor/rendering surface. `plainText` should continue to include newlines if they are present
in the visible character sequence.

Materialization algorithm:

1. Scan visible characters in order.
2. Accumulate text and inline spans until a visible `\n`.
3. Resolve block attrs from the newline delimiter.
4. Emit one block containing content before the delimiter.
5. Hide the delimiter from the block's `text` and `spans`, but count it in position mapping.
6. If there is no trailing visible newline, synthesize a paragraph block for the final run or
   enforce a trailing delimiter invariant.

The stricter option is to enforce a trailing newline for all non-empty rich text. It makes block
attrs unambiguous and aligns with the newline-delimiter model. It also requires migration/import
changes because existing snapshots do not include trailing newlines.

## Public import/export

Extend snapshots without breaking existing span imports:

```ts
export type RichTextBlockSnapshot = {
    type?: RichTextBlockType;
    attrs?: RichTextBlockAttrs;
    spans: RichTextSpan[];
};

export type RichTextImportSnapshot = {
    spans?: RichTextSpan[];
    blocks?: RichTextBlockSnapshot[];
};
```

Rules:

- Existing `{spans}` imports become a single paragraph block.
- `{blocks}` imports insert each block's text followed by a newline delimiter.
- Block attrs compile into `setBlock` operations on the corresponding delimiter.
- Export should prefer `{blocks}` once block support exists.

This lets the old API keep working while giving editor integrations a structural format.

## Editing commands

Add block commands to `$text`:

```ts
$text.splitBlock(index, attrs?)
$text.joinBlock(index)
$text.setBlock(rangeOrIndex, attrs)
```

Initial command compilation:

- `splitBlock(index)` inserts `\n` at the index and sets attrs on the inserted newline.
- If splitting in the middle of a block, text after the split naturally belongs to the new
  delimiter encountered later; materialization must decide whether block attrs before/after the
  split are copied or defaulted.
- `joinBlock(index)` removes the visible newline before or at the index.
- `setBlock(index, attrs)` finds the delimiter for the block containing the index and emits a
  `setBlock` operation for that delimiter.
- `setBlock(range, attrs)` applies to every block touched by the range.

Plain `insert` and `delete` need guardrails:

- Inserting `\n` through ordinary `insert` should either be rejected or normalized to
  `splitBlock`, otherwise the newline may lack block attrs.
- Deleting a newline through ordinary `delete` should either be allowed as `joinBlock` or expanded
  to block-aware behavior.
- Paste/import of text containing newlines should create block delimiters with default attrs.

## Concurrency semantics

Important cases:

- Concurrent text inserts inside the same block already use existing char ordering.
- Concurrent `setBlock` on the same delimiter can use greatest-op-ID-wins for v1.
- Concurrent split at the same index creates two newline delimiters ordered by existing insert
  rules; this may materialize as an empty block. That is acceptable but should be tested.
- Concurrent delete of a delimiter and `setBlock` on that delimiter should be deterministic. If
  the delimiter is tombstoned, its attrs remain in metadata but do not render.
- Concurrent split and inline mark at the split boundary should preserve the existing mark
  boundary behavior; tests should cover whether newline delimiters receive inline marks or are
  skipped.

The model should not try to merge two concurrently-created blocks into one unless a later explicit
join operation removes a delimiter.

## Nested blocks

For v1, avoid true nested containers. Support flat block types:

- paragraph
- heading
- codeBlock
- blockquote as a flat block type
- listItem with `listKind` and `indent`

This is how many editors represent lists internally: each item is a line with list attrs and an
indent level. The renderer groups adjacent compatible list items into `<ul>` / `<ol>` containers.

This handles common list and quote rendering without requiring explicit container nodes.

True nested block semantics can be added later with container operations:

```ts
type RichTextBlockContainerOperation = {
    action: 'addBlockContainer' | 'removeBlockContainer';
    opId: RichTextOpId;
    start: RichTextAnchor;
    end: RichTextAnchor;
    containerType: 'blockquote' | 'list';
    attrs?: RichTextJsonValue;
};
```

That should be deferred until there are concrete editor requirements, because container overlap
validation and DOM nesting rules are a separate design problem.

## Implementation areas

Likely files to touch:

- `src/peritext/types.ts`: block attrs, block operation, block view, snapshot shape.
- `src/peritext/sequence.ts`: newline delimiter helpers and maybe trailing-newline invariant.
- `src/peritext/blocks.ts`: setBlock application, delimiter lookup, block attrs resolution.
- `src/peritext/apply.ts`: route `setBlock`.
- `src/peritext/materialize.ts`: emit `blocks`.
- `src/peritext/importExport.ts`: import/export block snapshots.
- `src/peritext/validation.ts`: validate block ops and attrs.
- `src/types.ts`: add `$text` block commands.
- `src/crdt/updates.ts`: compile block commands to anchored peritext operations.
- `src/crdt/history.ts`: undo/redo for block split/join/setBlock.
- `src/react-rich-text/*`: render block view and translate Enter/Backspace/paste.

## Suggested implementation order

1. Add block types and a materializer that treats visible newlines as paragraph delimiters.
2. Extend import/export so `{blocks}` round-trips through inserted text plus newline delimiters.
3. Add `setBlock` operations on newline delimiters and tests for deterministic conflict behavior.
4. Add `$text.setBlock` for the block containing a given index.
5. Add `splitBlock` as newline insertion plus copied/default block attrs.
6. Add `joinBlock` as delimiter removal.
7. Update React rendering to use `view.blocks`.
8. Add Enter, Backspace-at-start, Delete-at-end, and multiline paste handling.
9. Add flat list-item attrs and renderer grouping.
10. Revisit nested container operations only after flat block editing works.

## Open questions

- Should rich text enforce a trailing newline delimiter for every document, including empty docs?
- Should `plainText` include structural newlines exactly as stored, or should the block view become
  the canonical plain-text export?
- Should block attrs be last-writer-wins as a whole object, or should individual attrs resolve
  independently?
- What is the minimum block set for the first feature: paragraph/heading only, or paragraph,
  heading, quote, and list item?
- Should ordinary `$text.insert` reject `\n`, or should it normalize to block-aware split/import
  behavior?
- When splitting a heading, should the new block inherit heading attrs or default to paragraph?
- When pressing Enter at the end of a list item, should an empty list item become a paragraph?
- Can inline marks apply across block delimiters, or should mark commands split per block and skip
  newline characters?
- How should comments or other multi-value annotations interact with block delimiters?
- Do we need stable block IDs for user-facing features such as comments on a block, drag/reorder,
  backlinks, or presence cursors?
- Should blockquote/list nesting be represented as flat `indent` attrs first, or do we need true
  container ranges from the start?
- How should old span-only snapshots migrate: one paragraph, paragraphs split on `\n`, or preserve
  text exactly in a single block?
- What HTML paste/export fidelity is required for lists, quotes, headings, and code blocks?
- What should undo batching do for Enter followed by typing: one command group or separate undo
  steps?

## Recommendation

Start with newline-delimited flat blocks and explicit `setBlock` operations on delimiters. It is
the smallest extension that fits the current Peritext engine and gives the editor real paragraph,
heading, quote, and flat list behavior. Treat true nested block containers and stable block node IDs
as follow-up design work, not prerequisites for useful block support.
