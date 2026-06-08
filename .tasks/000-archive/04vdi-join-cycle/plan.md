# Plan: Join Records and Cycle-Free Materialization

## Goal

Replace the current denormalized join representation with explicit join records so concurrent joins cannot create block/char cycles.

The intended model:

- joins are stored as first-class records
- active joins are derived during cache/materialization
- join sentinel chars are derived, not stored as ordinary `char` ops
- right-block visibility is derived from active joins
- conflicting joins are resolved deterministically
- lower Lamport join id wins, matching the split preference for lower Lamport when that gives the more stable structural winner
- adjacency remains an editor-command concern, not a CRDT invariant
- no migration is needed for existing persisted documents

## Phase 1: Types and State Shape

Add a join record type in `src/block-crdt/types.ts`:

```ts
export type JoinRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
    tail: Lamport;
    ts: HLC;
};
```

Add `joins: Record<string, JoinRecord>` to `State`.

Update `initialState` to initialize `joins: {}`.

Update `Op` in `src/block-crdt/index.ts`:

```ts
| {type: 'join-record'; join: JoinRecord}
```

Remove join's dependency on creating a stored sentinel `char` with `id: right`.

Decision: keep `Block.deleted` timestamped for explicit block deletion, but do not use it for joins.

Suggested block deletion shape:

```ts
deleted: false | {ts: HLC};
```

If that causes too much churn, this can be deferred and `deleted: boolean` can remain temporarily. The critical part is that joins should no longer use `block:delete`.

## Phase 2: Apply Semantics

Add `applyJoinRecord`.

It should:

- be idempotent
- reject conflicting duplicate join ids, like marks and split records already do
- update `maxSeenCount` from `join.id`, `join.left`, `join.right`, and `join.tail`
- not mutate char parent pointers
- not directly delete/tombstone blocks
- leave cache rebuilding/materialization responsible for active join effects

Update `apply`, `applyMany`, `cachedState`, and any state destructuring that currently assumes `State` only has `chars`, `blocks`, `marks`, `splits`, and `maxSeenCount`.

For explicit block deletion:

- add a timestamp to `block:delete` if making deletion timestamped in this pass
- make `applyBlockDelete` choose the later delete timestamp
- preserve idempotency

Open implementation choice: whether `block:delete` needs an actor-generated timestamp now. If no current caller needs explicit block deletion outside tests, this can be kept minimal.

## Phase 3: Active Join Derivation

Implement a helper that derives active joins from all join records:

```ts
export const activeJoinRecords = (state: State): JoinRecord[] => ...
```

Algorithm:

1. Sort join records by lower Lamport `join.id` first.
2. Maintain accepted directed edges from `right -> left`.
3. For each candidate join, skip it if adding `right -> left` would create a cycle.
4. Otherwise accept it.

Cycle detection should use block ids, not char ids.

For a candidate `right -> left`, adding it creates a cycle if `left` already reaches `right` through accepted join edges.

Example:

```text
A <- B means edge B -> A
B <- A means edge A -> B
```

If `B -> A` was accepted first, then `A -> B` is skipped because `B` is already reachable from `A` after adding the second edge.

Expose helpers for materialization:

```ts
export const activeJoinByRightBlock = (state: State): Record<string, JoinRecord>;
export const joinedBlockIds = (state: State): Set<string>;
```

These helpers should be deterministic and independent of operation application order.

## Phase 4: Derived Cache Construction

Update `organizeState` so cache construction includes derived join sentinel edges for active joins.

Current cache inputs:

- `blockChildren` from `blocks[*].order.parent`
- `charContents` from stored `chars[*].parent.id`

New behavior:

- build stored `charContents` from real chars only
- derive one deleted sentinel char-like edge for each active join
- place the joined right block's root/sentinel under `join.tail`
- do not store that sentinel in `state.chars`

This needs a representation decision because many traversal helpers assume every char id in `charContents` exists in `state.chars`.

Recommended approach:

1. Extend `Cache` with derived join metadata:

```ts
type Cache = {
    blockChildren: Record<string, string[]>;
    charContents: Record<string, string[]>;
    joinSentinels: Record<string, JoinRecord>;
    joinedBlocks: Record<string, JoinRecord>;
};
```

2. Teach char readers to treat a join sentinel id as a deleted empty char when `id` is present in `cache.joinSentinels`.

Helpers to add:

```ts
const getCharRecord(state: CachedState, id: string): Char | DerivedJoinChar | undefined;
const isDeletedChar(state: CachedState, id: string): boolean;
const charText(state: CachedState, id: string): string;
```

3. Update traversal sites to use these helpers instead of indexing `state.state.chars[id]` directly where derived sentinels may appear.

Key affected functions:

- `charToString`
- `selPos`
- `orderedCharIdsForBlock`
- `findTail` callers
- formatting traversal helpers
- split traversal where it walks char parents

Important guardrail: split should not attempt to move a derived join sentinel as though it were a stored char. If a split reaches or crosses joined content, confirm whether it should split the visible materialized stream or only stored block-local chars. Add tests before changing behavior here.

## Phase 5: Block Visibility and Rendering

Update root/block traversal helpers so active joined-right blocks are hidden even though their `Block.deleted` field is not set.

Affected functions:

- `rootBlockIds`
- `stateToString`
- `materializeFormattedBlocks`
- example/editor code that filters `block.deleted`

Rules:

- explicitly deleted blocks are hidden
- blocks that are `right` of an active join are hidden at their original block position
- children of a hidden joined/deleted block should render as children of that block's parent

The inline decision says: "deleted block children are rendered as children of the deleted block's parent."

This implies block traversal should flatten children of hidden blocks into their nearest visible ancestor's child list.

Add a helper:

```ts
export const visibleBlockChildren = (state: CachedState, parent: string): string[] => ...
```

This helper should:

- start from `cache.blockChildren[parent]`
- include visible children normally
- replace hidden children with their own visible children recursively
- avoid cycles defensively
- preserve deterministic order as much as possible

Ordering question for flattened grandchildren: preserve the hidden block's position, and within that position use the hidden block's child order.

## Phase 6: Update `join()`

Change `join()` to return only a `join-record` op.

It should still compute:

- `left`
- `right`
- `tail` of the current left block content
- `ts`
- `id`

Join id should be stable and actor-created. Use the next Lamport count, similar to split-created blocks.

Suggested signature:

```ts
export const join = (
    state: CachedState,
    left: Lamport,
    right: Lamport,
    ts: string,
    actor: string,
): Op[] => ...
```

The signature can remain unchanged. Internally, use `[state.state.maxSeenCount + 1, actor]` as `join.id`.

Validation:

- left and right blocks must exist
- explicit-deleted blocks should still reject local join creation
- joining an already-active joined-right block should reject at command time
- adjacency should not be checked in `src/block-crdt`

## Phase 7: Tests

Start with focused regression tests in `src/block-crdt/index.test.ts`.

Add:

- reciprocal concurrent join of two sibling blocks converges in both op orders
- reciprocal join leaves exactly one visible root block plus the losing/right block according to lower Lamport winner
- visible text is preserved after the winning join
- losing join has no derived sentinel edge
- three-block cycle resolves by lower Lamport order and remains acyclic
- cycle involving an empty block
- reciprocal join with concurrent insert at start of both joined blocks
- reciprocal join with concurrent split of one joined block
- join conflict plus concurrent `block:move`
- `cachedState(state.state)` reproduces the same cache and serialization

Update existing join tests:

- `represents join with a deleted block sentinel char` should become "derives join sentinel from join record"
- tests that assert `state.state.blocks[rightId].deleted === true` should assert active joined visibility instead
- tests that inspect `state.state.chars[rightId]` should inspect derived cache/helper state

Add formatting tests:

- formatting traversal follows active derived join sentinels
- inactive/lost joins are ignored by formatting traversal
- traversal safety limit is not reached for reciprocal and three-block cycles

Run:

```sh
npm exec vitest src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts
```

Then run broader type/test coverage if the focused tests pass:

```sh
npm run typecheck
npm test
```

## Phase 8: Example and Editor Follow-Through

Search for direct block deletion and block visibility assumptions in `examples/block-rich-text`.

Likely affected areas:

- block list rendering
- block command join helpers
- selection retention over joined blocks
- drag/reorder logic

Replace direct checks of `block.deleted` with exported visibility helpers where needed.

The editor command layer should continue enforcing adjacency for user joins. The CRDT layer should accept non-adjacent join records as valid structural records.

## Phase 9: Defensive Invariants

Add small invariant helpers, preferably test-only at first:

- no active join graph cycles
- no materialized char traversal cycles
- no duplicate ids in `orderedCharIdsForBlock`
- every id in `cache.charContents` resolves to either a stored char or a derived join sentinel
- active joined-right blocks are hidden from visible block listings

If traversal functions can encounter legacy/corrupt cycles, add visited sets and clear error messages instead of relying only on recursion depth.

## Suggested Implementation Order

1. Add types/state fields and `applyJoinRecord`.
2. Implement active join derivation and tests for it.
3. Change `join()` to emit join records.
4. Add derived sentinel support in cache/traversal.
5. Update block visibility helpers.
6. Update existing join tests.
7. Add reciprocal and multi-block cycle tests.
8. Update formatting traversal tests.
9. Fix example/editor call sites.
10. Run focused tests, typecheck, then full tests.

## Main Risks

- Derived sentinels touch many traversal paths that currently assume every char id is stored in `state.chars`.
- Split behavior across joined content may expose unclear semantics.
- Flattening children of hidden blocks can affect block order expectations.
- Existing tests assert concrete `deleted` and `chars[rightId]` internals, so several will need to move to helper-level assertions.
- Making explicit block deletion timestamped may be a broader type churn than the join-cycle fix strictly requires.

