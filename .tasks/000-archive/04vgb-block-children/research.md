# Research: Block Rich Text Children

## Goal

Add block nesting to `examples/block-rich-text`.

The first UI surface should be keyboard-only:

- `Tab` at the start of a block indents that block.
- `Shift+Tab` at the start of a nested block unindents that block.
- Unindenting a block with following siblings should make those following siblings children of the unindented block.

The concurrency requirement is the important part. Incidental reparenting during unindent should behave like split's incidental character reparenting: if siblings are `A B C D`, one replica unindents `B`, and another replica concurrently unindents `C`, then `D` should converge as a child of `C`, not `B`, because `B` sorted before `C` at the time each incidental reparent happened.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/style.css`
- `src/block-crdt/types.ts`
- `src/block-crdt/index.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/lseq.ts`
- `src/block-crdt/utils.ts`
- `src/block-crdt/Readme.md`

The block CRDT already has parented block order:

```ts
export type Block = {
    id: Lamport;
    order: {index: LseqId; ts: HLC; parent: Lamport};
    deleted: boolean;
    // ...
};
```

`organizeState()` builds `cache.blockChildren` by `block.order.parent` and sorts siblings by `block.order.index`.

`stateToString()` already renders nested block children recursively. `visibleBlockChildren()` can also traverse through invisible joined/deleted blocks so their children do not disappear.

However, the block-rich-text app is mostly root-only today:

- `App.tsx` renders `materializeFormattedBlocks(replica.state)`, and `materializeFormattedBlocks()` maps only `rootBlockIds(state)`.
- `selectionModel.ts`, `retainedSelection.ts`, `selectionSet.ts`, and `wordOccurrences.ts` use `rootBlockIds(state)` as the document order.
- `moveBlock()` in `blockCommands.ts` always creates `block:move` with `parent: ROOT`.
- `joinWithPrevious()` and `joinWithNext()` use root block order only.
- Drag/drop reorder is root-only.

So the storage model can represent children, but the example needs a visible outline order and commands that understand sibling/parent relationships.

## Existing Incidental Reparenting Pattern

`split()` already handles concurrent split intent by encoding incidental char moves with richer timestamps:

```ts
parent: {
    ts: [lastMoveTs(chars[id].parent.ts), ancestryPath, ts],
    id: tail,
}
```

`laterTs()` treats tuple timestamps differently from plain strings:

1. compare the previous/source move timestamp;
2. compare the ancestry path;
3. compare the new timestamp.

This makes an intentional split move beat incidental sibling reparenting and lets overlapping concurrent splits converge by logical split position, not by last writer alone.

Blocks do not have an equivalent today. `Block.order.ts` is just `HLC`, and `applyBlockMove()` accepts a block move when `laterTs(op.order.ts, current.order.ts)` returns true. TypeScript allows this call because `laterTs()` is structurally compatible enough, but the declared `Block.order.ts` type does not allow tuple-style provenance.

## Recommended Model

Extend block order timestamps with a block-specific incidental move timestamp.

Suggested type direction:

```ts
type IncidentalBlockOrderTs = [HLC, LseqId[], HLC];

type BlockOrderTs = HLC | IncidentalBlockOrderTs;

type Block = {
    // ...
    order: {index: LseqId; ts: BlockOrderTs; parent: Lamport};
};
```

The exact tuple payload can be adjusted, but it should encode:

- the prior effective order timestamp of the reparented sibling;
- the source sibling path/order that caused the incidental reparent;
- the new local timestamp.

For the task's `A B C D` case, the incidental reparent caused by unindenting `B` must sort before the incidental reparent caused by unindenting `C`, even if the wall-clock/local HLC ordering is the opposite. Using the unindented block's source `order.index` as the path component is the key property.

The comparison helper should probably stop being named/typed as char-only. A shared helper could compare:

```ts
type MoveTs<Path> = HLC | [HLC, Path[], HLC];
```

or two explicit helpers could be introduced:

- `laterCharParentTs(...)`
- `laterBlockOrderTs(...)`

Keeping the comparison generic but typed would make the block behavior easier to test and less accidental.

## Commands

Add command helpers in `examples/block-rich-text/src/blockCommands.ts`:

```ts
export const indentBlock = (
    state: CachedState,
    blockId: string,
    context: CommandContext,
): CommandResult

export const unindentBlock = (
    state: CachedState,
    blockId: string,
    context: CommandContext,
): CommandResult
```

Indent behavior:

- only run when the live primary selection is a caret at offset `0`;
- find the block's previous visible sibling under the same parent;
- if there is no previous sibling, no-op;
- move the block under that previous sibling;
- place it after the previous sibling's existing children using `createLseqIdBetween(lastChild.order.index, null, ...)`;
- preserve the block's own children.

Unindent behavior:

- only run when the live primary selection is a caret at offset `0`;
- if the block's parent is root, no-op;
- move the block to its grandparent, immediately after its current parent;
- find following visible siblings in the old parent after the unindented block;
- move each following sibling under the unindented block with an incidental `order.ts`;
- preserve those siblings' relative `order.index` values if possible.

The resulting op batch is one intentional `block:move` for the selected block plus zero or more incidental `block:move` ops for following siblings.

Selection can remain a caret at `{blockId, offset: 0}`.

## Rendering And Document Order

The app needs an outline traversal that includes nested visible blocks. `materializeFormattedBlocks()` currently returns only visible root blocks.

Possible approach:

```ts
type FormattedBlock = {
    id: string;
    block: Block;
    runs: FormattedRun[];
    depth: number;
    parentId: string;
};
```

Then add a new exported traversal/materializer such as:

- `visibleBlockOutline(state): Array<{id: string; depth: number}>`
- `materializeFormattedBlockOutline(state): FormattedBlock[]`

The example can render the flat outline with depth-based indentation. This is simpler than rendering nested React subtrees because selection, keyboard navigation, and drag registration already expect a flat list.

Selection helpers should use the same outline order instead of `rootBlockIds(state)`, otherwise multi-block selections, retained selection fallback, word occurrence scanning, and arrow-left/right block transitions will ignore nested blocks.

## Join/Delete Semantics

`joinWithPrevious()` and `joinWithNext()` should use visible outline order, not root order, if nested blocks are user-visible.

Open behavior to decide:

- Backspace at the start of a child after another child should join with the previous visible block.
- Backspace at the start of the first child could join with its parent, or no-op to avoid surprising structure changes.
- Delete at the end of a parent could join with its first child, or no-op.

For a first pass, it may be safer to keep join constrained to adjacent blocks with the same parent and add tests documenting that cross-depth joins are no-ops. The task only asks for Tab/Shift+Tab.

## Drag/Reorder

Drag reorder currently accepts a root `blockIds` list and emits a root `block:move`.

This task does not require nested drag/drop. The least risky first implementation is:

- render nested blocks;
- keep drag handles functional only for root-level moves, or disable drag for nested blocks;
- leave nested drag/drop to a follow-up.

If drag remains enabled for all rendered blocks without being made hierarchy-aware, it will flatten nested blocks back to root because `moveBlock()` writes `parent: ROOT`.

## Test Plan

Core CRDT tests in `src/block-crdt/index.test.ts`:

- applying a `block:move` can move a block under another block and update `cache.blockChildren`;
- incidental block order timestamps compare deterministically;
- concurrent unindent of `B` and `C` from `A B C D` converges with `D` under `C` in both application orders;
- intentional block move beats prior incidental reparenting when appropriate;
- cache remains equal to `organizeState(...)` after nested moves.

Example command tests in `examples/block-rich-text/src/blockCommands.test.ts`:

- `indentBlock()` indents a block under its previous sibling;
- `indentBlock()` no-ops for the first sibling;
- `unindentBlock()` moves a child after its parent;
- `unindentBlock()` reparents following siblings under the unindented block;
- unindent at root no-ops;
- command selection remains on the moved block.

Example UI tests in `examples/block-rich-text/src/App.test.tsx`:

- pressing `Tab` at offset `0` indents;
- pressing `Shift+Tab` at offset `0` unindents;
- pressing `Tab` away from offset `0` allows normal text editing behavior or is prevented consistently;
- nested blocks render with visible indentation;
- root-only drag does not flatten nested blocks unexpectedly.

Selection tests:

- multi-block range normalization follows visible outline order, including children;
- retained selection resolves inside nested blocks after remote indent/unindent;
- arrow-left/right navigation crosses nested blocks in outline order.

## Open Questions

1. Should `Tab` be intercepted only for a collapsed caret at offset `0`, or should a range starting at offset `0` also indent all selected blocks?
    - only collapsed
2. Should nested drag/drop be disabled for now, or should drag targets become hierarchy-aware in the same task?
    - disabled for now
3. Should joins operate across visible outline adjacency, or only among siblings with the same parent?
    - visible adjacency
4. What exact provenance shape should `Block.order.ts` use: a tuple with `LseqId[]`, a named object, or a more generic move timestamp type shared with char parents?
    - a tuple with lseqid sounds right, although I don't think we need the full list. just the lseqid of the unindenting block should suffice
5. When unindenting and moving following siblings under the unindented block, should their existing `order.index` values be preserved exactly, or should they be reminted inside the new parent? Preserving them seems best for the task's concurrency rule.
    - preserve
6. Should public `materializeFormattedBlocks()` change to include descendants, or should a new outline-specific materializer be added to avoid breaking existing tests and callers?
    - let's change it
7. Should indentation depth have a max limit in the example UI?
    - no
8. How should children of joined/deleted nested blocks be displayed if the invisible parent is not root? The current `visibleBlockChildren(parent)` can traverse through invisible children, but a new outline traversal needs to preserve the intended depth.
    - if a parent is deleted, children are displayed as spliced into the grandeparent's children in place of the parent

## Recommended Implementation Order

1. Add typed block order timestamp comparison and tests.
2. Add a visible block outline traversal/materializer without changing existing `rootBlockIds()` behavior.
3. Implement `indentBlock()` and `unindentBlock()` command helpers.
4. Wire `Tab` / `Shift+Tab` in `EditableBlock.onKeyDown`, gated to caret-at-start.
5. Update selection/document-order helpers to use visible outline order where the app needs all visible blocks.
6. Add CSS depth indentation and decide the drag behavior for nested rows.
7. Add the concurrent unindent test before polishing UI details.
