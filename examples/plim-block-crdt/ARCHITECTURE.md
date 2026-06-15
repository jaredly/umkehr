# Plim Block CRDT Architecture

This example uses Plim as the editable view layer for `umkehr/block-crdt`.
The block CRDT state is the source of truth. Plim owns DOM editing,
transactions, commands, keyboard handling, and React integration, but every
meaningful document change is translated into block CRDT operations and then
rematerialized back into a fresh Plim `EditorState`.

At a high level the adapter loop is:

1. Render the current CRDT state as a Plim document.
2. Let Plim produce a transaction from user input.
3. Translate supported Plim transaction ops into block CRDT `Op[]`.
4. Apply those ops to the CRDT state.
5. Convert the resulting CRDT state back into a Plim document and selection.

That means Plim document ids, text spans, paths, offsets, and selections are
treated as view coordinates. CRDT Lamport ids, character ids, block order,
marks, tombstones, split records, and join records are the durable model.

## Main Files

- `src/plimBlockCrdtAdapter.ts` contains the type conversion and transaction
  translation layer.
- `src/plimDemoRuntime.ts` creates the two-replica demo, queues remote ops
  while offline, applies incoming ops, and manages demo undo/redo.
- `src/App.tsx` wires Plim transactions into the adapter and displays both
  replicas.
- `src/fixtures.ts` builds the initial CRDT document used by the example and
  tests.
- `src/plimBlockCrdtAdapter.test.ts` documents the expected conversion behavior
  for materialization, edits, marks, selections, and convergence.

## Data Model Boundaries

### Plim Types

The adapter works with these Plim shapes:

- `EditorState`: `{doc, selection}`.
- `DocumentNode`: root document with top-level `children`.
- `BlockNode`: a visible block with `id`, `type`, optional `attrs`, optional
  `text`, and optional nested `children`.
- `TextSpan`: a string run with optional mark instances.
- `Selection`: anchor/head positions using block paths and UTF-16 offsets.
- `TransactionOp`: view-level editing intents such as `replaceText`,
  `splitBlock`, `insertBlock`, `removeBlock`, `moveBlock`, `toggleMark`, and
  `setSelection`.

Plim addresses blocks by path, for example `[0]` for the first top-level block
or `[0, 0]` for its first child. Text offsets are JavaScript string offsets,
which means UTF-16 code units.

### Block CRDT Types

The block CRDT model uses:

- `CachedState<PlimBlockMeta>` as the local authoritative document state.
- `Op<PlimBlockMeta>[]` as the replication format.
- Lamport ids for blocks, chars, marks, split records, and join records.
- LSEQ block order values for sibling ordering.
- Character tombstones instead of destructive text deletion.
- Timestamped block metadata.
- Retained selections anchored to stable character ids where possible.

The example's block metadata type is:

```ts
export type PlimBlockMeta = {
    type: string;
    attrs?: Record<string, JsonValue>;
    ts: HLC;
};
```

This deliberately mirrors Plim block `type` and `attrs`, while satisfying the
CRDT requirement that block metadata is timestamped.

## State Ownership

`AdapterState` keeps the three pieces needed by the view:

```ts
export type AdapterState = {
    crdt: CachedState<PlimBlockMeta>;
    plim: EditorState;
    retainedSelection: RetainedSelection | null;
};
```

`crdt` is authoritative. `plim` is derived from `crdt` plus the retained
selection. `retainedSelection` is stored separately because a Plim path/offset
selection is not stable across remote edits, splits, joins, or block moves.

`createAdapterState` accepts either raw CRDT state or cached CRDT state and
creates the initial Plim editor state from it. After that, all local and remote
changes flow through the adapter so the derived Plim state stays canonical.

## CRDT to Plim Materialization

`crdtToPlimDocument` converts the visible CRDT outline into a Plim
`DocumentNode`.

The materialization process is:

1. Call `visibleBlockOutline(state)` to get visible blocks in tree order.
2. Call `materializeFormattedBlocks(state)` to get text runs and resolved
   marks per visible block.
3. Create one Plim `BlockNode` per visible CRDT block.
4. Use the CRDT block id string as the Plim block id.
5. Copy `block.meta.type` into `BlockNode.type`.
6. Copy JSON-compatible `block.meta.attrs` into `BlockNode.attrs`.
7. Convert CRDT formatted runs into Plim `TextSpan[]`.
8. Rebuild the nested `children` tree using each outline entry's `parentId`.
9. Remove empty `children` arrays so Plim receives the simpler shape it expects.

The adapter treats these block types as atomic:

```ts
divider, image, embed, raw_html, table
```

Atomic blocks are emitted without `text`, even if CRDT text exists for the
block. They can still carry block type and attrs.

## Plim to CRDT Transaction Translation

`translateTransaction` is the core Plim-to-CRDT function. It receives a base
CRDT state, the base Plim document, a Plim transaction, and adapter options:

```ts
export type AdapterOptions = {
    actor: string;
    ts: () => HLC;
};
```

It returns:

```ts
export type TranslationResult = {
    ops: Op<PlimBlockMeta>[];
    unsupported: TransactionOp[];
    plannedPlim: EditorState;
};
```

The function walks Plim ops in order. After each supported op, it applies the
generated CRDT ops to an in-memory CRDT state and applies the Plim op to a
planned Plim state. This is important because later ops in the same transaction
often refer to paths created or moved by earlier ops.

When the CRDT creates a canonical id, such as from `splitBlockOps` or
`insertBlockOps`, the adapter rewrites the planned Plim block id at that path.
Temporary Plim ids are intentionally discarded.

Unsupported ops are collected in `unsupported`. They are not applied to the
planned Plim state, and `applyLocalTransaction` rematerializes from CRDT state,
so unsupported view changes roll back to the authoritative document.

## Operation Mapping

### Selection

`setSelection` produces no CRDT ops. Selection-only Plim transactions are handled
in `App.tsx` by updating `adapter.plim.selection` and
`adapter.retainedSelection`.

### Text Replacement

Plim `replaceText` maps to:

- `deleteRangeOps` when `from < to`.
- `insertTextOps` for each inserted text span.
- `markSelectionOps` for marks attached to inserted spans.

Plim text offsets are UTF-16 offsets. Block CRDT text offsets are grapheme
offsets. The adapter converts with:

- `utf16OffsetToGraphemeOffset` when reading Plim transaction offsets.
- `graphemeOffsetToUtf16Offset` when resolving CRDT selections back into Plim.

This keeps emoji, combining marks, and other multi-code-unit graphemes from
being split by CRDT operations.

### Block Split

Plim `splitBlock` maps to `splitBlockOps`.

The new block id is generated by the CRDT. If Plim also provides `newType` or
`newAttrs`, the adapter follows the split with `setBlockMetaOps` for the created
block. The new metadata starts from the left block's current metadata and then
overrides type and/or attrs from the Plim op.

The planned Plim state is remapped from Plim's temporary split id to the CRDT
Lamport id so later ops and selection retention point at the canonical block.

### Join Backward

Plim `joinBackward` maps to `joinBlocksOps`.

The adapter resolves the current block and its previous visible block using
Plim paths. The previous block becomes the CRDT `left` block and the current
block becomes the CRDT `right` block. The CRDT join archives the right block and
preserves enough structure for selections and marks to resolve through the join.

### Block Metadata

Plim `setBlockType` maps to `setBlockMetaOps` with a complete metadata object.

Plim `setBlockAttrs` also maps to `setBlockMetaOps`, but merges the new attrs
into the block's existing attrs. Both operations assign a fresh HLC timestamp.

Only JSON-compatible attrs survive translation. Functions, symbols,
non-finite numbers, and other non-JSON values are dropped by `jsonRecord`.

### Block Insert

Plim `insertBlock` maps either to a CRDT block move or a CRDT block insert.

If the incoming Plim block id already exists in CRDT state, is visible, and is
not joined away, the adapter treats the op as a reorder and emits
`moveBlockOps`. This handles Plim transactions that represent a move as
`removeBlock` followed by `insertBlock` of the same id.

If the id does not refer to a live CRDT block, the adapter emits
`insertBlockOps`, then remaps the planned Plim block id to the CRDT-created id.
If the inserted Plim block contains text spans, those spans are inserted into
the new CRDT block using the same text and mark path as `replaceText`.

### Block Remove

Plim `removeBlock` maps to `deleteBlockOps` with `mode: 'block-only'`.

This deletes only the target block. Visible children are spliced upward by the
block CRDT's visible traversal semantics rather than deleted with the parent.

There is one special case: if `removeBlock` is immediately followed by
`insertBlock` with the same block id, the remove is skipped. The following
insert is then treated as a move, preserving the block's text, children,
marks, and concurrent edits.

### Block Move

Plim `moveBlock` maps to `moveBlockOps`.

The adapter resolves the moved block id from the `from` path, then calculates
the destination parent and sibling anchors from the `to` path. When calculating
anchors, the moving block is removed from the sibling list so moves within the
same parent do not count the source block twice.

### Mark Toggle

Plim `toggleMark` maps to `markSelectionOps`.

The adapter currently translates one block range at a time. It also understands
Plim's `to: -1` sentinel as "to end of block". For each range, the adapter
checks whether the mark is already active across the selected text and passes
that state to `markSelectionOps`, which decides whether to add or remove the
mark.

Marks attrs are converted through the same JSON sanitizer as block attrs.

## Paths, Ids, and Sibling Anchors

Plim paths are transient view positions. CRDT block ids are stable Lamport
strings.

The most common path/id conversions are:

- `plimPathToBlockId(doc, path)` uses Plim's `getBlockAt` and returns that
  block's id.
- `visiblePathForBlockId(state, blockId)` finds the current Plim path for a
  visible CRDT block.
- `plimSiblingAnchorsForPath(doc, path, movingId?)` converts a Plim insertion
  path into CRDT `{parent, before, after}` Lamport anchors.

The root block is represented as Lamport `[0, 'root']`, stringified as
`0000-root`.

## Offset Conversion

Plim offsets are UTF-16 code unit offsets because they come from JavaScript
strings and browser editing APIs.

Block CRDT offsets are grapheme offsets because CRDT chars represent visible
grapheme segments. The adapter converts in both directions using the CRDT
helpers backed by `Intl.Segmenter`.

This matters for text like `👩‍💻` or `e\u0301`, where JavaScript string length is
not the same as user-visible character count.

## Selection Retention

Selections are not stored as Plim path/offset pairs across rematerialization.
The adapter converts them into CRDT retained selections:

```ts
type RetainedPoint = {
    blockId: string;
    affinity: 'before' | 'after';
    charId: string | null;
};
```

The flow is:

1. `plimSelectionToBlockSelection` converts Plim path/UTF-16 positions into
   block id/grapheme positions.
2. `retainSelection` converts those positions into stable retained points tied
   to CRDT character ids where possible.
3. After local or remote ops, `resolveSelection` resolves retained points back
   to current block id/grapheme positions.
4. `visiblePathForBlockId` and `graphemeOffsetToUtf16Offset` convert the
   resolved CRDT position back to a Plim `Selection`.

This lets selections survive remote inserts before the cursor, deletes near the
cursor, splits, joins, and block moves better than raw numeric offsets would.

When a retained selection cannot be resolved into the current visible Plim
document, the adapter falls back to the first block at offset `0`.

## Local Transactions

`applyLocalTransaction` wraps translation and rematerialization for local Plim
transactions.

It:

1. Calls `translateTransaction`.
2. Applies translated ops to the CRDT state.
3. Chooses a selection source. If Plim supplied a post-transaction state, that
   state is used after canonicalizing a paste-like collapsed insertion edge
   case.
4. Converts the selected Plim range into a retained CRDT selection.
5. Creates a new Plim editor state from the updated CRDT and retained selection.

The post-Plim state is useful because browser editing and Plim commands can
know the intended final selection more accurately than a purely synthetic
planned state. The adapter still replaces the post-Plim document with the
planned document so canonical CRDT ids are used for retention.

## Remote Operations

`applyRemoteOps` applies incoming CRDT ops with `applyRemoteMany`, then
rematerializes Plim from the resulting CRDT state and the replica's current
retained selection.

Remote ops never go through Plim transactions. This avoids reinterpreting
already-authored CRDT operations as local view-level edits.

`applyRemoteMany` may report pending operations if causal dependencies are
missing. The demo logs the number applied and pending when syncing replicas.

## Demo Replication and History

`plimDemoRuntime.ts` runs two replicas: `left` and `right`. Each replica has:

- an actor id,
- an `AdapterState`,
- online/offline status,
- a queue of outbound op batches,
- undo and redo stacks,
- a simple logical clock for HLC strings.

When both replicas are online, local CRDT ops are immediately applied to the
peer with `applyRemoteOps`. When either side is offline, outbound batches are
queued and flushed later.

Undo and redo are demo-level features built over CRDT inverse planning. A local
edit stores:

- the CRDT state before the edit,
- the generated ops,
- before/after retained selections,
- before/after Plim selections,
- a label for logging.

`applyUndo` and `applyRedo` call `planUndoOps` to generate inverse CRDT ops.
If the inverse plan is incomplete, the action is blocked and logged. When undo
or redo succeeds, the restored selection is reapplied through the adapter.

## Supported Features

The adapter currently supports:

- CRDT-to-Plim materialization of visible block trees.
- Block `type` and JSON-compatible `attrs`.
- Text spans with resolved inline marks.
- Atomic block rendering for selected block types.
- Text insertion, deletion, and replacement.
- Grapheme-correct offset conversion.
- Block splitting and joining.
- Block insertion.
- Block-only deletion with child splicing.
- Block moves and Plim remove/insert reorder patterns.
- Block type changes and attr updates.
- Single-block mark toggles, including Plim's end-of-block sentinel.
- Local selection retention after rematerialization.
- Remote selection resolution after CRDT edits.
- Two-replica op sync with offline queues.
- Demo undo/redo when `planUndoOps` can produce a complete inverse.

## Limitations and Unsupported Features

Unsupported Plim transaction ops are not translated. They are collected in
`unsupported`, skipped in the planned Plim state, and effectively rolled back
when the adapter rematerializes from CRDT state.

Known limitations:

- The adapter only translates the Plim transaction kinds explicitly handled in
  `translateTransaction`.
- Mark toggling is translated per block range. Multi-block formatting depends
  on Plim emitting one `toggleMark` op per block.
- Mark data and block attrs must be JSON-compatible. Unsupported values are
  dropped.
- Atomic blocks preserve type and attrs, but their specialized payloads are not
  modeled beyond generic attrs.
- Tables, images, embeds, raw HTML, and dividers do not have rich custom
  CRDT-specific behavior in this adapter.
- `removeBlock` uses block-only deletion, so deleting a parent does not delete
  its visible children.
- There is no remote presence protocol. Each replica retains its own selection,
  but the UI does not display peer cursors or peer ranges.
- There is no schema validation that maps Plim block types to a constrained CRDT
  schema. The adapter accepts arbitrary string block types.
- Attribute conflict semantics are coarse. The entire block metadata object is
  timestamped; individual attrs do not have independent conflict resolution.
- Nested block behavior follows the visible CRDT outline, but there is no
  Plim-specific schema enforcement for which block types may contain children.
- Unsupported or partially supported complex editor commands may appear to work
  in Plim briefly, then disappear after CRDT rematerialization.
- Undo/redo is best-effort and demo-scoped. It depends on `planUndoOps` support
  for the original operation batch and can be blocked by unsupported inverse
  cases.
- The adapter does not persist CRDT state or queues outside React memory.
- The demo uses local in-process replicas only. It does not include transport,
  authentication, storage, awareness, or server reconciliation.

## Design Consequences

Because CRDT state is authoritative, the adapter favors convergence and stable
ids over preserving Plim's temporary document objects. This has a few practical
effects:

- Plim block ids must be canonicalized after every CRDT-created block.
- Plim paths are never stored as durable references.
- Selection must be retained through CRDT character anchors instead of offsets.
- Remote changes are applied directly as CRDT ops, not replayed through Plim.
- Unsupported Plim operations fail closed by rematerializing from CRDT state.

The result is a deliberately narrow bridge: Plim handles editing UX, while the
block CRDT handles identity, ordering, formatting, replication, and conflict
resolution.
