# Plan: Block Rich Text Children

## Goal

Add nested block support to `examples/block-rich-text` with keyboard indent/outdent:

- `Tab` indents only when the primary live selection is a collapsed caret at offset `0`.
- `Shift+Tab` unindents only when the primary live selection is a collapsed caret at offset `0`.
- Ranges do not indent/outdent in this task.
- Nested drag/drop is disabled for now.
- Joins use visible document adjacency, including nested blocks.
- `materializeFormattedBlocks()` should change to include visible descendants.
- There is no max nesting depth.

The important CRDT behavior is concurrent unindent convergence. If sibling blocks are `A B C D`, one client unindents `B`, and another concurrently unindents `C`, then `D` should converge as a child of `C`, not `B`. The incidental reparent timestamp for `D` must encode the order position of the unindenting block, so `C`'s incidental reparent beats `B`'s because `B.order.index < C.order.index` at the time of reparenting.

## Phase 1: Block Order Timestamp Types

Update `src/block-crdt/types.ts` so `Block.order.ts` can represent incidental block reparenting.

Suggested shape:

```ts
export type IncidentalBlockOrderTs = [HLC, LseqId, HLC];
export type BlockOrderTs = HLC | IncidentalBlockOrderTs;
```

Then update:

```ts
order: {index: LseqId; ts: BlockOrderTs; parent: Lamport};
```

The tuple fields are:

- prior effective order timestamp for the moved sibling;
- the `order.index` of the block whose unindent caused the incidental reparent;
- the new local timestamp.

Refactor the timestamp comparison in `src/block-crdt/index.ts`.

Current `laterTs()` is char-oriented but already compares string-or-tuple timestamps. Make this intentional:

- either keep one generic helper for `HLC | [HLC, Path, HLC]`;
- or introduce `laterCharParentTs()` and `laterBlockOrderTs()`.

For block order timestamps, the tuple comparison should:

1. compare the prior/source timestamp;
2. compare the causal order index with `compareLseqIds`;
3. compare the new timestamp.

Acceptance criteria:

- TypeScript no longer relies on accidental compatibility between `Char.parent.ts` and `Block.order.ts`.
- Existing char split behavior remains unchanged.
- `block:move` still ignores stale order updates.

## Phase 2: Visible Outline Traversal

Change public block materialization to include descendants.

Add or update traversal helpers in `src/block-crdt/index.ts`:

```ts
export type VisibleBlockOutlineEntry = {
    id: string;
    depth: number;
    parentId: string;
};

export const visibleBlockOutline = (state: CachedState): VisibleBlockOutlineEntry[] => ...
```

Rules:

- Start from root.
- Include visible blocks in sibling order.
- Recurse into visible children, increasing `depth` by one.
- If a deleted or joined block is encountered, splice its visible children into the hidden block's position.
- Children spliced through a hidden block keep the hidden block's depth, not the hidden block's would-be child depth. This matches "children are displayed as spliced into the grandparent's children in place of the parent."
- Defend against block-parent cycles with the same kind of seen-set guard already used by `visibleBlockChildren()`.

Update `materializeFormattedBlocks()` so it maps the visible outline rather than only `rootBlockIds(state)`.

Extend `FormattedBlock`:

```ts
export type FormattedBlock = {
    id: string;
    block: Block;
    runs: FormattedRun[];
    depth: number;
    parentId: string;
};
```

Keep `rootBlockIds()` behavior unchanged so existing callers that explicitly want root children can continue using it.

Acceptance criteria:

- Existing root-only documents materialize identically except for the extra `depth` and `parentId` fields.
- Nested children appear in formatted materialization in visible outline order.
- Children of hidden joined/deleted blocks appear where the hidden parent would have appeared.

## Phase 3: Selection And Document Order

Update example-layer document-order helpers to use formatted/outline order where users see all visible blocks.

Affected files:

- `examples/block-rich-text/src/selectionModel.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/wordOccurrences.ts`
- `examples/block-rich-text/src/App.tsx`

Introduce an example helper if useful:

```ts
const visibleBlockIds = (state: CachedState) =>
    materializeFormattedBlocks(state).map((block) => block.id);
```

Use visible outline order for:

- `clampPoint()`;
- `normalizeSelectionSegments()`;
- `firstPointForSelection()`;
- retained selection fallback and resolution;
- multi-selection sorting/deduping;
- word occurrence scans;
- left/right arrow navigation between blocks.

Acceptance criteria:

- A multi-block range can span parent and child blocks.
- Retained selections inside children survive remote indent/unindent.
- Arrow-left/right navigation follows visible outline order.

## Phase 4: Indent And Unindent Commands

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

Shared requirements:

- Return no ops if the block is missing or hidden.
- Preserve the moved block's children.
- Return selection as `caret(blockId, 0)`.
- Apply ops locally with `applyMany()` and return the applied state.

Indent algorithm:

1. Read the block's current parent.
2. Find visible siblings under that same parent.
3. Find the previous visible sibling.
4. If there is no previous sibling, no-op.
5. Move the block under the previous sibling.
6. Assign an order index after the previous sibling's current visible children.
7. Use a plain timestamp for the intentional selected-block move.

Unindent algorithm:

1. Read the block's current parent.
2. If parent is root, no-op.
3. Read the grandparent from the parent block's order.
4. Move the selected block into the grandparent, immediately after its old parent.
5. Find following visible siblings under the old parent after the selected block.
6. Move each following sibling under the selected block.
7. Preserve each following sibling's existing `order.index`.
8. Use incidental block order timestamps for those following sibling moves:

```ts
ts: [lastBlockOrderTs(sibling.order.ts), selectedBlock.order.index, context.nextTs()]
```

The selected block's own unindent move uses a plain timestamp, because it is the user's intentional move.

Acceptance criteria:

- `Tab` on `B` in `A B C` makes `B` a child of `A`.
- `Tab` on the first sibling no-ops.
- `Shift+Tab` on child `B` moves it after its parent.
- If child siblings are `B C D`, `Shift+Tab` on `B` moves `C D` under `B`.
- Concurrent `Shift+Tab` of `B` and `C` converges with `D` under `C`.

## Phase 5: Join Semantics Over Visible Adjacency

Update `joinWithPrevious()` and `joinWithNext()` in `examples/block-rich-text/src/blockCommands.ts`.

Use visible outline order rather than root-only order:

- Backspace at the start of any visible block joins it with the previous visible block, if one exists.
- Delete at the end of any visible block joins it with the next visible block, if one exists.
- Existing `join()` CRDT behavior should continue to preserve content across block structure.

The command should still no-op when there is no previous/next visible block.

Acceptance criteria:

- Backspace at the start of a child after another visible block joins with that previous visible block.
- Delete at the end of a parent before its first child joins with that child.
- Existing root-level join tests continue to pass.

## Phase 6: UI Wiring And Styling

Update `examples/block-rich-text/src/App.tsx`.

Rendering:

- Use the updated `materializeFormattedBlocks()` result, now including descendants.
- Pass `block.depth` to `EditableBlock`.
- Apply depth-based indentation with CSS custom property or class.
- Keep a flat list in React.

Keyboard:

- In `EditableBlock.onKeyDown`, intercept `Tab` only when:
  - no meta/ctrl/alt modifier is pressed;
  - the live DOM selection is a collapsed caret;
  - the caret is at offset `0`.
- `Tab` calls `indentBlock`.
- `Shift+Tab` calls `unindentBlock`.
- If those conditions are not met, leave behavior consistent with the current editor. A practical implementation can prevent default for Tab inside the editor to avoid focus escape, but it should not emit indent/outdent ops unless the caret-at-start condition passes.

Drag:

- Disable drag handles for nested blocks.
- Keep drag reorder root-only.
- Ensure root drag targets are computed from root ids, not all visible outline ids.
- Avoid any path where dragging a nested block emits the current root-flattening `moveBlock()`.

Styling:

- Add indentation in `examples/block-rich-text/src/style.css`.
- No max depth.
- Keep row text and controls aligned without nested cards or extra containers.

Acceptance criteria:

- Nested blocks visibly indent.
- Nested blocks cannot be dragged in this first pass.
- Root block drag/reorder still works.
- Tab/Shift+Tab do not create text content.

## Phase 7: Tests

Add focused tests before broad UI polish.

Core tests in `src/block-crdt/index.test.ts`:

- `block:move` can move a block under another block and updates `cache.blockChildren`.
- `visibleBlockOutline()` returns root and nested visible blocks with correct depths.
- hidden joined/deleted parent children splice into the grandparent position with the grandparent depth.
- incidental block order timestamps compare by selected block `order.index`.
- concurrent unindent-style block moves converge with `D` under `C` for `A B C D`.

Command tests in `examples/block-rich-text/src/blockCommands.test.ts`:

- `indentBlock()` indents under previous sibling.
- `indentBlock()` no-ops for first sibling.
- `unindentBlock()` moves a child after its parent.
- `unindentBlock()` reparents following siblings under the unindented block and preserves their indexes.
- unindent at root no-ops.
- join previous/next uses visible adjacency.

Selection tests in existing selection test files:

- range normalization follows visible outline order.
- retained selection resolves inside nested blocks.
- word occurrence scans nested blocks.

UI tests in `examples/block-rich-text/src/App.test.tsx`:

- `Tab` at start indents.
- `Shift+Tab` at start unindents.
- `Tab` with a non-collapsed selection does not indent.
- `Tab` away from offset `0` does not indent.
- nested rows render with depth styling.
- nested drag handle is disabled or absent.
- root drag still works and does not flatten children.

Suggested verification command:

```sh
npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/selectionSet.test.ts examples/block-rich-text/src/retainedSelection.test.ts src/block-crdt/index.test.ts
```

Run broader tests if the materialization change causes snapshot or type fallout:

```sh
npm exec vitest -- examples/block-rich-text/src src/block-crdt
```

## Phase 8: Cleanup And Compatibility Pass

After the main implementation is passing:

- update any tests that compare `materializeFormattedBlocks()` objects to include or ignore `depth` and `parentId`;
- audit root-only helpers to confirm remaining `rootBlockIds()` calls are intentional;
- check `stateToString()` output for nested and hidden-parent cases;
- check TypeScript errors around `FormattedBlock` shape changes;
- ensure cache equality assertions still use `organizeState(state.state.blocks, state.state.chars, state.state.joins)`;
- document any intentionally deferred nested drag/drop behavior in the implementation log if one is created.

## Deferred Work

- Multi-block indent/outdent for selected ranges.
- Hierarchy-aware drag/drop.
- Toolbar controls for indent/outdent.
- Any maximum depth policy.
