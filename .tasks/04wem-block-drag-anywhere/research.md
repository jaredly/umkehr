# Research: Block Drag Anywhere

## Goal

Update `examples/block-rich-text` so drag and drop works for nested blocks, not only root blocks. Any visible block should be draggable to any valid outline position, including becoming the first child of a block that currently has no children. Dragging a parent should move its whole subtree.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/useBlockReorder.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/style.css`
- `src/block-crdt/index.ts`
- `src/block-crdt/utils.ts`

The editor already renders nested blocks in a flat pre-order list:

```ts
const blocks = materializeFormattedBlocks(replica.state);
```

Each `FormattedBlock` includes `id`, `depth`, and `parentId`. The UI indents rows with `--block-depth`, so nested rows are already visible. The drag handle is deliberately disabled for nested blocks:

```tsx
canDrag={block.depth === 0}
```

The current drag hook is root-only:

```ts
export type DropTarget = {targetBlockId: string; after: boolean};

useBlockReorder({
    blockIds,
    onMove,
})
```

`BlockEditor` passes `rootBlockIds(replica.state)` as `blockIds`, so hit-testing only considers root rows. The drop model can only mean "before this root" or "after this root".

The current command is also root-only:

```ts
export const moveBlock = (
    state: CachedState,
    movedBlockId: string,
    target: MoveTarget,
    context: CommandContext,
): CommandResult => {
    const currentOrder = rootBlockIds(state);
    // ...
    path: [current.id],
}
```

It always writes a new `block:move` order path of `[current.id]`, which reparents the moved block to root.

Nested block commands already prove the CRDT can represent the needed moves. `indentBlock` moves a block under its previous sibling with:

```ts
path: [...materializedBlockPath(state, previousBlockId), current.id]
```

`unindentBlock` moves a block to its grandparent and uses a new path derived from `materializedBlockPath`.

## CRDT Behavior

Blocks are ordered by a `Block['order']` object:

- `path` is the materialized ancestor path plus the block id, omitting root.
- `index` orders siblings under the same parent.
- `ts` participates in last-writer-wins conflict resolution.

`applyBlockMove` validates that the path ends with the moved block id, references existing blocks, and contains no duplicate id. This prevents cycles when the operation is validly constructed.

`visibleBlockOutline(state)` returns the visible outline in pre-order with depth and visible parent:

```ts
export type VisibleBlockOutlineEntry = {
    id: string;
    depth: number;
    parentId: string;
};
```

`materializeFormattedBlocks(state)` is based on that outline, so the UI already has enough data to render and hit-test nested rows.

Moving a parent should only need one `block:move` op for the parent. Children have paths that include the parent, so they remain descendants when the parent's path changes. This matches the task requirement that children move with a dragged parent.

## Main Gaps

1. The drag hook only knows root ids and vertical before/after targets.
2. The drop target shape cannot represent "inside this block as first/last child".
3. `moveBlock` can only place blocks at root.
4. The UI disables nested drag handles.
5. The current no-op detection only works for flat root sibling order.
6. There are no tests for arbitrary nested drag/move targets.

## Recommended Command Model

Introduce a more general block move target in `blockCommands.ts`, for example:

```ts
export type BlockMoveTarget =
    | {type: 'sibling'; targetBlockId: string; after: boolean}
    | {type: 'child'; parentBlockId: string; at: 'start' | 'end'};
```

Then replace or extend `moveBlock` so it computes:

- target parent id
- target parent path
- sibling list under the target parent, excluding the moved block if it is currently there
- `beforeId` and `afterId` within that sibling list
- a new LSEQ index between those sibling indices
- a new order path of `targetParentPath + current.id`, or `[current.id]` for root

Useful helpers already exist:

- `materializedBlockPath(state, blockId)`
- `materializedBlockParent(state, blockId)`
- `visibleBlockChildren(state, parentId)`
- `rootBlockIds(state)`
- `createLseqIdBetween`
- `parseLamportString` / `lamportToString`

The command should reject invalid moves:

- moved block is missing or not visible
- target block or parent is missing
- moving a block relative to itself
- moving a block into itself or any of its descendants
- sibling target is inside the moved subtree
- computed target is a no-op

The descendant check can be done from materialized paths:

```ts
const movedPath = materializedBlockPath(state, movedBlockId).map(lamportToString);
const targetPath = materializedBlockPath(state, targetParentId).map(lamportToString);
const targetIsInsideMoved = movedPath.every((id, index) => targetPath[index] === id);
```

For root, treat the parent id as `0000-root` and the path as `[]`.

## Drop Target / Hit Testing

The hook should work from the full outline, not `rootBlockIds`:

```ts
type BlockOutlineItem = {
    id: string;
    depth: number;
    parentId: string;
};
```

The UI can pass `blocks.map(({id, depth, parentId}) => ({id, depth, parentId}))`.

A practical target shape for the hook:

```ts
export type DropTarget =
    | {type: 'before'; targetBlockId: string}
    | {type: 'after'; targetBlockId: string}
    | {type: 'child'; parentBlockId: string};
```

`before` and `after` are visual outline positions. The command layer can translate them to sibling insertions:

- `before target`: same parent as target, insert before target.
- `after target`: if targeting a block with visible children, this is ambiguous.
- `child parent`: insert as first or last child of parent.

For "after target", there are two plausible behaviors:

1. Same-parent after target, which places the moved block after the entire target subtree in the outline.
2. First child of target, which places the moved block immediately below target and indented one level.

The existing UI only has a top/bottom line. To support empty-child insertion clearly, it likely needs an explicit third drop zone or horizontal intent:

- top band: before this block
- middle/right-indented band: as child of this block
- bottom band: after this block's subtree or after this block among siblings

Because the task explicitly requires child insertion into a block with no current children, the UI needs a target that is distinguishable from "after this row". The simplest approach is:

- Use vertical thirds of the hovered row.
- Top third means before row.
- Middle third means child of row.
- Bottom third means after row/subtree.
- Optionally require a horizontal threshold for child mode, such as pointer X to the right of the row text start. This reduces accidental nesting.

For rows with existing children, child mode can mean append as the last child. For rows without children, it creates the first child.

The drop indicator should communicate the selected target:

- before/after: horizontal line at the target depth
- child: horizontal line indented one level under the parent, or a line inside a visible empty child slot

CSS can continue using `--block-depth`, but child indicators need either a separate class or a style variable for indicator depth.

## Outline Semantics For "After"

The command layer should not infer tree moves from flat visual index alone unless the behavior is very carefully specified. In an outline editor, dropping "after" a parent that has children usually means after the entire subtree at the parent's depth, not as a sibling before the first child.

Recommended semantics:

- `before block`: insert before that block as a sibling of that block.
- `after block`: insert after that block as a sibling of that block.
- `child block`: append as the last child of that block.

With this model, dropping after a parent with children places the moved block before the parent's first child in pre-order, which may be surprising visually if the indicator is directly under the parent. To avoid that mismatch, the hook can resolve bottom-of-row targets differently:

- If the hovered block has children, bottom band should mean "child at start" or "after subtree", not simple sibling-after.
- "After subtree" can be represented as before the next visible block whose depth is less than or equal to the hovered block's depth, or as end of root/sibling list if none exists.

This is the most important UX choice to settle before implementation.

## Suggested Implementation Plan

1. Add a generalized move helper in `blockCommands.ts`.
   - Keep the existing `moveBlock` name if possible, but change its target type.
   - Or add `moveBlockToTarget` and migrate drag to it, leaving old tests temporarily intact.

2. Unit test command behavior before changing UI.
   - Move root block under another root with no children.
   - Move nested block to root.
   - Move nested block under a different nested parent.
   - Move parent with children and assert descendants keep relative structure.
   - Reject moving a block into itself.
   - Reject moving a block into its descendant.
   - Preserve cache invariants with `expectCache`.

3. Update `useBlockReorder`.
   - Accept full outline items.
   - Register all visible rows.
   - Track richer `DropTarget`.
   - Filter out invalid targets for the active dragged subtree.
   - Replace flat no-op logic with command-level no-op detection or outline-aware detection.

4. Update `App.tsx`.
   - Use `blocks` instead of `rootBlockIds` for drag data.
   - Enable handles for all visible blocks.
   - Pass the richer drop target to `moveBlock`.
   - Render drop indicator classes for before/after/child.

5. Update CSS.
   - Remove disabled-handle visual path for nested blocks once all handles are enabled.
   - Add child drop indicator styling with an indicator depth variable.
   - Ensure indicators do not shift row layout.

6. Add React/UI tests if the existing suite supports it.
   - At minimum, add command tests in `blockCommands.test.ts`.
   - If feasible, add `App.test.tsx` coverage for dragging a nested block and dragging onto an empty parent child zone.

## Testing Notes

The command tests are the highest-value coverage because they protect the actual CRDT operation shape and descendant behavior. UI drag tests are useful but more brittle because hit-testing depends on DOM geometry.

Existing tests already use:

- `pastePlainText` to create several blocks.
- `indentBlock` to create nesting.
- `materializeFormattedBlocks(state).map(({depth, runs}) => ...)` for outline assertions.
- `materializedBlockParent` and `visibleBlockOutline` for parent/depth assertions.
- `expectCache(result.state)` for CRDT cache invariants.

Add cases around the generalized move function near the existing `moves root blocks with a block:move op` test.

## Open Questions

1. What should dropping on the bottom half of a parent with existing children mean: after the parent as a sibling, after the entire subtree, or append as a child?
    after parent as sibling (which also means after entire subtree)
2. Should child insertion require horizontal intent, or is a middle-row drop zone enough?
    - hotizontal intent
3. When dropping as a child, should the block become the first child or last child by default? The task only specifies child position for empty parents.
    - depends on vertical location
4. Should a dragged subtree visibly collapse while dragging, or should all descendants remain visible and dimmed?
    - all descendants remain visible and dimmed
5. Should the selection move to the dragged block after a successful drop, or should the current retained selection remain unchanged as it does today?
    - unchanged is fine
6. Should drag be allowed while an editor is offline? Current local command history supports offline edits, so the expected answer is probably yes.
    - definitely
7. Do we need keyboard-accessible block reordering for nested moves now, or is pointer drag sufficient for this task?
    - pointer is enough for now

## Additional notes

The children of deleted blocks are rendered spliced into the grandparent's children, but are still logically the children of the deleted node. Currenet code fails when trying to drop in the middle of such grandchildren-as-children.

## Risks

- Ambiguous "after" behavior can create surprising tree positions if the indicator does not match the resulting parent/depth.
- Moving into a descendant must be rejected before constructing the op; `validateBlockOrderPath` rejects duplicate ids, but command code should avoid producing an invalid operation.
- If the hook filters invalid targets only in UI, tests may miss command-level invalid moves. Keep validation in `blockCommands.ts`.
- Concurrent moves are resolved by existing block order timestamps. This task should not change CRDT conflict semantics unless tests expose a specific convergence issue.
