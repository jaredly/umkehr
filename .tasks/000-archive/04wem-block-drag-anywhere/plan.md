# Plan: Block Drag Anywhere

## Scope

Support pointer drag and drop for every visible block in `examples/block-rich-text`, including nested blocks. A dragged parent moves with its visible descendants. Valid drops include root positions, sibling positions at any depth, and child positions under blocks with or without existing children.

Out of scope for this task:

- Keyboard-accessible block reordering.
- Changing selection after drop; keep the current retained selection unchanged.
- Changing CRDT conflict semantics for concurrent block moves.

## Behavior Decisions

- Drag handles are enabled for all visible blocks.
- Dragging a parent keeps descendants visible and dimmed during drag.
- Dropping after a block with children means after that block's entire subtree, as a sibling at the same depth.
- Child drops require horizontal intent.
- Child insertion position depends on vertical location:
  - child-top means first child
  - child-bottom means last child
  - for an empty parent, both resolve to its first child position
- Offline editors can drag blocks; moves should flow through normal local history and queueing.
- Invalid targets are ignored, both in UI hit-testing and in the command layer.

## Phase 1: Command Model

Files:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`

Tasks:

1. Replace the root-only `MoveTarget` with a generalized move target:

   ```ts
   export type MoveTarget =
       | {type: 'before'; targetBlockId: string}
       | {type: 'after'; targetBlockId: string}
       | {type: 'child'; parentBlockId: string; at: 'start' | 'end'};
   ```

2. Rework `moveBlock` so it computes a parent-aware `block:move` order:
   - Resolve the target parent id.
   - Resolve the target parent path.
   - Build the target sibling list with the moved block removed.
   - Compute `beforeId` / `afterId`.
   - Generate a new LSEQ index with `createLseqIdBetween`.
   - Write the new path as `targetParentPath + current.id`; root path is `[current.id]`.

3. Add command-level validation:
   - Reject missing or non-visible moved blocks.
   - Reject missing target blocks/parents.
   - Reject moving relative to itself.
   - Reject moving into itself or a descendant.
   - Reject sibling targets inside the moved subtree.
   - Return no ops for no-op moves.

4. Handle deleted/joined-block parent edge cases:
   - The UI may present grandchildren spliced into a visible grandparent because `visibleBlockChildren` skips non-visible parents.
   - Do not use visible sibling lists alone when computing raw parent paths for moves.
   - Use materialized visible parent data for user-facing target semantics, then construct a valid raw path against existing blocks.
   - Add tests that cover dropping between grandchildren whose logical parent is deleted/non-visible.

5. Preserve the current selection behavior:
   - `moveBlock` can still return `selection: caret(movedBlockId, 0)` for command tests.
   - `App.tsx` should continue returning `selection: current.selection` after drag.

Phase 1 tests:

- Move a root block before/after another root.
- Move a root block as first child of an empty root block.
- Move a root block as last child of a parent with children.
- Move a nested block to root before/after a root block.
- Move a nested block under another nested parent.
- Move a parent with children and assert descendants keep relative structure.
- Reject moving a block into itself.
- Reject moving a block into its descendant.
- Reject moving before/after a target inside its own subtree.
- Verify no-op moves produce no ops.
- Verify cache invariants with `expectCache`.

## Phase 2: Drop Target Resolution

Files:

- `examples/block-rich-text/src/useBlockReorder.ts`

Tasks:

1. Change the hook input from root ids to full visible outline items:

   ```ts
   type BlockOutlineItem = {
       id: string;
       depth: number;
       parentId: string;
   };
   ```

2. Change the hook `DropTarget` to match drag UI intent:

   ```ts
   export type DropTarget =
       | {type: 'before'; targetBlockId: string; indicatorBlockId: string; indicatorDepth: number}
       | {type: 'after'; targetBlockId: string; indicatorBlockId: string; indicatorDepth: number}
       | {type: 'child'; parentBlockId: string; at: 'start' | 'end'; indicatorBlockId: string; indicatorDepth: number};
   ```

   The exact stored fields can vary, but the hook needs enough data to render an indicator and pass an unambiguous command target.

3. Register every visible row, not only root rows.

4. Resolve pointer position with both vertical and horizontal intent:
   - Top region: before the hovered block.
   - Bottom region: after the hovered block's entire subtree.
   - Horizontally indented child-intent region: child of hovered block.
   - For child target, use vertical position to choose `at: 'start'` or `at: 'end'`.

5. Implement "after subtree":
   - Find the next visible outline item after the hovered subtree whose depth is less than or equal to the hovered block depth.
   - If present, the command target is before that item.
   - If absent, the target is after the last sibling in the hovered block's parent/root list.

6. Filter invalid drag targets while dragging:
   - Hide or clear targets inside the dragged subtree.
   - Hide self targets and no-op equivalents.
   - Let `moveBlock` remain the final authority.

7. Keep descendant rows visible and dimmed:
   - Track `draggingId`.
   - Expose enough information for `App.tsx` to mark rows whose materialized path is inside the dragged subtree.

Phase 2 tests:

- Add focused unit tests for pure helper functions if the hook logic is factored out.
- Cover after-subtree resolution separately from DOM pointer events if possible.

## Phase 3: UI Wiring

Files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/style.css`

Tasks:

1. Pass full outline data to `useBlockReorder`:
   - Use `blocks.map(({id, depth, parentId}) => ({id, depth, parentId}))`.
   - Remove `rootBlockIds(replica.state)` from drag setup if no longer needed.

2. Enable drag handles for all visible blocks:
   - Remove `canDrag={block.depth === 0}`.
   - Remove or simplify the disabled handle behavior unless still needed for invalid transient states.

3. Convert hook drop targets to command targets:
   - `before` maps to `moveBlock(..., {type: 'before', targetBlockId})`.
   - `after` maps to `moveBlock(..., {type: 'after', targetBlockId})`, or to the hook's resolved before/end target for after-subtree.
   - `child` maps to `moveBlock(..., {type: 'child', parentBlockId, at})`.

4. Keep selection unchanged after a drag:
   - Preserve the existing `return {state: result.state, ops: result.ops, selection: current.selection}` behavior.

5. Render drop indicators:
   - Before/after indicators should align with the resulting target depth.
   - Child indicators should appear one level deeper than the parent.
   - Indicators must not move row layout.

6. Dim the dragged subtree:
   - The dragged parent and descendants should be visually dimmed.
   - Avoid hiding descendants, because the chosen behavior is to keep the subtree visible.

7. Ensure drag still works when an editor is offline:
   - No special UI disabling should be introduced for offline panels.
   - Moves should continue through existing local history and queue behavior.

Phase 3 tests:

- Add `App.test.tsx` coverage if practical:
  - Drag a nested block to root.
  - Drag a root block as a child of an empty block.
  - Drag a parent and verify descendants stay nested after drop.
- If DOM geometry makes this brittle, keep UI tests light and rely on command/hook helper tests.

## Phase 4: Deleted Parent Edge Case

Files:

- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/blockCommands.test.ts`
- Possibly `examples/block-rich-text/src/useBlockReorder.ts`

Tasks:

1. Reproduce the case from the note:
   - Create a nested structure.
   - Delete/join a parent so its children render spliced into the grandparent's visible children.
   - Attempt to move/drop between those visible grandchildren.

2. Define the expected target semantics:
   - The user-facing drop should follow the visible outline.
   - The generated move path must still be valid against raw CRDT block records.

3. Fix command resolution so visible parent/sibling semantics do not produce invalid raw paths.

4. Add regression tests for:
   - Moving one spliced child before another.
   - Moving a visible external block into a position among spliced children.
   - Moving a spliced child out to root or another visible parent.

## Phase 5: Verification

Run targeted checks:

```sh
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
```

If touched behavior affects shared CRDT utilities, also run:

```sh
npm exec vitest -- run src/block-crdt/index.test.ts
```

Manual verification in the Vite app:

1. Create several root blocks.
2. Nest blocks with Tab.
3. Drag a nested block to root.
4. Drag a root block into an empty parent.
5. Drag a root block to first and last child positions of a parent with children.
6. Drag a parent with children and confirm descendants move with it and stay dimmed during drag.
7. Toggle one editor offline, drag blocks, then reconnect and confirm the other replica converges.
8. Verify drop after a parent with children lands after the entire subtree.

## Implementation Order

1. Command model and tests.
2. Deleted/non-visible parent regression setup.
3. Pure drop target resolution helpers.
4. Hook rewrite.
5. App/CSS wiring.
6. UI tests where stable.
7. Manual Vite verification.

This order keeps the CRDT operation semantics testable before adding pointer geometry and visual indicators.
