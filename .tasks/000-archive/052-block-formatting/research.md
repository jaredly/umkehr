# Block CRDT formatting research

## Summary

Implement inline formatting as Peritext-style historical mark operations anchored to stable
character/block IDs, but adapt traversal to the current `src/block-crdt` model where split/join
physically move character roots between first-class blocks.

The current block CRDT is not the earlier flat Peritext engine. Its text order is a causal tree per
block, and split/join are represented as `char:move` operations plus block creation/archive. That is
good for preserving character IDs, but formatting needs one additional piece of durable structure:
split provenance. Without explicit split records, a mark that existed before a split cannot know
that it should continue across the newly-created block boundary.

Recommended v1:

- add mark operations to `Op` and `State`;
- add explicit split records to `State`;
- materialize formatted block runs from marks rather than storing current formatting on chars;
- keep mark operations historical/additive, with `remove` marks represented as normal mark ops;
- make traversal deterministic and heavily tested before optimizing caches.

## Relevant prior art

Peritext stores formatting spans alongside a plaintext CRDT sequence. Span endpoints are linked to
stable character identifiers, and the visible document is derived deterministically from historical
mark operations. The published algorithm also treats editor-facing indexes as local projections:
replicated operations use character IDs and before/after handles.

Peritext applies formatting by maintaining active mark operation sets at character boundaries. For
overlapping marks of the same type, it resolves to the operation with the greatest operation ID; for
multi-instance marks such as comments, all non-removed instances can coexist. It also documents the
important boundary rule: most character formatting inherits from the preceding character at span
edges, while links/comments often should not expand at their boundaries.

Sources:

- Martin Kleppmann publication page:
  https://martin.kleppmann.com/2022/11/08/peritext-rich-text-crdt.html
- Ink & Switch Peritext essay:
  https://www.inkandswitch.com/peritext/
- Paper DOI:
  https://doi.org/10.1145/3555644

## Current implementation baseline

Relevant local files:

- `src/block-crdt/types.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/Formatting.md`

Current state:

```ts
export type State = {
    chars: Record<string, Char>;
    blocks: Record<string, Block>;
    maxSeenCount: number;
};
```

Current cache:

```ts
export type Cache = {
    blockChildren: Record<string, string[]>;
    charContents: Record<string, string[]>;
};
```

Text order is derived by walking `charContents` under each block. Character children are sorted by
descending Lamport string, and `charToString` recursively emits a char followed by its children.

Splits:

- create a new sibling block;
- move the split character to the new block;
- move later sibling subtrees under the previous tail;
- encode incidental split reparenting with rich `parent.ts` ancestry data so concurrent splits
  converge.

Joins:

- move right block roots under the left block tail;
- move additional right roots under prior tails;
- archive the right block.

This means formatting cannot assume one immutable global character sequence. It must follow the
same left-to-right projection the block CRDT materializes, and it needs explicit knowledge of
structural split boundaries.

## Data model recommendation

Extend the sketch in `src/block-crdt/Formatting.md`, but make split records first-class:

```ts
type Boundary = {
    id: Lamport;
    at: 'before' | 'after';
};

type Mark = {
    id: Lamport;
    start: Boundary;
    end: Boundary;
    remove: boolean;
    type: string;
    data?: JsonValue;
    crossedSplits: Lamport[];
};

type SplitRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
    leftBlock: Lamport;
    rightBlock: Lamport;
};

type State = {
    chars: Record<string, Char>;
    blocks: Record<string, Block>;
    marks: Record<string, Mark>;
    splits: Record<string, SplitRecord>;
    maxSeenCount: number;
};
```

Use `Record<string, Mark>` rather than `Mark[]` for idempotent apply and easier duplicate handling.
If ordering is needed for rendering, sort by parsed Lamport ID.

`SplitRecord.id` can use the new block's ID for simple middle/end splits, but it may be clearer to
emit a separate `split` op so the split identity is not overloaded with block identity. The record
must outlive joins and block archive status.

## Operation recommendation

Add two operation variants:

```ts
type Op =
    | ExistingOps
    | {type: 'mark'; mark: Mark}
    | {type: 'split-record'; split: SplitRecord};
```

Then update `split(...)` to emit a `split-record` op when there is a real boundary from a left
position to a right continuation. The split record should be emitted alongside the block and
`char:move` ops, not inferred later from state.

For v1, a mark op can be idempotent:

- if the mark ID is absent, insert it;
- if the same ID is present with identical payload, no-op;
- if the same ID is present with different payload, throw, matching `char` reinsertion behavior.

No mark deletion operation is needed. Unformatting is `Mark.remove === true`.

## Traversal semantics

The formatter needs a deterministic iterator over anchor boundaries, not only visible characters.
It should work over tombstones too, because old anchors may point at deleted chars.

Suggested mental model:

1. Resolve `start` to a boundary in the materialized block character order.
2. Walk forward until `end`.
3. When reaching the tail of a split's `left` char, decide whether to jump to that split's `right`
   char and continue in the right block.
4. When multiple split records share the same `left`, choose the split whose `right` Lamport sorts
   oldest according to parsed Lamport order. This matches `Formatting.md`'s current hypothesis.
5. Ignore joins as separate traversal edges. Joins already move right-side text into left-to-right
   order; split records remain only to preserve earlier formatting intent.

The key policy should probably be:

- a mark created before a split should cross that later split;
- a mark created after a split should not cross that existing split unless the user-selected range
  explicitly crossed it;
- a mark whose range explicitly crosses an existing split should store that split in
  `crossedSplits`.

That requires either a reliable way to know whether a split was visible/known when the mark was
created, or a richer mark snapshot. See open questions.

## Materialization recommendation

Start with a simple non-incremental materializer:

```ts
type FormattedRun = {
    text: string;
    marks: Record<string, JsonValue | true>;
};

type FormattedBlock = {
    block: Block;
    runs: FormattedRun[];
};
```

Algorithm:

1. For each visible root block, produce the ordered character/boundary list.
2. For each mark, compute the set of character IDs covered by the mark using the traversal rules.
3. For each visible character, collect applicable mark ops.
4. Resolve marks:
   - mutually-exclusive mark types use highest Lamport ID wins;
   - `remove: true` means the winning value is absent;
   - mark types that can coexist, such as comments, need explicit type policy later.
5. Merge adjacent visible characters into runs when resolved marks are equal.

This is slower than Peritext's boundary op-set cache, but it is much easier to verify while the
split traversal model is still unsettled. Once behavior is locked down, add a cache equivalent to
Peritext's `markOpsBefore` / `markOpsAfter`.

## Boundary behavior

Expose mark creation through helpers rather than requiring callers to hand-author boundaries.

Useful presets:

- normal style marks (`bold`, `italic`, `color`) should usually use start `after previous` and end
  `after last`, so insertion at the trailing edge inherits from the previous character;
- links/comments should likely use stricter boundaries so typing just outside the link/comment does
  not extend it;
- block start/end need block-boundary anchors or sentinel handling, because empty blocks and
  start-of-block formatting have no character on one side.

The current `Boundary` shape only accepts a Lamport ID and before/after. That can work if block IDs
are valid anchors, as `selPos` already returns the block ID for selection offset `0`. It needs tests
for empty blocks, split-at-start, and split-at-end.

## Testing strategy

Add focused deterministic tests before property tests:

- simple bold within one block;
- remove mark overrides add mark by Lamport order;
- overlapping bold/italic materializes three runs;
- concurrent insert inside existing mark inherits formatting;
- insert at mark boundary follows chosen preset behavior;
- mark before split continues across the resulting two blocks;
- mark after split inside left block does not leak into the right block;
- mark after split across two blocks does cross only the selected split;
- concurrent edit after split-left char lands on the expected side of the formatted range;
- multiple splits with same left choose a deterministic path;
- join preserves formatting anchored inside both original blocks;
- deleted chars do not render but still preserve mark anchors;
- duplicate `mark` and `split-record` ops are idempotent;
- applying split/mark ops in opposite orders converges.

After deterministic coverage, add `fast-check` scenarios similar to the existing block split tests:

- generate text inserts, splits, joins, marks, unmarks, and deletes;
- apply operation batches in different orders;
- assert cache consistency and equal formatted materialization.

## Implementation path

1. Add `Mark`, `Boundary`, `SplitRecord`, and `JsonValue` types to `types.ts`.
2. Extend `State`, `initialState`, and `organizeState`/cache initialization as needed.
3. Add `mark` and `split-record` op variants plus idempotent apply handlers.
4. Update `split(...)` to emit split records.
5. Add low-level traversal helpers:
   - ordered chars for a block;
   - boundary comparison/resolution;
   - split lookup by left char;
   - mark coverage walker.
6. Add `formattedBlockContents` or `materializeFormattedBlocks` without changing existing
   `stateToString` behavior.
7. Add deterministic tests.
8. Only after behavior is clear, consider incremental mark caches.

## Open questions

- Does `crossedSplits` mean "splits this mark intentionally crosses" or "splits that already
  existed and should block traversal"? `Formatting.md` uses "ignored" in a way that could be read
  either direction. I recommend defining it as intentionally crossed split IDs.
    - intentionally crossed
- How do we reliably distinguish a split that was known before mark creation from an unseen
  concurrent split with a lower Lamport counter? If Lamport IDs are not enough causal context,
  marks may need a split frontier, a known-splits set, or a different traversal rule.
    - marks should have a crossedSplits set explicitly
- Should split identity be the new block ID, or should `split(...)` allocate a separate Lamport ID
  for the split record?
    - new block ID is fine
- What are the exact anchor semantics for empty blocks, split-at-start, and split-at-end?
    - marks are anchored to characters, not blocks. empty blocks cannot receive marks. split at start/end are treated as regular splits.
- Are block IDs officially valid formatting anchors, or should we introduce explicit
  `startOfBlock` / `endOfBlock` anchor variants?
    - marks are anchored to characters, not blocks
- Which mark types are mutually exclusive and which are multi-instance? Bold/color/link/comment
  need different resolution policies.
    - comment is multi-instance, the others are single-instance, but the CRDT algorithm shouldn't care
- Should `data` for `remove` marks identify a specific instance for multi-instance marks such as
  comments, or does removal apply to the whole mark type over the range?
    - the CRDT algorithm shouldn't care
- Can marks intentionally span multiple sibling blocks in the public editor model, or should mark
  commands be block-local in v1?
    - marks are anchored to characters, not blocks. On mark creation, the start & end characters will be in the same block, but due to concurrent splitting, the start & end characters may end up in different blocks.
- Should formatting apply to archived blocks when materializing history, or only to visible blocks
  in the current editor view?
    - archived blocks are not rendered, but formatting marks may need to traverse them
- How should formatting interact with `char:move` operations that are not generated by split/join
  in the future?
    - char:move operations are only generated by split/join
- Is the "oldest right wins" rule for multiple splits with the same left sufficient under equal
  Lamport counters from different actors, or should the ordering use full parsed Lamport comparison
  and be documented as arbitrary but deterministic?
    - yeah it's deterministic in the same way that char:move resolution is in that circumstance
- Do we want the initial implementation to preserve full mark history for future diff/history UI,
  or may it compact to one winning mark per covered span once behavior is proven?
    - maintain all marks for now

## Addotional notes

Splits should not have leftBlock/rightBlock properties.
