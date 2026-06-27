# Research: Reversible Deletion for Block CRDT Tombstones

## Question

`src/block-crdt` currently represents character and block deletion as a monotone tombstone:

```ts
deleted: boolean
```

Once a `char:delete` or `block:delete` op is applied, the record remains in state but cannot become visible again. Undo therefore has to create replacement characters or blocks with fresh Lamport ids. That preserves visible text, but loses identity: marks, retained selections, block metadata, block style, block order, later char moves, and concurrent edits attached to the original id do not automatically come back with the undo.

The proposed alternative is to make visibility a last-writer-wins field:

```ts
deleted?: {value: boolean; ts: HLC}
```

with `undefined` meaning visible. Delete writes `{value: true, ts}`, restore writes `{value: false, ts}`.

The goal is better undo behavior, especially when remote edits arrive while a local deletion is being undone.

## Sources Consulted

Local implementation and tests:

- `src/block-crdt/types.ts`
- `src/block-crdt/apply.ts`
- `src/block-crdt/changes.ts`
- `src/block-crdt/undo.ts`
- `src/block-crdt/cache.ts`
- `src/block-crdt/traversal.ts`
- `src/block-crdt/joins.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`
- `src/block-crdt/adapter-additions.test.ts`
- `src/block-crdt/Readme.md`
- `src/block-crdt/LitReview.md`

Background references already captured in `src/block-crdt/LitReview.md`:

- Litt, Hardenberg, Kleppmann, "Peritext: A CRDT for Collaborative Rich Text Editing": <https://www.inkandswitch.com/peritext/static/cambridge.pdf>
- Shapiro et al., "A comprehensive study of Convergent and Commutative Replicated Data Types": <https://inria.hal.science/inria-00555588/document>
- Kleppmann, "A highly-available move operation for replicated trees": <https://martin.kleppmann.com/papers/move-op.pdf>
- Kleppmann et al., "Moving Elements in List CRDTs": <https://martin.kleppmann.com/papers/list-move-papoc20.pdf>

## Current Implementation

Relevant files:

- `src/block-crdt/types.ts`
- `src/block-crdt/apply.ts`
- `src/block-crdt/changes.ts`
- `src/block-crdt/undo.ts`
- `src/block-crdt/cache.ts`
- `src/block-crdt/traversal.ts`
- `src/block-crdt/joins.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`
- `src/block-crdt/adapter-additions.test.ts`

Current record shapes:

```ts
export type Char = {
    id: Lamport;
    text: string;
    deleted: boolean;
    parent: {ts: CharParentTs; id: Lamport};
};

export type Block<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    id: Lamport;
    meta: M;
    style: BlockStyle;
    order: BlockOrder;
    deleted: boolean;
};
```

Current delete ops:

```ts
| {type: 'char:delete'; id: Lamport}
| {type: 'block:delete'; id: Lamport}
```

`applyCharDelete` and `applyBlockDelete` only flip `deleted` from `false` to `true`. Reapplying the same delete is idempotent. Later `char` or `block` reinserts with the same id cannot restore visibility; `applyChar` keeps the current `deleted` value and `applyBlock` merges with `current.deleted || block.deleted`.

Undo works around that:

- Undoing inserted chars emits `char:delete`.
- Undoing deleted chars emits fresh replacement `char` ops.
- Undoing deleted blocks emits a fresh replacement `block` plus copied visible text.
- Undoing joins emits a fresh replacement block plus `char:move` ops from the joined stream.

Some current tests explicitly document this:

- `plans undo for deleted chars by inserting fresh replacement chars`
- `plans undo for block delete by creating a fresh visible block with copied text`
- `plans undo for join as a split-style move without recreating or deleting chars`

## Why Tombstones Are Common In Text CRDTs

The key reason is not that a character must be impossible to restore. It is that the character's identity must remain available after deletion.

In sequence/rich-text CRDTs, deleted elements are often retained because later and concurrent operations may still reference them:

- A later insert may use a deleted character as its parent/predecessor.
- A mark boundary may anchor to a deleted character.
- A selection or cursor retention model may resolve through deleted characters.
- Out-of-order delivery may apply a delete before an operation that references the deleted element.
- A split/join traversal may need the deleted character as part of the logical tree shape.

This repo does use tombstones that way. `orderedCharIdsForBlock(state, blockId)` scans deleted chars, `orderedCharIdsForBlock(..., {visibleOnly: true})` filters them out, `charToString` traverses through deleted chars while rendering no text for the deleted char itself, and formatting tests assert that deleted chars still preserve mark anchors.

So the Peritext/RGA-style reason for tombstones still applies here: do not physically remove records if other durable operations can refer to their ids. But that does not require delete to be a grow-only boolean. A reversible LWW visibility register can still keep the record and its identity.

## Convergence Analysis

An LWW delete field can be a CRDT-compatible register if the merge rule is deterministic and applied independently of delivery order.

Proposed value:

```ts
type DeletedField = {value: boolean; ts: HLC};
type Deleted = DeletedField | undefined;
```

Visibility:

```ts
const isDeleted = (deleted?: DeletedField) => deleted?.value === true;
```

Merge rule:

```ts
const deletedWins = (incoming, current) =>
    !current || incoming.ts > current.ts;
```

This assumes the package's HLC strings already encode actor/session identity and therefore form a total order for concurrent writes. Under that assumption, no extra actor field or value tie-break is needed in the deletion field.

The proposed durable shape is sufficient:

```ts
deleted?: {value: boolean; ts: HLC}
```

Given that total HLC order, convergence should hold for:

- delete delivered before restore,
- restore delivered before delete,
- duplicate delete/restore,
- old `char` or `block` insert replayed after newer delete/restore,
- delete/restore concurrent with char parent moves,
- delete/restore concurrent with block moves, metadata changes, style changes, and marks.

The field would behave like the existing LWW-ish fields:

- char parent uses `charParentVersionWins`,
- block order uses `blockOrderVersionWins`,
- block meta uses `meta.ts`,
- block style values use per-key `{value, ts}`.

## Expected Benefits

### Character deletion undo

Today:

1. `abc`
2. Alice deletes `b`
3. Bob concurrently inserts `X` after `b`
4. Alice undoes the delete

With current tombstone undo, Alice creates a fresh `b` replacement. Bob's `X` remains attached to the original tombstoned `b`, so restoring the visible text requires careful reconstruction and may not preserve all anchors.

With reversible deletion, Alice emits a newer restore for original `b`. Bob's insert already references original `b`, so the restored text stream naturally becomes `abXc` or equivalent according to existing char-tree ordering.

This is the strongest argument for the change.

### Marks and selections

Restoring the same char id keeps mark boundaries and retained selections meaningful. Current undo has explicit mark remapping logic for replacement chars, but replacement can only cover cases the planner understands. Keeping identity should make the common case simpler and more correct.

### Block deletion undo

Restoring the same block id preserves:

- block metadata,
- block style,
- block order/path,
- child blocks,
- chars rooted in the block,
- retained block selections and visible paths,
- concurrent moves/metadata/style edits that targeted the deleted block.

This is likely a major improvement over creating a fresh replacement block with copied visible text.

## Main Risks

### 1. Last writer wins is not semantic undo

LWW restore means "make visible as of this timestamp," not "invert my delete and preserve everybody else's intent."

If Alice deletes a char at `t10`, Bob intentionally deletes the same char at `t20`, and Alice later undoes her delete at `t30`, LWW makes the char visible again. That may surprise Bob: Alice did not explicitly undo Bob's delete, but her later restore wins.

This is the same familiar problem as LWW registers generally. It may be acceptable for local undo because the user expects their undo to restore what they removed, but in collaborative settings it can violate another user's later delete intent.

A more intention-preserving alternative is a per-actor observed-remove or enable/disable set:

```ts
deletes: Record<actorOrOpId, true>
restores: Record<deleteOpId, true>
```

or an undo op that specifically cancels one delete op. That is heavier, but avoids a later restore blindly overwriting another actor's later delete.

### 2. Visibility ops must use real HLCs

The proposed shape relies on `ts` being a fully ordered HLC string, including actor/session identity. That is fine if all visibility ops are produced through the same timestamp discipline as other HLC-based fields.

The implementation should still avoid accepting ad hoc timestamp strings from callers that do not follow that format. If invalid or non-unique HLCs can be constructed externally, delete-vs-restore convergence would become under-specified.

### 3. Join is not block deletion in this implementation

`joinBlocksOps` does not emit `block:delete`. It emits a durable `join-record`.

`organizeState` derives:

- `cache.joinSentinels[rightBlockId] = join`
- `cache.joinedBlocks[rightBlockId] = join`
- a synthetic deleted char record for the joined right block id

Visible traversal hides joined blocks independently of `block.deleted`:

```ts
!block.deleted && !state.cache.joinedBlocks[id]
```

Changing `Block.deleted` to LWW does not make joins undoable. Undoing a join while preserving identity needs a reversible join record, for example:

```ts
type JoinRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
    tail: Lamport;
    ts: HLC;
    deleted?: {value: boolean; ts: HLC};
};
```

or a separate `join:set-active` op keyed by join id.

This is more subtle than block/char delete because `activeJoinRecords` also resolves competing joins and join cycles. A restored/unjoined join should be excluded from the active-join graph before cycle/right-block conflict resolution.

### 4. Restoring hidden descendants can be surprising

Block deletion currently has documented `block-only` behavior: deleting a block hides that block's own content but visible descendants are spliced into the nearest visible ancestor.

If a block is restored later, descendants may move visually back under the restored parent. That is probably correct for identity-preserving undo, but it is a visible structural jump. Tests should pin this behavior.

Subtree delete is trickier. `deleteBlockOps(..., {mode: 'subtree'})` currently emits separate `block:delete` ops for the target and each currently visible descendant. Undoing the original subtree delete with LWW restores every targeted block only if the undo planner emits restore ops for all of them. Restoring only the parent will leave descendants hidden.

### 5. Old stale delete ops become meaningful

With monotone tombstones, a duplicate or stale delete is harmless because all deletes collapse to `true`. With LWW status, every delete must carry an HLC timestamp and stale deletes must be ignored.

That means `char:delete` and `block:delete` need new op payloads:

```ts
| {type: 'char:delete'; id: Lamport; deleted: {value: true; ts: HLC}}
| {type: 'char:restore'; id: Lamport; deleted: {value: false; ts: HLC}}
| {type: 'block:delete'; id: Lamport; deleted: {value: true; ts: HLC}}
| {type: 'block:restore'; id: Lamport; deleted: {value: false; ts: HLC}}
```

or one shared op:

```ts
| {type: 'char:visibility'; id: Lamport; deleted: {value: boolean; ts: HLC}}
| {type: 'block:visibility'; id: Lamport; deleted: {value: boolean; ts: HLC}}
```

Given no backwards-compatibility requirement, replacing the old delete ops is cleaner than overloading timestamp-less deletes.

### 6. Initial records need no delete timestamp

The proposed `undefined` default works. It means existing visible records do not pay the memory cost until the first delete/restore.

Newly inserted chars/blocks can omit `deleted`. Existing code that checks `char.deleted` or `block.deleted` should move through an `isDeleted(record)` helper to avoid truthiness mistakes and make future compaction easier.

## Recommended Direction

The reversible field is viable for chars and explicit block deletes if it is implemented as a proper LWW register over the package's total-order HLC strings.

I would not shelve the idea on CRDT correctness grounds. It can preserve convergence with a deterministic merge rule. The bigger concern is collaborative intent: a late undo/restore can override another user's delete. That is user-visible and should be accepted deliberately.

Recommended shape:

```ts
export type Visibility = {
    deleted: boolean;
    ts: HLC;
};

export type Char = {
    id: Lamport;
    text: string;
    visibility?: Visibility;
    parent: {ts: CharParentTs; id: Lamport};
};

export type Block<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    id: Lamport;
    meta: M;
    style: BlockStyle;
    order: BlockOrder;
    visibility?: Visibility;
};
```

I would name the field `visibility` or `deletedState` rather than keeping `deleted` as an object. `record.deleted` currently reads as a boolean throughout the codebase; changing it to object-or-undefined makes accidental boolean checks easy to miss. If the field stays named `deleted`, use helper functions aggressively.

Recommended ops:

```ts
| {type: 'char:visibility'; id: Lamport; visibility: Visibility}
| {type: 'block:visibility'; id: Lamport; visibility: Visibility}
```

with helpers:

```ts
deleteRangeOps(..., ts, actor) -> char:visibility deleted=true
restoreCharOps(..., ts, actor) -> char:visibility deleted=false
deleteBlockOps(..., ts, actor) -> block:visibility deleted=true
restoreBlockOps(..., ts, actor) -> block:visibility deleted=false
```

Merge:

```ts
incoming.ts > current.ts
```

No separate tie-break is needed because HLC strings encode actor/session identity.

## Join Recommendation

Do not treat reversible block deletion as sufficient for join undo.

If the goal includes undoing joins while retaining the right block id, add reversible activation to joins:

```ts
export type JoinRecord = {
    id: Lamport;
    left: Lamport;
    right: Lamport;
    tail: Lamport;
    ts: HLC;
    visibility?: Visibility; // deleted=true means inactive/unjoined
};
```

Then:

- `join-record` inserts an active immutable join record.
- `join:visibility` toggles one join record active/inactive.
- `activeJoinRecords` filters inactive joins first, then resolves one active join per right block and rejects cycles.
- Undoing a join emits `join:visibility` with `deleted=true`.
- Redoing that undo emits `join:visibility` with `deleted=false`.

Open design issue: if two joins target the same right block and the winning join is later deactivated, should the previously losing join become active? The current `activeJoinRecords` algorithm would naturally allow that if filtering happens before conflict resolution. That is convergent, but user-visible. It may be desirable because the losing join was a valid concurrent intent; it may also be surprising because undoing one join can reveal another.

## Test Cases Needed

Before implementing broadly, add tests for these scenarios:

1. Character delete/restore converges in both op orders.
2. Character restore preserves concurrent insert attached to deleted char.
3. Character restore preserves mark boundary anchored to deleted char.
4. Stale character delete does not hide a newer restored char.
5. Concurrent delete and restore with distinct actor/session HLCs converges.
6. Block delete/restore converges in both op orders.
7. Block restore preserves concurrent block move.
8. Block restore preserves concurrent metadata and style changes.
9. Block-only delete restore causes descendants to move back under the restored block.
10. Subtree delete undo restores all targeted blocks, not only the root.
11. Restore of a block that was concurrently joined remains hidden if an active join still hides it.
12. Join deactivate/reactivate converges in both op orders.
13. Deactivating a winning join either does or does not reveal a previously losing join; whichever behavior is chosen must be pinned.
14. `applyRemote` reports pending when a visibility op references a missing char/block/join id.
15. Cache consistency after every visibility op.
16. Formatting materialization after delete/restore still follows split and join records.
17. Retained selections resolve across delete/restore without replacement ids.

## Open Questions

- Should restore be a plain LWW write, or should it specifically undo one delete op? LWW is simpler but can override another user's later delete.
    - LWW. I'm find with overriding other users deletes
- Should the library validate that visibility op timestamps are well-formed package HLC strings?
    - not unless we validate other HLC strings
- Should the field be named `deleted`, `visibility`, or `presence`? A non-boolean `deleted` field is easy to misuse.
    - deleted
- Should delete helpers require `actor` and `ts` now? Today `deleteRangeOps` and `deleteBlockOps` do not need a timestamp.
    - just ts
- For subtree delete undo, should the undo planner restore exactly the blocks deleted by the original op batch, or restore all currently hidden descendants that were visible before?
    - it should undo the change that was made. only those deleted by the ops
- For joins, should deactivating a winning join allow another concurrent join for the same right block to become active?
    - let's wait on joins actually
- Should an inactive join record continue to act as a dependency/anchor for mark traversal or retained selection resolution, or should it be ignored everywhere except history?
    - let's wait on joins
- Is there a future compaction model? Reversible deletion keeps identity but makes physical GC harder because a future restore may make any tombstone visible again.
    - we will have a compaction story, but not yet
- How should UI communicate "undo restored a thing another user deleted later" if that case is allowed?
    - don't worry about it. we'll have separate mechanisms for communicating out-of-sync changes

## Bottom Line

Reversible LWW deletion is compatible with CRDT convergence for characters and explicit block deletion if the visibility field uses the package's total-order HLC timestamp. It would materially improve undo because restored chars/blocks keep their original identity and therefore retain concurrent edits, marks, selections, metadata, and structure.

The design does not automatically solve join undo. Joins are currently a separate immutable relation, so they need their own reversible active/inactive state.

The main product tradeoff is semantic, not mathematical: LWW restore can override another user's later delete. If that behavior is acceptable, this is a reasonable direction. If undo must only cancel the user's own delete while preserving other delete intents, use an observed-delete/restore design instead of a single LWW register.
