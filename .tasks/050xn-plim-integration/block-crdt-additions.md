# Block CRDT Additions For Editor Adapters

## Goal

Add a small set of public `umkehr/block-crdt` APIs that make third-party editor adapters practical without constructing raw ops or copying internal example code.

The immediate motivator is a Plim adapter, but the APIs should stay editor-agnostic. The common adapter problems are:

- creating arbitrary blocks, not only blocks produced by split
- deleting blocks with explicitly documented descendant behavior
- converting editor path/offset selections to stable block/character ids
- applying marks across multi-block selections
- converting between UTF-16 editor offsets and CRDT grapheme offsets
- retaining selections across remote ops without depending on example-only code

The package already has most of the underlying primitives. The proposed work is mostly about making those primitives public, typed, and hard to misuse.

## Design Principles

Keep the existing `block-crdt` API style:

- Helpers return plain `Op[]`.
- Helpers do not hide the op log behind transactions.
- Helpers validate visible editor-facing inputs and throw deterministic errors for impossible local requests.
- Remote/out-of-order dependency handling remains the job of `applyRemote` / `applyRemoteMany`.
- Helpers accept stable Lamport ids and visible offsets, not DOM nodes or editor-specific paths.
- Any path helpers use `number[]` only as a generic visible-tree address, not as a canonical identifier.

Do not add Plim-specific concepts such as `BlockNode`, `TextSpan`, or `TransactionOp` to `block-crdt`.

## Priority 1: Public Block Insertion

### API

```ts
export type InsertBlockOpsOptions<M extends TimestampedBlockMeta> = {
    actor: string;
    parent: Lamport;
    before?: Lamport | null;
    after?: Lamport | null;
    meta: M;
    ts: HLC;
    options?: LseqOptions;
};

export function insertBlockOps<M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    options: InsertBlockOpsOptions<M>,
): Op<M>[];
```

### Semantics

Create one new visible block as a child of `parent`, positioned between adjacent visible siblings `before` and `after`.

The emitted op is a single `block` op:

```ts
{
    type: 'block',
    block: {
        id: [state.state.maxSeenCount + 1, actor],
        meta,
        order: {
            id: [state.state.maxSeenCount + 1, actor],
            path: [...materializedParentPath, id],
            index: createLseqIdBetween(beforeIndex, afterIndex, ...),
            ts,
        },
        deleted: false,
    },
}
```

`parent` may be `[0, 'root']`. Hidden deleted/joined parents are not valid public insertion targets.

`before` and `after` follow the same adjacency model as `moveBlockOps`:

- `before: null, after: firstChild` inserts at the beginning.
- `before: lastChild, after: null` inserts at the end.
- `before: null, after: null` is valid only when the parent has no visible children.
- Non-null `before` and `after` must both be visible children of `parent` and adjacent in visible sibling order.

### Why It Is Needed

`splitBlockOps` covers Enter-like editing, but editor integrations also need direct block creation for:

- paste of block-structured content
- slash-command insertion
- atomic/custom blocks such as dividers, images, embeds, callouts, or database views
- importing editor-native JSON
- creating an empty paragraph after an atomic block

Without this helper, adapters have to reconstruct `block` ops and LSEQ placement manually.

### Validation

Throw for:

- missing or hidden parent, except `[0, 'root']`
- `parent` equal to a joined block
- non-null anchors that are not visible children of `parent`
- non-adjacent anchors
- duplicate/impossible anchors
- actor id invalid under Lamport string encoding

`validateOp(...)` can still validate emitted shape, but the helper should catch editor-facing mistakes before op construction.

### Tests

Add tests for:

- insert into empty root
- insert before first sibling
- insert after last sibling
- insert between siblings
- insert under nested parent
- reject non-adjacent anchors
- reject anchors from a different parent
- reject deleted/joined parent
- convergence for concurrent inserts between the same anchors
- remote pending behavior when the parent block has not arrived

## Priority 1: Public Block Deletion

### API

```ts
export type DeleteBlockMode = 'block-only' | 'subtree';

export type DeleteBlockOpsOptions = {
    block: Lamport;
    mode?: DeleteBlockMode;
};

export function deleteBlockOps<M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    options: DeleteBlockOpsOptions,
): Op<M>[];
```

### Semantics

Emit `block:delete` ops for visible blocks.

`mode: 'block-only'` deletes exactly the target block. This matches current raw `block:delete` behavior:

- the block's own text disappears
- the block remains as a tombstone
- visible descendants are logically spliced into the nearest visible ancestor by `visibleBlockChildren` / `visibleBlockOutline`

`mode: 'subtree'` deletes the target block and all currently visible descendants. This matches editors where removing a parent block removes its nested subtree.

Default should be `block-only` to preserve the CRDT's existing operation semantics and avoid surprising data loss. Plim adapters can explicitly request `subtree` when translating `removeBlock`.

### Why It Is Needed

`block:delete` is already a wire op and is used in tests/undo, but there is no public helper. The README says normal integrations should prefer change helpers because raw ops have non-obvious invariants. Deleting a block is common enough that requiring raw ops is an API gap.

### Validation

Throw for:

- block does not exist
- block is already deleted
- block is hidden by a join

For `subtree`, gather descendants through the visible logical tree, not raw `order.path` children. This keeps behavior consistent with joined/deleted parent splicing.

### Open Design Choice

Should deleting a block also delete its characters with `char:delete` ops?

Recommended answer: no. A deleted block already hides its own text. Character tombstones would be redundant, add many ops, and make future resurrection/un-delete harder. If a future API wants "clear block text but keep block", that should be a separate text deletion helper.

### Tests

Add tests for:

- block-only delete hides target text and splices child blocks upward
- subtree delete hides target and visible descendants
- concurrent block move and block delete converge
- duplicate delete is idempotent through `applyRemote`
- delete op is pending when target block is missing
- delete joined block is rejected by helper

## Priority 2: Path And Visible Tree Addressing Helpers

### API

```ts
export type VisibleBlockPath = number[];

export function blockIdAtVisiblePath<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    path: VisibleBlockPath,
): string | null;

export function visiblePathForBlockId<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
): VisibleBlockPath | null;

export function visibleBlockEntryAtPath<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    path: VisibleBlockPath,
): VisibleBlockOutlineEntry | null;

export function visibleSiblingAnchorsForPath<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    path: VisibleBlockPath,
): {
    parent: Lamport;
    before: Lamport | null;
    after: Lamport | null;
} | null;
```

### Semantics

These helpers expose generic tree addressing for adapter-local UI paths. They are not a persistence format.

`blockIdAtVisiblePath(state, [2, 0])` means:

1. take the third visible root block
2. take its first visible child
3. return that block id string

`visiblePathForBlockId` performs the reverse lookup for currently visible blocks. It returns `null` for deleted or joined blocks.

`visibleSiblingAnchorsForPath` is the bridge from path insertion/move APIs to CRDT anchor APIs. Given a target insertion path, it returns the visible parent and adjacent sibling ids needed by `insertBlockOps` / `moveBlockOps`.

Example:

```ts
// Insert at root index 3.
visibleSiblingAnchorsForPath(state, [3]);
// => {parent: [0, 'root'], before: idAtRoot2, after: idAtRoot3}

// Insert as second child of root block 0.
visibleSiblingAnchorsForPath(state, [0, 1]);
// => {parent: rootBlock0, before: firstChild, after: secondChild}
```

### Why It Is Needed

Plim and many editors use `number[]` paths in transactions and selections. Adapters should immediately convert those paths to stable ids, but every adapter should not have to reimplement visible tree traversal and hidden-parent splicing.

### Validation

Return `null`, not throw, for paths that do not exist. For insertion paths, returning anchors for the position after the last child is valid.

Throwing should be reserved for malformed paths such as negative indexes or non-integers if runtime validation is included.

### Tests

Add tests for:

- root path lookup
- nested path lookup
- reverse lookup
- deleted parent with visible child spliced upward
- joined block hidden from lookup
- insertion anchors at beginning, middle, end, and nested positions
- invalid path returns `null`

## Priority 2: Retained Selection Primitives

### API

```ts
export type BlockPoint = {
    blockId: string;
    offset: number;
};

export type RetainedPoint = {
    blockId: string;
    affinity: 'before' | 'after';
    charId: string | null;
};

export type RetainedSelection =
    | {type: 'caret'; point: RetainedPoint}
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint};

export function retainPoint<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    point: BlockPoint,
    options?: {affinity?: 'before' | 'after'},
): RetainedPoint;

export function resolvePoint<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    point: RetainedPoint,
): BlockPoint;

export function retainSelection<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    selection:
        | {type: 'caret'; point: BlockPoint}
        | {type: 'range'; anchor: BlockPoint; focus: BlockPoint},
): RetainedSelection;

export function resolveSelection<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    selection: RetainedSelection,
):
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint};
```

### Semantics

These should be a generalized and polished version of `examples/block-rich-text/src/retainedSelection.ts`.

`retainPoint` converts a visible block/offset position into a stable character anchor:

- offset `0` anchors to `{charId: null, affinity: 'after'}` at the block start
- offset `N > 0` anchors to the visible character immediately before the point with `affinity: 'after'`
- optional `affinity: 'before'` can anchor to the visible character immediately after the point when useful for selections

`resolvePoint` converts back to the current visible block/offset by scanning all logical character ids, including deleted chars, and counting only visible chars.

Important behavior:

- remote insert before the retained char moves the resolved offset forward
- remote delete of the retained char resolves near the tombstoned position
- split follows the character into the new block
- join resolves hidden right-block positions into the visible joined location when possible
- block move keeps the point in the same stable block

### Why It Is Needed

Path/offset selections are not enough for collaborative editors. After remote edits, an inactive caret should remain logically near the same content rather than at the same numeric offset. The example already proves this model, but adapters should not depend on example-local files.

### Needed Improvements Over Example Code

The current example fallback for hidden blocks is conservative and sometimes falls back to the first visible block. The library version should do better for joins:

- if a retained char is in a joined right block, resolve to the visible joined left block stream
- if a retained block is deleted and no char anchor exists, resolve to the nearest visible neighbor in document order when possible
- preserve `affinity` consistently at start/end boundaries

### Tests

Add tests for:

- insert before retained caret
- insert after retained caret
- delete retained char
- delete text before retained caret
- split before/after retained point
- join with point in right block
- block move with retained point inside moved block
- deleted block fallback
- range anchor/focus direction preservation

## Priority 2: Multi-Block Mark Helpers

### API

```ts
export type MarkRangePoint = {
    block: Lamport;
    offset: number;
};

export type MarkRange = {
    start: MarkRangePoint;
    end: MarkRangePoint;
};

export function markRangesOps<M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    ranges: MarkRange[],
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    options: {
        actor: string;
        ts?: HLC;
        nextId?: () => Lamport;
    },
): Op<M>[];

export function markSelectionOps<M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    selection: {
        anchor: {blockId: string; offset: number};
        focus: {blockId: string; offset: number};
    },
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    options: {
        actor: string;
        ts?: HLC;
        nextId?: () => Lamport;
    },
): Op<M>[];
```

### Semantics

`markRangesOps` emits one `mark` op per non-empty single-block range. The helper allocates stable mark ids either from `nextId` or from `state.state.maxSeenCount + 1`, `+2`, etc. using `actor`.

`markSelectionOps` expands a visible multi-block selection into per-block ranges using visible block order:

- start block: `startOffset..endOfBlock`
- middle text blocks: `0..endOfBlock`
- end block: `0..endOffset`

Empty ranges are skipped.

This intentionally does not introduce a new multi-block mark wire op. It is a convenience helper over existing `mark` ops.

### Why It Is Needed

Editor transactions often represent a selection spanning multiple blocks. Today, adapters must copy selection normalization logic and call `markRangeOp` repeatedly. A helper reduces off-by-one errors and keeps crossed-split handling centralized.

### Open Design Choice

Should `markSelectionOps` preserve a single logical mark id across blocks?

Recommended answer: no for now. The wire format already models marks as anchored character ranges. Use one Lamport id per block segment. If later UX needs a cross-block mark group identity, that should be an optional `data` field or a new mark grouping layer, not a change to basic range marking.

### Tests

Add tests for:

- single-block selection matches `markRangeOp`
- multi-block add mark
- multi-block remove mark
- selection direction does not matter
- empty blocks are skipped
- ranges across existing splits include crossed split ids
- generated mark ids are unique and monotonic

## Priority 3: Grapheme And Offset Utilities

### API

```ts
export function segmentGraphemes(text: string): string[];

export function graphemeLength(text: string): number;

export function utf16OffsetToGraphemeOffset(text: string, utf16Offset: number): number;

export function graphemeOffsetToUtf16Offset(text: string, graphemeOffset: number): number;
```

### Semantics

Use the same segmentation behavior as `insertTextOps`, currently `Intl.Segmenter`.

`utf16OffsetToGraphemeOffset` clamps to the nearest valid grapheme boundary:

- offsets inside a grapheme cluster resolve to the cluster boundary according to an option if we add one later
- initial version can resolve inside-cluster offsets to the preceding grapheme boundary, because that is safest for deletion/insertion

Potential extended form:

```ts
type BoundaryBias = 'backward' | 'forward' | 'nearest';

utf16OffsetToGraphemeOffset(text, offset, {bias: 'backward'});
graphemeOffsetToUtf16Offset(text, offset);
```

### Why It Is Needed

Many DOM/editor APIs report UTF-16 offsets. `block-crdt` text offsets are visible grapheme offsets because inserted chars are allocated with `Intl.Segmenter`. Adapters need one canonical conversion utility or they will corrupt positions for emoji, combining marks, and other multi-code-unit graphemes.

### Tests

Add tests for:

- ASCII identity
- emoji
- combining marks
- zero-width-joiner emoji sequences
- clamping negative and too-large offsets
- round trips at valid boundaries

## Priority 3: Visible Text Utilities

### API

```ts
export function visibleTextForBlock<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
): string;

export function visibleGraphemeIdsForBlock<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
): string[];

export function visibleLengthForBlock<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
): number;

export function clampBlockPoint<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    point: BlockPoint,
): BlockPoint;
```

### Semantics

These wrap existing traversal/materialization functions with adapter-friendly names.

`visibleTextForBlock` differs from `blockContents` only by making the visible-only contract explicit.

`visibleGraphemeIdsForBlock` should likely be an alias for `orderedCharIdsForBlock(state, blockId, {visibleOnly: true})`, but a named helper clarifies that ids correspond to visible grapheme clusters.

`clampBlockPoint` should preserve the input block if visible, otherwise fall back by visible document order. This supports selection recovery after deletes and rematerialization.

### Why It Is Needed

Adapters constantly need block lengths, text snapshots, and clamped points. The current APIs can do this, but the names are lower-level or example-local.

### Tests

Add tests for:

- visible text excludes deleted chars
- visible length counts graphemes, not UTF-16 units
- clamping offsets
- clamping hidden block falls to nearest visible block if implemented

## Priority 3: Better Created-ID Discovery

### API Option A: Helper

```ts
export function createdBlockIdForOps<M extends TimestampedBlockMeta>(ops: Op<M>[]): Lamport | null;
```

### API Option B: Planned Result

```ts
export type PlannedOps<TInfo, M extends TimestampedBlockMeta> = {
    ops: Op<M>[];
    info: TInfo;
};

export function insertBlockPlan<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    options: InsertBlockOpsOptions<M>,
): PlannedOps<{block: Lamport}, M>;
```

### Recommendation

Start with no new return wrapper. Keep helper style as `Op[]`, and document that callers can inspect `ops.find(op => op.type === 'block')?.block.id`.

If several adapters need created ids before applying ops, add small introspection helpers rather than changing established helper return types.

## Proposed Export Changes

Add to `src/block-crdt/index.ts`:

```ts
export {
    deleteBlockOps,
    insertBlockOps,
    markRangesOps,
    markSelectionOps,
} from './changes.js';

export {
    blockIdAtVisiblePath,
    clampBlockPoint,
    resolvePoint,
    resolveSelection,
    retainPoint,
    retainSelection,
    segmentGraphemes,
    utf16OffsetToGraphemeOffset,
    graphemeOffsetToUtf16Offset,
    visibleGraphemeIdsForBlock,
    visibleLengthForBlock,
    visiblePathForBlockId,
    visibleSiblingAnchorsForPath,
    visibleTextForBlock,
} from './traversal.js'; // or split into selection/positions modules
```

Prefer new modules if this makes `traversal.ts` too broad:

- `src/block-crdt/positions.ts`
- `src/block-crdt/selection.ts`
- `src/block-crdt/text.ts`

Then export them from the package root and optionally as subpaths.

## Implementation Order

1. Add `insertBlockOps` and `deleteBlockOps`.
2. Add visible path helpers.
3. Add retained point/selection helpers.
4. Add multi-block mark helpers.
5. Add grapheme conversion utilities.
6. Add docs and adapter examples.

This order lets a Plim adapter progress quickly: block insertion/deletion and path conversion unblock core transaction translation; retained selections and grapheme conversion improve correctness; mark helpers reduce duplication.

## Documentation Updates

Update `src/block-crdt/Readme.md`:

- Add the new helpers to "Change Helpers".
- Document the difference between block-only and subtree deletion.
- Document visible paths as adapter-only addressing, not durable ids.
- Add a "Selections And Positions" section covering retained selections and grapheme offsets.
- Update release checklist tests to include the new helper test files.

## Residual Open Questions

1. Should `deleteBlockOps` default to `block-only` or require an explicit `mode` every time?
2. Should `insertBlockOps` accept an explicit block id for adapters that need to synchronize UI ids before applying ops?
3. Should path helpers include hidden blocks for debugging, or stay visible-only for editor adapters?
4. Should retained selection APIs live in core `block-crdt`, or in a separate `block-crdt/selection` submodule to keep the core wire API smaller?
5. Should grapheme conversion use global `Intl.Segmenter`, or should `block-crdt` allow an injected segmenter for deterministic server/client behavior?
