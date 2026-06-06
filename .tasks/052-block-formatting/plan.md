# Plan: Block CRDT Formatting

## Scope

Implement Peritext-style inline formatting for `src/block-crdt` using historical mark operations
anchored to character IDs.

This plan follows the decisions in `research.md`:

- marks are anchored to characters, not blocks;
- empty blocks cannot receive marks;
- split-at-start and split-at-end are normal split cases, but only character anchors participate in
  formatting;
- `crossedSplits` means splits the mark intentionally crosses;
- every mark explicitly stores its crossed split IDs at creation time;
- split identity is the new block ID;
- split records do not store `leftBlock` or `rightBlock`;
- archived blocks are not rendered, but mark traversal may need to pass through them;
- `char:move` is assumed to be generated only by split/join;
- keep all marks for now, without compaction.

Primary outcomes:

- `State` stores mark records and split records.
- `Op` supports idempotent mark and split-record application.
- `split(...)` emits split provenance.
- Formatting materialization returns block-level text runs with resolved marks.
- Tests lock down split-aware traversal, convergence, and mark resolution.

## Phase 1: Types and State Shape

Update `src/block-crdt/types.ts`.

Add JSON and formatting types:

```ts
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {[key: string]: JsonValue};

export type Boundary = {
    id: Lamport;
    at: 'before' | 'after';
};

export type Mark = {
    id: Lamport;
    start: Boundary;
    end: Boundary;
    remove: boolean;
    type: string;
    data?: JsonValue;
    crossedSplits: Lamport[];
};

export type SplitRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
};
```

Extend state:

```ts
export type State = {
    chars: Record<string, Char>;
    blocks: Record<string, Block>;
    marks: Record<string, Mark>;
    splits: Record<string, SplitRecord>;
    maxSeenCount: number;
};
```

Update all state construction paths:

- `initialState(...)` initializes `marks: {}` and `splits: {}`.
- Any tests or helpers constructing `State` directly include the new fields.
- `cachedState(...)` and `organizeState(...)` continue to focus on block/char caches unless a later
  phase needs a formatting cache.

Completion criteria:

- Existing block-crdt tests compile after adding empty `marks` and `splits`.
- Existing cache behavior is unchanged.

## Phase 2: Op Application

Update `src/block-crdt/index.ts`.

Extend `Op`:

```ts
export type Op =
    | ExistingOps
    | {type: 'mark'; mark: Mark}
    | {type: 'split-record'; split: SplitRecord};
```

Add apply handlers:

- `applyMark`
  - key by `lamportToString(mark.id)`;
  - insert when absent;
  - no-op when an identical mark already exists;
  - throw on same ID with different payload;
  - update `maxSeenCount` from the mark ID, anchor IDs, and `crossedSplits`.
- `applySplitRecord`
  - key by `lamportToString(split.id)`;
  - insert when absent;
  - no-op when identical;
  - throw on same ID with different payload;
  - update `maxSeenCount` from split ID, left ID, and right ID.

Keep these handlers independent of cache updates. The existing cache only indexes block/char
structure.

Add small equality helpers if useful. Prefer exact structural comparison over partial comparison so
duplicate IDs cannot silently diverge.

Completion criteria:

- Duplicate identical mark/split-record ops are idempotent.
- Duplicate conflicting mark/split-record ops throw clear errors.
- Existing op behavior is unchanged.

## Phase 3: Split Provenance

Update `split(...)` so every split that separates a left character from a right continuation emits
a `split-record` op.

Rules:

- Change the `split(...)` API to take the previous character explicitly.
- Use the new block ID as the split record ID.
- `left` is the explicit previous character passed to `split(...)`.
- `right` is the first character moved into the new block.
- Do not include block IDs in the split record.
- Split-at-start and split-at-end remain normal block operations, but emit a split record only when
  both `left` and `right` are actual characters.

Likely cases:

- Middle split with `at.char` present:
  - `right = at.char`;
  - `left` comes from the explicit previous-character argument.
- Split after the first block sentinel / at offset `0`:
  - no formatting split record, because marks cannot anchor to the block.
- Split at end:
  - no formatting split record if no right character exists.

Update all test harness and call sites to pass the previous character when one exists. This avoids
inferring formatting provenance from the current block projection after the split point has already
been resolved.

Completion criteria:

- Split op batches include deterministic split records for character-to-character boundaries.
- Existing split/join visible behavior remains unchanged.

## Phase 4: Character Traversal Helpers

Build the reusable traversal layer before formatting resolution.

Add helpers in `src/block-crdt/index.ts` first; extract later only if the file becomes unwieldy.

Needed helpers:

- `orderedCharIdsForBlock(state, blockId, options?)`
  - returns the block's left-to-right character IDs, including tombstones by default;
  - can optionally filter to visible chars for run rendering.
- `rootBlockIds(state, includeArchived?)`
  - deterministic root block order using `cache.blockChildren`;
  - archived blocks may be traversed for marks even when not rendered.
- `compareLamport(a, b)`
  - compare parsed Lamport tuples, not raw strings, where ordering matters.
- `splitRecordsByLeft(state)`
  - maps `left` char string to sorted split records;
  - when multiple records share a left, the record with the oldest `right` is preferred.

The traversal should preserve current text order. Do not change `charToString`, `blockContents`, or
`stateToString` behavior in this phase.

Completion criteria:

- Existing tests still pass.
- New helper tests prove traversal over linear text, tree-shaped text, deleted chars, and split
  blocks.

## Phase 5: Mark Creation Helpers

Add helper APIs for test and editor-style command construction.

Suggested helpers:

```ts
export const mark = (
    state: CachedState,
    range: {start: Lamport; end: Lamport},
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    id: Lamport,
): Op;
```

or a slightly higher-level block-offset helper for tests:

```ts
export const markRange = (
    state: CachedState,
    block: Lamport,
    startOffset: number,
    endOffset: number,
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    id: Lamport,
): Op;
```

Responsibilities:

- Convert visible offsets to character anchors.
- Reject empty ranges and empty-block marks.
- Accept ranges whose start and end characters are in the same current block, or are connected by
  existing split records that the user selection intentionally crosses.
- Populate `crossedSplits` by walking from start to end and collecting split IDs that are
  intentionally crossed.
- Use character-only boundaries.

Initial boundary convention:

- Start at `before` the first selected character.
- End at `after` the last selected character.

This is intentionally simple. More nuanced link/comment edge behavior can layer on later without
changing the mark storage format.

Completion criteria:

- Tests can create add/remove marks without manually spelling split IDs.
- Mark creation refuses invalid empty ranges clearly.

## Phase 6: Mark Coverage and Materialization

Add a non-incremental formatter.

Recommended public output:

```ts
export type FormattedRun = {
    text: string;
    marks: Record<string, JsonValue | true>;
};

export type FormattedBlock = {
    id: string;
    block: Block;
    runs: FormattedRun[];
};
```

Add:

```ts
export const materializeFormattedBlocks = (state: CachedState): FormattedBlock[];
```

Coverage algorithm:

1. Sort marks by Lamport ID.
2. For each mark, walk from `start` to `end` over character order.
3. Include tombstones while walking so deleted anchors still work.
4. When the walker reaches a split boundary:
   - if the split ID is in the mark's `crossedSplits`, ignore that split and stay in the current
     block order;
   - otherwise, follow the split from the left tail to `right` and continue.
5. Record covered visible character IDs for that mark.
6. For each rendered non-archived block, resolve marks on each visible char.
7. Merge adjacent visible chars with equal resolved marks into `FormattedRun`s.

Resolution rules:

- The CRDT core does not need hardcoded knowledge of mark types.
- For each `type`, the highest Lamport mark covering the character wins.
- If the winning mark has `remove: true`, that type is absent.
- If the winning mark has `data === undefined`, output `true`.
- Otherwise output the mark's `data`.

This treats comments like any other mark in the core. Multi-instance comment semantics can be a
higher-level interpretation later.

Completion criteria:

- Existing plain `blockContents`/`stateToString` behavior is unchanged.
- Formatted materialization produces stable runs for unformatted and formatted text.
- Archived blocks are omitted from output, but traversal can still pass through their chars.

## Phase 7: Deterministic Tests

Add focused tests to a new `src/block-crdt/formatting.test.ts` file.

State/op tests:

- initial state has empty `marks` and `splits`;
- mark op applies idempotently;
- split-record op applies idempotently;
- conflicting duplicate mark/split IDs throw;
- stale/replayed formatting ops do not affect char/block cache.

Basic formatting:

- simple bold in one block;
- overlapping bold and italic produce three runs;
- remove mark overrides add mark by Lamport order;
- later add mark overrides earlier remove;
- deleted chars do not render but preserve anchors.

Boundary behavior:

- empty range is rejected by helper;
- empty block mark is rejected;
- split-at-start and split-at-end do not create invalid formatting anchors;
- insertion inside a marked range receives formatting when covered by the resolved anchors;
- insertion outside a marked range does not receive formatting.

Split behavior:

- mark before split follows a later split when the mark's `crossedSplits` does not contain that
  split ID;
- mark created across an existing split stores that split ID and ignores the split during traversal;
- mark after split inside the left block does not leak into the right block;
- concurrent edit after the split-left char lands on the expected side of the formatted range;
- multiple splits with the same left choose the deterministic oldest-right path.

Join behavior:

- joining blocks preserves marks anchored inside both original blocks;
- marks can traverse archived right-block chars when needed;
- archived blocks are not rendered in formatted output.

Convergence:

- apply mark and split batches in both orders and assert identical formatted output;
- apply mark and join batches in both orders and assert identical formatted output;
- replay duplicate formatting ops and assert no output change.

Completion criteria:

- Targeted formatting tests pass.
- Existing block-crdt tests still pass.

## Phase 8: Property Tests

Add bounded `fast-check` coverage after deterministic behavior is clear.

Generate small scenarios:

- 1-3 actors;
- 1-4 blocks;
- 1-20 visible characters;
- operations: insert, delete, split, join, mark, unmark;
- keep mark helper generation conservative: non-empty ranges in one current block.

Properties:

- Cache invariant: `state.cache` equals `organizeState(state.state.blocks, state.state.chars)`.
- Plain text invariant: formatted runs joined by text equal visible block contents.
- Convergence invariant: causal permutations of the same op batches produce equal formatted output.
- Idempotency invariant: replaying delivered mark/split-record ops does not change formatted output.
- No duplication invariant: a visible char appears at most once in formatted output.

Keep bounds low until failures are easy to diagnose.

## Phase 9: Verification

Run targeted tests:

```sh
npm exec vitest run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts
```

Then run broader checks:

```sh
npm exec vitest run
npm run typecheck
```

## Implementation Order

1. Add formatting/split record types and empty state fields.
2. Add mark and split-record op application.
3. Add traversal helpers.
4. Update `split(...)` to emit split records.
5. Add mark creation helpers.
6. Add non-incremental formatted materialization.
7. Add deterministic formatting tests.
8. Add bounded property tests.
9. Run targeted and final verification.

## Non-Goals

- Marking empty blocks.
- Block-level formatting.
- Editor UI integration.
- Formatting cache optimization.
- Mark history compaction.
- General-purpose `char:move` support outside split/join.
- Fully typed policy for multi-instance comments.
