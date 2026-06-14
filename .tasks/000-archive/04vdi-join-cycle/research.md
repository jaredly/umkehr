# Research: Concurrent Join Cycles

## Task

`src/block-crdt` can currently represent a reciprocal join as a cycle:

1. Replica A joins block B into block A.
2. Replica B concurrently joins block A into block B.
3. Both operations arrive everywhere.
4. Both blocks are tombstoned.
5. Each block's sentinel char points into the other block's content tree.

The desired direction is to prevent block/join cycles architecturally, preferably by making conflicting joins resolve deterministically before they can create the cyclic char graph.

## Current Model

Relevant files:

- `src/block-crdt/types.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/utils.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`
- `src/block-crdt/Readme.md`
- `src/block-crdt/notes.md`
- `src/block-crdt/Demos.md`

Blocks and chars share the same Lamport ID space. The initial root block is also the sentinel/root char for that block.

```ts
export type Char = {
    id: Lamport;
    text: string;
    deleted: boolean;
    parent: {
        ts: HLC | [HLC, Lamport[], HLC];
        id: Lamport;
    };
};

export type Block = {
    id: Lamport;
    order: {index: LseqId; ts: HLC; parent: Lamport};
    deleted: boolean;
    // ...
};
```

`join(left, right, ts, actor)` currently emits two ops:

```ts
{
    type: 'char',
    char: {
        id: right,
        text: '',
        deleted: true,
        parent: {id: tailOfLeft, ts},
    },
}

{
    type: 'block:delete',
    id: right,
}
```

That sentinel char is the important part. It keeps the right block's content reachable from the left block after the right block is deleted. This is what preserves concurrent inserts at the start of the joined right block.

Existing tests assert this behavior:

- joins are represented by a deleted sentinel char whose `id` is the joined block ID
- start-of-right-block inserts remain visible after join
- joins converge with concurrent inserts into either side
- joins converge with concurrent splits of either joined block
- chained joins preserve inserted text

The current test property only generates local sequential scripts through the `EditorHarness`, so it does not exercise two replicas creating incompatible join ops from the same base state.

## Why Cycles Happen

For two visible sibling blocks A and B:

- A joins B into A: creates char `B` with parent `tail(A)` and tombstones block B.
- B joins A into B: creates char `A` with parent `tail(B)` and tombstones block A.

After merge, both synthetic chars can be accepted because `applyChar` treats them as ordinary char inserts/updates and resolves parent changes with `laterTs`. `applyBlockDelete` is irreversible and has no timestamp or conflict metadata.

The resulting graph is approximately:

```text
A block/char
  ... A contents ...
  B sentinel char
    ... B contents ...
    A sentinel char
      ...
```

or the reverse, depending on tails and traversal. Since both `Block.deleted` values are true, root block rendering has no visible root to start from. Traversals that include deleted roots can also run into recursive cycles unless they have explicit safety limits.

This is not just a block-order issue. `block:move` can make the UI expose non-adjacent or nested join choices, but the data-level problem is that two joins can both claim the other block as their destination and both tombstones are unconditional.

## Existing Split Ancestry

Splits already use richer move timestamps for incidental char reparenting:

```ts
ts: [lastMoveTs(chars[id].parent.ts), ancestryPath, ts]
```

`laterTs` compares these tuple timestamps differently from plain HLC strings:

1. compare the source/top-level timestamp
2. compare ancestry path
3. compare the new timestamp

This lets an intentional split beat incidental sibling reparenting when concurrent splits overlap. The key idea is that the move operation carries enough provenance to say "this was caused by a split at this ancestry path", not merely "this happened at timestamp X".

Join does not currently carry equivalent provenance. Its sentinel parent is just `{id: tailOfLeft, ts}`, which formatting code also uses as the marker for a "join-style parent":

```ts
typeof char.parent.ts === 'string' && char.parent.ts !== ''
```

That means split ancestry can help conceptually, but the current type has no first-class "join record" or "join cause" to arbitrate two joins.

## Design Options

### Option A: Add Join Records and Resolve Active Joins

Introduce a join record:

```ts
type JoinRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
    tail: Lamport;
    ts: HLC;
};
```

Then a join would emit:

- `join-record`
- sentinel char for `right`
- some representation of deleting `right`

The materialized state would compute an active set of joins from all known join records. If adding a join would make the join graph cyclic, reject the losing join by deterministic ordering. For a two-block reciprocal cycle, choose one winner by `(ts, id)` or Lamport order. Only active joins should tombstone their right block and contribute sentinel parent edges.

This is the cleanest architectural direction because "is this join active?" becomes a derived conflict-resolution question instead of being split across unconditional `char` and `block:delete` ops.

The catch is migration: existing `block:delete` is irreversible. If join records are added without changing delete semantics, the losing join can still leave its right block tombstoned. To make this work fully, join-induced deletion must become distinguishable from user deletion.

### Option B: Make Block Deletion Causal and Reversible for Joins

Change `Block.deleted` from a boolean to a tombstone payload:

```ts
deleted:
    | false
    | {type: 'delete'; ts: HLC}
    | {type: 'join'; joinId: Lamport; ts: HLC};
```

Then conflict resolution can say:

- explicit user deletes remain irreversible or highest-timestamp-wins, depending on intended semantics
- join deletes apply only if their join record is active
- if two joins conflict, the losing join's tombstone is ignored

This can be paired with Option A. Without join records, it still lacks enough global context to prevent cycles before applying sentinel char edges.

### Option C: Encode Join Provenance in Char Parent Timestamps

Extend `Char.parent.ts` with another tuple variant for joins:

```ts
type MoveTs =
    | HLC
    | {type: 'split'; from: HLC; ancestryPath: Lamport[]; ts: HLC}
    | {type: 'join'; joinId: Lamport; left: Lamport; right: Lamport; ts: HLC};
```

Then `applyCharMove` / `applyChar` could compare join moves as explicit conflicts. A reciprocal join can be recognized when:

- char `A` is moved under content reachable from `B`
- char `B` is moved under content reachable from `A`
- both moves are join-style moves

This keeps the conflict local to char parent assignment, which is appealing because cycles are char graph cycles. However, it does not by itself solve the block tombstone half unless block deletion also becomes tied to join provenance.

This option also risks overloading `Char.parent.ts`. The existing tuple is already subtle, and adding a second implicit tuple shape would make `laterTs` harder to reason about. If this path is chosen, replacing the tuple with named objects would be worth doing first.

### Option D: Detect Cycles During Apply and Skip Losing Ops

Before accepting a sentinel char parent update, check whether it would create a char graph cycle. If so, reject that parent update by deterministic ordering.

This is a smaller implementation, but it is probably not sufficient:

- op acceptance may become order-sensitive unless the loser/winner decision uses all competing edges
- the losing join's `block:delete` may already have applied
- pending-op handling would need to know whether "false" means missing dependency or conflict skip
- cache updates assume parent pointers are already acyclic

This is better as a defensive invariant check than as the main architecture.

## Recommended Direction

Use explicit join records and make join-induced block deletion derived from active joins.

Concretely:

1. Add `JoinRecord` to state and an `Op` variant.
2. Have `join()` emit a `join-record` instead of treating the sentinel char and block delete as independent facts.
3. Distinguish join tombstones from explicit block deletes, either in `Block.deleted` or in a separate derived helper.
4. Derive active joins by sorting all join records deterministically and accepting only records whose `right -> left` edge does not create a cycle in the accepted join graph.
5. Materialize block visibility from active joins plus explicit deletes.
6. Materialize sentinel char parent edges only for active joins, or teach cache construction to ignore inactive join sentinel edges.
7. Keep a defensive cycle check in traversal code so corrupted or legacy states fail gracefully.

This makes reciprocal joins explicit conflicts. One join wins everywhere, the losing join is skipped everywhere, and only the losing join's right block remains visible as a separate block.

For the two-block case:

```text
join(A <- B) id 10
join(B <- A) id 11
```

If lower Lamport wins, `join(A <- B)` is active. B is tombstoned into A. A remains visible. `join(B <- A)` is inactive, so A is not tombstoned into B.

## Important Tests to Add

- reciprocal concurrent join of two sibling blocks converges in both op orders
- only one of the two blocks is tombstoned by reciprocal joins
- visible text is preserved after the winning join
- the losing join does not leave a dangling sentinel edge
- three-block join cycle, e.g. `A <- B`, `B <- C`, `C <- A`
- join cycle involving an empty block
- join cycle with concurrent insert at the start of both joined blocks
- join cycle with concurrent split of one joined block
- join cycle with `block:move` changing root/nesting position concurrently
- formatting traversal over a state that includes inactive/lost joins does not exceed safety limits
- legacy state with a raw cycle is either repaired or rendered with a bounded fallback

## Open Questions

- Should explicit user block deletion remain irreversible, or should it also become timestamped and causally resolved?
    - it can be timestamped
- Is a join always a deletion of the right block, or should "right block visibility" be a derived view over active join records?
    - it probably should be a derived view
- Should sentinel chars for joins be stored as ordinary chars, or should they be derived from join records at cache/materialization time?
    - they should be derived from join records at cache/materialization time, so as to avoid denormalization
- What deterministic winner should be used for conflicting joins: lower Lamport join id, higher Lamport join id, HLC timestamp, or a semantic rule such as preserving the lower/root-most block?
    - whichever matches split semantics best. I think lower lamport id
- Do joins need to require adjacency at the CRDT layer, or is adjacency only an editor command constraint?
    - adjacency is only an editor command constraint
- How should `block:move` interact with join records if a block is moved under a block that later becomes joined/deleted?
    - deleted block children are rendered as children of the deleted block's parent
- What should happen to metadata changes on a block that loses a join conflict and remains visible?
    - metadata changes are not propagated to the join winner anyway
- How should old persisted documents with boolean `deleted` and raw sentinel chars migrate into a join-record model?
    - don't worry about old persisted documents, we have none. no migration needed
- Should `laterTs` be refactored into named timestamp variants before adding join provenance?
    - we're going with a join record right? so would laterTs be impacted?
- Should cycle prevention happen at write time, apply time, materialization time, or all three with different responsibilities?
    - seems like materialization time
