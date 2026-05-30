# Peritext blocks implementation plan

## Decisions

- Use explicit block nodes as start boundaries over the existing global Peritext character
  sequence.
- Blocks do not own text. Text identity remains in `chars`.
- Sibling blocks store `start`; derived block end is the next sibling start or parent/root end.
- Keep both `start` and `afterId`: `start` determines text range, `afterId` preserves sibling
  ordering for equal-start/empty blocks.
- `RichTextState` should always contain at least one root paragraph block, including empty docs.
- `plainText` should synthesize newlines between materialized blocks.
- Block attrs resolve as whole-object last-writer-wins.
- Block IDs can share the rich-text op counter namespace.
- `deleteBlock` is structurally like `removeMark`: it hides/removes the block boundary but does not
  remove text.
- `splitBlock(index)` should anchor after the previous character, using edge anchors at text
  boundaries.
- Splitting a block inherits the source block attrs by default.
- Inline marks may span block boundaries.
- Marks attach only to character ranges, not to block nodes.
- Enter-at-end-of-list-item behavior is an editor concern, not a CRDT algorithm rule.
- Undo Enter and following typing as separate command groups.
- No migration burden for old rich-text snapshots; there is no production use.

## Phase 1: Core Block Types And IDs

Add block concepts to `src/peritext` without changing the public editor yet.

Tasks:

- Extend `src/peritext/types.ts`:
  - `RichTextBlockId`.
  - `RichTextBlockType`.
  - `RichTextBlockAttrs`.
  - `RichTextBlockNode`.
  - `RichTextCreateBlockOperation`.
  - `RichTextSetBlockOperation`.
  - `RichTextDeleteBlockOperation`.
  - Extend `RichTextOperation`.
  - Add `blocks: RichTextBlockNode[]` to `RichTextState`.
- Update `emptyRichTextState()` to include one root paragraph block at `startOfText`.
- Extend ID helpers in `src/peritext/ids.ts`:
  - allocate/format block IDs using the shared counter namespace.
  - compare block IDs deterministically.
  - include block operation IDs in `maxOpCounter` / operation ID extraction.
- Decide exact string shape before implementation; keep it simple and parseable, probably
  `${counter}#${actorId}`.

Tests:

- Empty state contains one root paragraph block.
- Importing or constructing text preserves a root paragraph.
- Block IDs and char op IDs can share counter allocation without collisions.

## Phase 2: Block Reducer

Add pure block operation application before CRDT integration.

Tasks:

- Add `src/peritext/blocks.ts`.
- Implement `applyCreateBlockOperation`.
  - Idempotent by `blockId` and/or `opId`.
  - Pending if `parentId`, `afterId`, or `start` anchor dependency is missing.
  - Allow equal starts.
- Implement `applySetBlockOperation`.
  - Whole-object last-writer-wins attrs by greatest operation ID.
  - Do not mutate text.
- Implement `applyDeleteBlockOperation`.
  - Tombstone/hide the boundary.
  - Do not delete text.
  - Preserve descendants in metadata; materialization decides visibility.
- Extend `src/peritext/apply.ts` to route block operations and retry pending block operations.
- Extend `src/peritext/validation.ts` for block operation envelopes, IDs, attrs, and anchor shape.

Tests:

- Creating a block at a character anchor is idempotent.
- Creating two blocks at the same start preserves both.
- `setBlock` resolves conflicts by whole-object LWW.
- `deleteBlock` hides the block without removing any characters.
- Pending block operations apply after missing anchors/parents arrive.

## Phase 3: Materialization

Derive block ranges and nested block views from global text plus block nodes.

Tasks:

- Extend `RichTextRenderView` with `blocks`.
- Add `RichTextBlockView` with:
  - `blockId`, `parentId`, `type`, `attrs`.
  - `start`, `end` indexes in the materialized plain-text coordinate space.
  - `text`, `spans`, `children`.
- Implement block materialization in `src/peritext/materialize.ts` or `src/peritext/blocks.ts`.
- Sort siblings by:
  - resolved/clamped `start`;
  - `afterId` sibling order for equivalent starts;
  - `blockId` as final deterministic tie-breaker.
- Derive ranges:
  - root children partition `[startOfText, endOfText)`.
  - child blocks partition the parent block's derived range.
  - block end is next sibling start or parent end.
- Clamp starts outside the parent range during materialization.
- Treat equal starts as empty block ranges where appropriate.
- Synthesize newlines between materialized blocks in `plainText`.
- Keep the existing top-level `spans` projection for compatibility.

Tests:

- One paragraph block materializes existing text.
- Two sibling blocks split one global text sequence without moving chars.
- Equal-start sibling blocks materialize deterministically with one empty block.
- Child block starts outside the parent range clamp to the parent range.
- Deleted blocks do not render; text remains reachable through surrounding ranges.
- `plainText` synthesizes newlines between blocks.

## Phase 4: Import And Export

Make snapshots block-aware while preserving existing span imports.

Tasks:

- Extend `RichTextImportSnapshot` to allow either `spans` or `blocks`.
- Add `RichTextBlockSnapshot`.
- Existing `{spans}` imports create one root paragraph block.
- `{blocks}` imports:
  - create block nodes;
  - insert all block text into the global character sequence;
  - assign child block starts within the parent range;
  - preserve inline marks as existing addMark operations.
- Export should prefer `{blocks}` from `RichTextRenderView`.
- Keep HTML fidelity best-effort for now.

Tests:

- Span-only snapshot imports as one paragraph block.
- Multiple root block snapshots import/export with synthesized newlines in `plainText`.
- Nested block snapshots round-trip enough structure for blockquote/list smoke cases.
- Inline marks inside blocks still import/export.

## Phase 5: CRDT Update Integration

Expose block operations through the existing rich-text CRDT envelope.

Tasks:

- Extend rich-text draft patch types in `src/types.ts`.
- Extend `$text` builder methods:
  - `createBlock(parentId, afterId, index, attrs)`.
  - `setBlock(blockId, attrs)`.
  - `deleteBlock(blockId)`.
  - `splitBlock(index, attrs?)`.
  - `joinBlock(blockId)`.
- Extend `src/helper.ts` patch creation for the new methods.
- Extend `src/crdt/updates.ts`:
  - resolve indexes to anchors.
  - allocate block IDs from the shared namespace.
  - `splitBlock` finds the containing block, creates a sibling after it, anchors after the previous
    char, and inherits attrs unless explicit attrs are provided.
  - `joinBlock` emits `deleteBlock` for the later sibling boundary.
- Extend `src/crdt/apply.ts` through existing peritext operation routing.
- Extend update validation for block operations.
- Ensure `changedNormalPathsForCrdtUpdate` still invalidates the owning rich-text path.

Tests:

- `$text.setBlock` produces `op: 'richText'` with `change.action === 'setBlock'`.
- `$text.splitBlock` creates a new block and does not create remove/insert operations for moved
  text.
- `$text.joinBlock` removes a boundary and preserves text.
- Applying block updates is idempotent.
- Changed paths include the rich-text field path.

## Phase 6: Undo And Redo

Add history support for block operations.

Tasks:

- Extend rich-text local effect capture for create/set/delete block operations.
- Undo `createBlock` with `deleteBlock`.
- Undo `deleteBlock` by creating/restoring a fresh block boundary operation.
- Undo `setBlock` by setting previous attrs.
- Redo with fresh operation IDs.
- Keep Enter/split and subsequent typing as separate command groups.

Tests:

- Undo/redo `setBlock`.
- Undo/redo split preserves text identity and materialized text.
- Undo/redo join restores the block boundary.
- Redo uses fresh operation IDs.

## Phase 7: React Rendering And Editor Commands

Render block views and map editor actions to block operations.

Tasks:

- Update `src/react-rich-text/render.tsx` to render `view.blocks`.
- Keep inline mark rendering inside each block's `spans`.
- Add block-aware selection helpers if synthesized newlines affect offset mapping.
- Add editor handling:
  - Enter uses `splitBlock`.
  - Backspace at block start uses `joinBlock`.
  - block type controls use `setBlock`.
  - Enter at end of an empty list item can set paragraph attrs as an editor rule.
- Avoid making literal `\n` insertion the normal block split path.
- Preserve existing inline mark behavior across block boundaries.

Tests:

- Block rendering creates paragraph/heading/blockquote/list elements from `view.blocks`.
- Pressing Enter emits split/create-block updates.
- Backspace at block start emits join/delete-block update.
- Changing a block type emits `setBlock`.
- Inline bold/italic commands still work across block boundaries.

## Phase 8: Nested Blocks

Add basic nested structures once flat root blocks work.

Tasks:

- Support root blockquote/list containers.
- Support list item children.
- Normalize renderer output for common invalid trees while keeping metadata intact.
- Keep materialization forgiving:
  - hide deleted parents and descendants in the view;
  - clamp child starts;
  - avoid throwing for malformed trees.

Tests:

- Blockquote with paragraph children materializes.
- List with list item children materializes.
- Deleted parent hides descendants in the rendered view.
- Invalid mixed trees do not crash materialization.

## Phase 9: Convergence And Fuzz Coverage

Add broader confidence tests around the new block model.

Tests:

- Concurrent splits at the same index converge and produce equal-start blocks.
- Concurrent split and text insert at the split point converge.
- Concurrent join/delete and `setBlock` on the same block converge.
- Concurrent nested block creation with delayed parent arrival converges after pending retry.
- Randomized schedules of insert/remove/mark/createBlock/setBlock/deleteBlock converge.

## Verification

Run targeted tests after each phase:

```sh
pnpm test -- src/peritext
pnpm test -- src/crdt/richtext.test.ts
pnpm test -- src/react-rich-text
```

Before considering the feature complete, run the broader suite:

```sh
pnpm test
```
