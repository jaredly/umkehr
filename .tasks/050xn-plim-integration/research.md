# Research: Plim Integration With `umkehr/block-crdt`

## Goal

Evaluate whether [Plim](https://github.com/darylcecile/Plim) can be used as the editor UI for `umkehr/block-crdt`, ideally without changing Plim. If that is not practical, identify the smallest useful affordances to add to `block-crdt`, Plim, or a fork/contribution.

This research inspected Plim `main` at `f0e1eda330effe6704402bdc59837b52bb86e7fb` and the published package tags visible as of this pass (`@plim/core`, `@plim/editor`, `@plim/markdown`, and `@plim/react` all at `0.0.4`).

## Plim Shape

Plim is a TypeScript monorepo with four relevant packages:

- `@plim/core`: JSON document model, path/offset selection model, transactions, validation, history, block/mark descriptors, and extensions.
- `@plim/editor`: DOM/contenteditable view layer, keyboard/input/paste pipeline, block handles, toolbar, drag/drop, and framework-agnostic `deriveEditor(...)`.
- `@plim/markdown`: markdown import/export for Plim documents.
- `@plim/react`: React bindings, `<PlimEditor>`, `useEditorHandle()`, slash/mention extensions, and a bridge for React-rendered blocks.

The public README describes Plim as pre-1.0 with a mostly stable but still movable API. That is helpful: integration hooks can probably still be proposed upstream without fighting a frozen API.

Plim's core document model is plain JSON:

```ts
type TextSpan = {
    text: string;
    marks?: MarkInstance[];
};

type BlockNode = {
    id: string;
    type: string;
    attrs?: Record<string, unknown>;
    text?: TextSpan[];
    children?: BlockNode[];
};

type DocumentNode = {
    type: 'doc';
    children: BlockNode[];
};
```

Selections are path/offset based:

```ts
type CursorPosition = {
    path: number[];
    offset: number;
};

type Selection = {
    anchor: CursorPosition;
    head: CursorPosition;
};
```

Transactions are high-level editor operations:

- `replaceText`
- `setSelection`
- `splitBlock`
- `joinBackward`
- `setBlockType`
- `setBlockAttrs`
- `insertBlock`
- `removeBlock`
- `moveBlock`
- `toggleMark`

The editor surface is promising for an adapter:

- `deriveEditor(plim, {initialContent, ...})` returns an `EditorHandle`.
- `EditorHandle.getState()` and `setState(...)` expose full state replacement.
- `EditorHandle.onTransaction(cb)` observes each committed transaction.
- `EditorHandle.createTransaction()` is the normal path for user and extension actions.
- The DOM view already maps DOM selection to Plim selection and back.

## `block-crdt` Shape

`umkehr/block-crdt` is operation-based and uses stable Lamport ids:

- Blocks are stable records with `id`, generic timestamped `meta`, LSEQ sibling order/path, and tombstone deletion.
- Characters are stable records with `id`, `text`, `deleted`, and parent pointers.
- Structural edits are represented as public `Op[]`, not opaque transactions.
- Remote delivery can use `applyRemote` / `applyRemoteMany`, including pending dependency handling.
- Formatting marks anchor to character ids and understand split/join history.

Relevant helper APIs:

- `insertTextOps(state, {actor, block, offset, text, ts})`
- `deleteRangeOps(state, {block, startOffset, endOffset})`
- `splitBlockOps(state, {actor, block, offset, ts, options})`
- `joinBlocksOps(state, {actor, left, right, ts})`
- `moveBlockOps(state, {actor, block, parent, before, after, ts, options})`
- `setBlockMetaOps(state, {block, meta})`
- `markRangeOp(state, block, startOffset, endOffset, type, data, remove, id)`
- `materializeFormattedBlocks(state)`
- `visibleBlockOutline(state)`
- `visibleBlockChildren(state, parentId)`
- `orderedCharIdsForBlock(state, blockId, {visibleOnly})`

The richer local example also already has retained selection logic (`examples/block-rich-text/src/retainedSelection.ts`) that anchors points to character ids instead of only offsets. That matters for remote edits: Plim's built-in path/offset selection is fine for local DOM work but not enough by itself for collaboration-correct retained selections.

## Compatibility Assessment

The integration looks feasible as an adapter without immediate Plim changes if the first goal is "use Plim as a rich block editor UI backed by block-crdt."

The adapter would own three mappings:

1. `block-crdt -> Plim DocumentNode`
2. `Plim TransactionOp[] -> block-crdt Op[]`
3. `block-crdt remote Op[] -> next Plim EditorState`

The first mapping is straightforward for common text blocks:

- Block id: use `lamportToString(block.id)` as `BlockNode.id`.
- Block type/attrs: map `block.meta` to Plim `type` and `attrs`.
- Text spans: use `materializeFormattedBlocks(state).runs` and convert mark records to Plim `TextSpan.marks`.
- Children: use `visibleBlockOutline` or `visibleBlockChildren` to rebuild nested `children`.

The second mapping is viable for most Plim transaction kinds:

- `replaceText` can become delete+insert ops in one block.
- `splitBlock` can become `splitBlockOps`, plus possibly `setBlockMetaOps` if Plim's right block type/attrs differ from the left.
- `joinBackward` can become `joinBlocksOps(prev, current)`.
- `setBlockType` / `setBlockAttrs` can become `setBlockMetaOps`.
- `moveBlock` can become `moveBlockOps` using path-to-id and sibling anchor lookup.
- `toggleMark` can become `markRangeOp` for add/remove marks.
- `setSelection` should not become a document op; keep it as local/presence state.

The third mapping can be simple: apply CRDT ops, materialize a fresh Plim document, resolve retained selection to the current visible Plim path/offset, and call `editor.setState(...)`.

## Main Hazards

### Plim Paths Are Not Stable

Plim selections and transactions address blocks by `number[]` paths. Those paths are invalidated by concurrent insert/remove/move. The adapter should treat paths only as a short-lived UI addressing scheme and immediately map them to Plim block ids, then to Lamport block ids, against the editor state that produced the transaction.

Block ids are stable in existing Plim docs, and `view.ts` has internal `pathForBlockId(...)` helpers. The adapter can implement its own path/id lookup over `EditorState.doc`.

### Plim Generates Fresh Random Block IDs

Plim `splitBlock` creates the right-hand block internally with `newId()`, while `block-crdt` creates the new block id from the Lamport clock. If the adapter simply listens after dispatch, the Plim state will briefly contain a random new block id that does not match the CRDT block id.

This is manageable if the adapter treats Plim state as a view cache and immediately rematerializes from CRDT after every document transaction. However, it creates two downsides:

- Plim listeners/extensions observing the post-transaction state see ids that will be replaced.
- Any local UI state keyed to the temporary Plim id may be lost after rematerialization.

This is the strongest candidate for a small Plim contribution: allow callers to provide an id for `splitBlock`, or provide an id factory in `PlimDriver` / `deriveEditor` options.

### Transaction Observation Is Post-Apply

`onTransaction` fires after Plim has already applied the transaction, pushed history, and updated the view. For a CRDT-backed editor, the canonical state should be the CRDT state, not Plim's local mutation result.

This can still work:

1. Observe the transaction.
2. Translate ops using the pre-transaction state captured by the adapter.
3. Apply generated `block-crdt` ops.
4. Rematerialize and `setState(...)`.

But this creates a local double-apply/render path. A cleaner upstream hook would be a controlled dispatch mode: `dispatch(tx)` calls an external transaction handler and lets the host return the next `EditorState`.

### Plim History Is Snapshot Based

Plim history stores `stateBefore` and `stateAfter`. That does not match op-based CRDT undo. A CRDT-backed integration should probably disable Plim history for document ops and use `block-crdt`'s undo planning or an adapter-level command history.

There is already `tx.meta.addToHistory = false`, and Plim uses that for selection changes. The adapter may need to set this on CRDT-controlled transactions or intercept browser undo/redo actions.

### Text Offsets Differ

Plim offsets are JavaScript string lengths. `block-crdt` insertion uses `Intl.Segmenter` and allocates ids per grapheme cluster. For simple ASCII this is invisible; for emoji, combining marks, and some IME paths it is not.

The adapter should normalize offset conversion through visible grapheme boundaries. If Plim's DOM/view still reports UTF-16 offsets, the adapter needs a conversion layer from Plim offset to grapheme offset before calling `block-crdt` helpers.

This may become a Plim affordance request: expose a position metric hook or commit to grapheme-based offsets.

### Marks Have Different Semantics

Plim `toggleMark` is state-based: it checks whether the mark is currently on for the selected range and then add/removes in the materialized text spans. `block-crdt` marks are records anchored to character ids with add/remove behavior and Lamport conflict ordering.

The adapter can reproduce Plim's current toggle behavior by inspecting the current CRDT materialization and emitting either an add or remove mark op. Cross-block marks need expansion into per-block ranges unless `block-crdt` grows a public helper for multi-block mark ranges.

### Block Deletes And Structural Deletes

Plim `removeBlock` removes a block from the JSON tree. `block-crdt` has `block:delete` tombstones but no public `deleteBlockOps` helper in the current index. The adapter can construct raw `{type: 'block:delete', id}` ops, but the README says integrations should prefer helpers and raw ops have non-obvious invariants.

This is a concrete `block-crdt` affordance gap: add a public `deleteBlockOps(...)` helper, and decide its behavior for descendants and joined blocks.

### Insert Block Needs A Public Helper

Plim can insert arbitrary blocks, including atomic/custom blocks. `block-crdt` currently exposes split and move helpers but not a general public "insert empty block at parent/before/after" helper. Split covers Enter, but paste, slash commands, and atomic block insertion need a direct helper.

This is another useful `block-crdt` affordance: expose `insertBlockOps(state, {actor, parent, before, after, meta, ts})`.

## Recommended Integration Plan

### Phase 1: Read-Only Materialization Spike

Build a small adapter that takes `CachedState<M>` and emits a Plim `DocumentNode`.

Scope:

- paragraph, heading, quote, bullet, numbered list, todo/checklist, code, divider if metadata supports it
- mark conversion for bold/italic/code/link/etc. using Plim registered mark names
- nested children via visible block traversal

This validates whether Plim can render our documents without modifying either package.

### Phase 2: Local Editing Translator

Mount Plim normally, subscribe to transactions, and translate a conservative subset:

- single-block text insert/delete
- split paragraph
- join backward
- set block type/attrs
- move block
- single-block mark toggle

After every translated document transaction, apply CRDT ops and call `editor.setState(materializedState)`.

Keep Plim selection local, but maintain a retained-selection representation in the adapter using CRDT char ids. On rematerialization, resolve retained points to Plim paths/offsets and set `EditorState.selection`.

### Phase 3: Remote Ops And Concurrency

Feed remote `Op[]` through `applyRemoteMany` or the app's existing replication flow, rematerialize Plim state, and verify:

- retained caret survives remote insert/delete before it
- split moves right-side text into the CRDT-created block and Plim follows after rematerialization
- join hides the right block and maps selection into the left block
- block move preserves selection by block id
- concurrent inserts/deletes converge in materialized Plim docs

### Phase 4: Decide On Upstream Hooks

Only after the adapter proves useful, decide whether to contribute Plim affordances:

- configurable id factory or explicit id arguments for `splitBlock` / generated blocks
- controlled dispatch hook for external state engines
- public path/id lookup helpers
- optional grapheme-offset mode or offset conversion utilities
- history customization / disable-document-history mode

## Suggested `block-crdt` Additions

These would make Plim integration easier without making `block-crdt` Plim-specific:

- `insertBlockOps(state, {actor, parent, before, after, meta, ts, options})`
- `deleteBlockOps(state, {block, ts?})` with documented descendant behavior
- `markRangesOps(...)` or a multi-block mark helper
- `blockIdAtVisiblePath(state, path)` and `visiblePathForBlockId(state, blockId)` helpers
- `visibleOffsetForCharPoint(state, retainedPoint)` as a public version of retained selection resolution
- grapheme/offset utilities shared by `insertTextOps` and adapters

## Suggested Plim Additions

These are not required for a first adapter, but they would make a CRDT-backed integration cleaner:

- Inject an id factory or explicit ids for transactions that create blocks.
- Add controlled dispatch: host translates a transaction and returns the authoritative next state.
- Expose public helpers for `pathForBlockId`, `blockElementAtPath`, and selection path/id conversion.
- Allow replacing or disabling history for document changes while keeping selection changes no-history.
- Clarify whether offsets are intended to be UTF-16, code point, or grapheme positions.

## Licensing Note

Plim packages currently use "Dazza Public License 1.0", not a common permissive SPDX license. It permits applications, plugins, adapters, and private/internal modifications, but distributing a modified library requires keeping the modified library under that license and making its source available. If this becomes a dependency or fork, review the license with the intended distribution model.

## Open Questions

1. Should the integration live as an example app in this repo, a package adapter, or a downstream product experiment first?
    - an example app in the repo
2. Which Plim block catalog should be the target for the first mapping: only our current default metadata, or Plim's richer Notion-like blocks too?
    - Plim's richer Notion-like blocks
3. Do we want Plim block ids to equal Lamport strings directly, or should the adapter maintain an id map? Direct Lamport strings are simpler and probably best.
    - lamport strings
4. How should custom/atomic Plim blocks map into generic `block-crdt` metadata? Is `meta: {type, attrs, ts}` enough, or should this go through app-specific metadata types?
    - yeah our blocks can have whatever metadata we want
5. What is the desired behavior for deleting a block with children: tombstone only that block and splice visible descendants, or delete the whole subtree?
    - tombstone only the block. I realize this is different than Plim, but I like ours better
6. Should undo/redo use `block-crdt` undo planning from day one, or can the first spike disable undo while proving edit translation?
    - we can skip undo for the first spike
7. Is grapheme-correct editing a hard requirement for the first spike, or can it be a known limitation until the adapter shape is validated?
    - we should be grapheme-correct
8. Do we need collaborative remote selections/presence in the Plim view immediately, or only local retained selection after remote document ops?
    - we can start with local retained selection
9. Would upstream Plim accept a controlled-state/CRDT adapter hook, or is a fork more realistic for deep integration?
    - we can always try to upstream
10. Should `block-crdt` expose more path-based helpers, or should adapters always work in block ids plus visible sibling anchors?
    - stick with IDs

## Bottom Line

Start with an adapter, not a fork. Plim already exposes enough state, transaction, and rendering surface to prove the concept externally. The main mismatch is not rendering; it is ownership of authoritative state and stable ids for newly-created blocks. If the spike works, the highest-leverage changes are generic: add block insert/delete helpers to `block-crdt`, and contribute an id-factory / controlled-dispatch affordance to Plim.
