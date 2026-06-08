# Ideas: Join Losing Concurrent Start-of-Block Inserts

## Problem Summary

Joining block B into block A archives B and moves B's current root characters under A's tail. If another replica concurrently inserts text at the start of B, that inserted text is parented directly to B's block id.

When the join op is applied before the insert op, the join cannot see the new root character, so it does not emit a `char:move` for it. The later insert is then attached to the archived block B. Since archived blocks are omitted from visible block output, the inserted text appears lost.

The failing repro is in `src/block-crdt/index.test.ts`:

```ts
join(leftBlock, rightBlock) || insert(rightBlock, 0, 'X') => ['abcd'], expected ['abXcd']
```

The central issue is that `join` currently behaves like a one-time reparenting of the right block's existing roots. It does not encode a durable relationship saying "future or unseen children of this archived block should now belong at this join position."

## Avenue 1: Redirect Root Insertions Under Joined Blocks During Apply

Teach `applyChar` to detect when a new character's parent is an archived block that has been joined into another block, and rewrite the parent to the surviving block or join tail.

This likely needs extra join metadata because the current archive status alone says only that the block is hidden. It does not say which block absorbed it or where its children should land.

Possible shape:

```ts
type BlockStatus = {
    archived: boolean;
    ts: HLC;
    joinedInto?: Lamport;
    joinAfter?: Lamport;
};
```

Then `join` could set `joinedInto` and `joinAfter`, and `applyChar` could redirect chars parented to the archived right block.

Pros:

- Directly handles operations arriving after the join.
- Keeps the visible materialization model simple once redirected.
- Makes the join intent explicit in persisted state.

Cons:

- Changes the public CRDT state shape.
- Needs careful timestamp conflict handling with unarchive/status changes.
- `joinAfter` must remain meaningful if the left tail is later deleted or moved.
- Redirecting only direct block children is not enough if there are nested descendants under concurrently inserted roots.

## Avenue 2: Add a Join Record / Block Alias Table

Instead of extending `Block.status`, add a separate immutable join record:

```ts
type JoinRecord = {
    id: Lamport;
    from: Lamport;
    into: Lamport;
    after: Lamport;
    ts: HLC;
};
```

`join` would emit the existing moves plus a `join-record`. When a char arrives with parent `from`, apply/materialization can route it through the join record.

Pros:

- Avoids overloading block archive status.
- Immutable records are usually easier to merge than mutable status fields.
- Can support historical reasoning: "block B was joined into block A at this position."
- Similar in spirit to the existing `split-record` concept.

Cons:

- Requires new state, op, cache, validation, import/export considerations.
- Multiple joins involving the same block need deterministic resolution.
- Materialization and selection code would need to understand archived block aliases.

## Avenue 3: Resolve Joined-Block Roots During Materialization

Leave operations as-is, but change traversal so children of an archived joined block are rendered at the join site of the surviving block.

This would mean preserving enough information to know where an archived block's root children should be spliced into the visible tree. That could be a join record, or it could be inferred from moved right-block roots.

Pros:

- Avoids mutating late-arriving chars.
- Keeps causality explicit: the char really was inserted into B, and B's contents are displayed through the join.
- May handle both operation orders uniformly if traversal has a complete alias map.

Cons:

- Inference from existing moves may be fragile, especially for empty right blocks or concurrent root insertions before the first moved root.
- More complex cache/materialization logic.
- Any code that directly reads `cache.charContents[blockId]` may miss aliased content unless it goes through a new traversal API.

## Avenue 4: Make Join a Structural Block Move Instead of Char Moves

Represent join as "right block remains structurally attached to left block's text flow" rather than moving all current characters out of the right block. The right block would be archived for UI block display, but its text children would still participate in the left block's inline content.

Pros:

- Concurrent inserts into the joined block naturally stay with that block and remain visible through the structural join.
- Avoids one-time catch-up moves for unseen characters.
- Better models join as a durable relation between blocks.

Cons:

- Larger conceptual change to the block CRDT.
- `blockContents`, formatting, selection, split, and future joins would all need to understand inline child blocks.
- Could make block order and inline character order interact in subtle ways.

## Avenue 5: Emit a Move for the Right Block Sentinel

Treat the block id as a sentinel parent that can itself be moved or aliased. Instead of only moving right block root chars, `join` would somehow move the right block's text root under the left tail. Future chars inserted after the right block sentinel would then be ordered at the joined location.

Pros:

- Targets the exact gap: chars inserted at offset 0 use the block id as their parent.
- Could preserve the existing character-tree traversal if block sentinels become valid inline parents.

Cons:

- The current model separates blocks and chars; block ids can be parents, but blocks are not chars with parents.
- Would require substantial changes to traversal and parent comparison rules.
- Needs a clear answer for whether the archived block sentinel renders, redirects, or only groups children.

## Avenue 6: Repair on Join Receipt by Scanning Archived Block Children

When applying `block:status archived` for a join, scan the archived block for children and move or display any remaining visible chars through the surviving block.

Pros:

- Could be a smaller implementation if join metadata is available.
- Handles cases where insert arrives before the archive status but after the explicit char moves.

Cons:

- Current `block:status` does not know whether the archive came from a join or a user hide/delete action.
- It also does not know the surviving block/tail.
- If the insert arrives after the archive status, a one-time scan has already missed it.
- This is likely only a partial fix unless combined with a durable redirect/alias.

## Recommended Direction

The durable fix probably needs an explicit join relation, not just extra `char:move` ops. The bug exists because the operation batch can only move characters that are visible to the joining replica at that moment. Any correct fix has to preserve the intent for characters that arrive later.

The most promising direction is Avenue 2: add a join record / block alias table, then route direct root children of the joined block through that relation during traversal or apply. This matches the existing `split-record` style better than making archive status carry semantic payload, and it leaves room for selection retention and formatting code to ask "where does this historical block resolve now?"

Short-term implementation sketch:

1. Add `joins: Record<string, JoinRecord>` to block CRDT state.
2. Add an op like `{type: 'join-record'; join: JoinRecord}` emitted by `join`.
3. Record `from = rightBlock`, `into = leftBlock`, and `after = tailBeforeFirstRightRoot`.
4. Update character traversal for a visible block to include direct children of joined blocks at the recorded join location.
5. Keep the existing explicit `char:move` ops initially, then decide whether they become redundant once traversal understands joins.
6. Add tests for both op orders:
   - join then insert at offset 0 of right block
   - insert at offset 0 of right block then join
7. Add follow-up tests for empty right block, multiple chars inserted at offset 0, and chained joins.

The key design question is whether to normalize late-arriving chars by rewriting their parent on apply, or to preserve original parents and resolve aliases during traversal. Preserving original parents seems safer for CRDT semantics, but it requires all readers to use the same traversal API.

## Decision:

Let's go with a variant of avenue 4, where we actually create a `char` with the same id as the right block, which then assumes the role of parent to the block's children. To avoid future issues, block archiving needs to become irreversible, just as char deletion currently is. So instead of a `status`, blocks would just have a `deleted` boolean.
This new `char` would itself be tombstoned (to avoid adding an extra rendered character to the output) and could have contents either be an empty string or a space (doesn't matter, as it will never be rendered).
