# Plan: Plim Integration With `umkehr/block-crdt`

## Decisions

- Build the first integration as an example app in this repo.
- Target Plim's richer Notion-like block catalog, not only the current `DefaultBlockMeta`.
- Use block CRDT Lamport string ids directly as Plim block ids.
- Store Plim block type and attrs in block metadata, e.g. `{type, attrs, ts}`.
- Use block-only deletion semantics. `removeBlock` tombstones only the target block and lets visible descendants splice upward.
- Skip undo/redo in the first spike.
- Be grapheme-correct from the start.
- Support local retained selection after rematerialization and remote document ops. Defer collaborative presence.
- Prefer ids over durable path logic. Use Plim paths only as short-lived transaction addresses.
- Try to upstream Plim affordances after the adapter proves useful.

## Phase 0: Baseline And Dependency Setup

Goal: create a runnable example shell without committing to the adapter shape too early.

1. Decide the example location.
   - Recommended: `examples/plim-block-crdt`.
   - Keep it separate from `examples/block-rich-text` so Plim-specific assumptions do not leak into the existing editor demo.

2. Add package wiring.
   - Add `examples/plim-block-crdt/package.json`.
   - Add Vite/React/TypeScript config matching the other examples.
   - Add dependencies on `@plim/core`, `@plim/editor`, `@plim/react`, and any Plim style package required by the published example.
   - Use local `umkehr` package imports through workspace/build conventions already used by other examples.

3. Confirm Plim APIs against the installed version.
   - Verify `PlimEditor`, `deriveEditor`, `EditorHandle.getState()`, `EditorHandle.setState(...)`, and `EditorHandle.onTransaction(...)`.
   - Record any API mismatch in `block-crdt-additions-implementation-log.md` or a new Plim integration log.

4. Add a minimal example screen.
   - Render a Plim editor from a static Plim `DocumentNode`.
   - No CRDT yet.
   - Verification: example app starts and editing plain Plim content works.

## Phase 1: Adapter Types And Metadata Model

Goal: define the shared adapter contract before translating edits.

1. Create an adapter module.
   - Suggested path: `examples/plim-block-crdt/src/plimBlockCrdtAdapter.ts`.
   - Export pure functions where possible so they can be unit-tested without DOM.

2. Define metadata.
   - Add a Plim-oriented block meta type:

```ts
export type PlimBlockMeta = {
    type: string;
    attrs?: Record<string, JsonValue>;
    ts: HLC;
};
```

   - Keep `type` aligned with Plim block type names.
   - Store unknown/custom attrs as JSON-compatible values.
   - Do not add Plim transaction types to `src/block-crdt`.

3. Define adapter state.
   - Track canonical `CachedState<PlimBlockMeta>`.
   - Track actor id and timestamp generator.
   - Track local retained selection using the new block CRDT `retainSelection` / `resolveSelection` helpers.
   - Track an `isApplyingFromCrdt` guard so `setState(...)` does not recursively translate its own rematerialized state.

4. Define conversion helpers.
   - `lamportStringForPlimId(id: string): string`
   - `blockIdFromPlimBlock(block.id): string`
   - `blockPathFromPlimDoc(doc, blockId): number[] | null`
   - `blockAtPath(doc, path): BlockNode | null`
   - Keep these local to the adapter/example.

## Phase 2: Read-Only Materialization

Goal: render a block CRDT document as a Plim document.

1. Implement `crdtToPlimDocument(state): DocumentNode`.
   - Use `visibleBlockOutline(state)` to get visible block order and depth.
   - Use `materializeFormattedBlocks(state)` for text runs and marks.
   - Rebuild nested `children` from outline depth/parent ids.
   - Set each Plim `BlockNode.id` to the CRDT Lamport string.

2. Convert metadata.
   - `block.meta.type` -> `BlockNode.type`.
   - `block.meta.attrs` -> `BlockNode.attrs`.
   - Unknown or missing metadata should fall back to a paragraph-like block in the example, but keep the original metadata in CRDT state.

3. Convert text and marks.
   - `FormattedRun.text` -> Plim `TextSpan.text`.
   - `FormattedRun.marks` -> Plim mark instances.
   - Start with bold, italic, code, link, underline/strike if Plim exposes those mark names.
   - Preserve unknown mark data when possible; otherwise document the unsupported mark.

4. Seed documents.
   - Add a fixture that includes nested blocks, marks, atomic/custom blocks, and emoji/combining-mark text.
   - Render it through Plim.

5. Tests.
   - Unit-test `crdtToPlimDocument` with a pure CRDT fixture.
   - Snapshot the resulting Plim JSON shape.
   - Assert Lamport ids are used as Plim ids.
   - Assert grapheme text is preserved byte-for-byte.

## Phase 3: Plim Path/Offset To CRDT Position Conversion

Goal: make every Plim transaction address stable CRDT ids before producing ops.

1. Implement short-lived path resolution.
   - `plimPathToBlockId(preTransactionDoc, path): string | null`.
   - `plimSelectionToBlockSelection(preTransactionDoc, selection): {anchor, focus} | null`.
   - Use the pre-transaction Plim state captured before applying a Plim transaction, not the post-rematerialized state.

2. Implement grapheme offset conversion.
   - Given a Plim block/path and UTF-16 offset, read that block's visible text from the pre-transaction Plim doc.
   - Convert UTF-16 offsets with `utf16OffsetToGraphemeOffset`.
   - Convert resolved CRDT grapheme offsets back to Plim UTF-16 offsets with `graphemeOffsetToUtf16Offset`.

3. Implement selection rematerialization.
   - Resolve CRDT retained selection with `resolveSelection(state, retained)`.
   - Convert each resolved `{blockId, offset}` to Plim `{path, offset}`.
   - Use `visiblePathForBlockId` or local doc traversal to find the path.
   - Convert grapheme offsets to UTF-16 offsets before assigning Plim selection.

4. Tests.
   - Path lookup for nested blocks.
   - Conversion through emoji, combining marks, and ZWJ sequences.
   - Retained caret after remote insert before caret.
   - Retained caret after block split/join.

## Phase 4: Local Transaction Translator

Goal: translate a conservative, useful subset of Plim edits into block CRDT ops.

1. Capture transaction context.
   - Before Plim applies a user transaction, keep the current CRDT state and current Plim state as the translation base.
   - If Plim only exposes post-transaction `onTransaction`, keep an adapter-owned `lastPlimState` from before the callback and update it only after CRDT rematerialization.

2. Implement `translatePlimTransaction(base, tx): Op<PlimBlockMeta>[]`.
   - Use `insertTextOps` for text insertion.
   - Use `deleteRangeOps` for text deletion.
   - For replace operations, emit delete ops first, then insert ops against the state after deletion when necessary.
   - Use `splitBlockOps` for `splitBlock`.
   - Use `joinBlocksOps` for `joinBackward`.
   - Use `insertBlockOps` for `insertBlock`.
   - Use `deleteBlockOps(..., {mode: 'block-only'})` for `removeBlock`.
   - Use `moveBlockOps` for `moveBlock`.
   - Use `setBlockMetaOps` for `setBlockType` and `setBlockAttrs`.
   - Use `markSelectionOps` for mark toggles.

3. Block creation details.
   - Since `insertBlockOps` and `splitBlockOps` allocate CRDT ids, ignore Plim's temporary random ids.
   - After applying generated CRDT ops, rematerialize immediately so Plim sees the canonical Lamport ids.
   - Extract created block ids from emitted `block` ops when selection should move to a newly created block.

4. Mark toggle details.
   - Determine add vs remove by inspecting current materialized marks across the selected range.
   - Emit one op per visible block segment through `markSelectionOps`.
   - Skip empty ranges.

5. Unsupported operations.
   - For unrecognized transaction ops, do not mutate CRDT state.
   - Rematerialize from CRDT to roll Plim back to canonical state.
   - Log the unsupported op in development builds.

6. Tests.
   - Pure translator tests for each supported transaction type.
   - Verify emitted ops apply cleanly with `applyMany`.
   - Verify generated Plim document after rematerialization matches expected content.
   - Include grapheme text insertion/deletion.
   - Include block-only delete with children spliced upward.

## Phase 5: Adapter Runtime And Example App

Goal: wire the pure adapter into a usable Plim-backed CRDT editor.

1. Implement `usePlimBlockCrdt`.
   - Inputs: initial `State<PlimBlockMeta>` or `CachedState<PlimBlockMeta>`, actor id, timestamp generator, optional remote send callback.
   - Outputs: Plim editor props/handle, current CRDT state, local op dispatch function, remote op apply function.

2. Local edit flow.
   - Plim transaction occurs.
   - Adapter translates transaction against base state.
   - Adapter stores retained local selection.
   - Adapter applies CRDT ops with `applyMany`.
   - Adapter emits ops to caller for persistence/replication.
   - Adapter rematerializes Plim state and restores resolved selection.

3. Remote edit flow.
   - Caller passes remote `Op[]` to adapter.
   - Adapter applies with `applyRemoteMany`.
   - Pending ops are returned or stored for retry by the caller.
   - Adapter resolves retained local selection and rematerializes Plim.

4. Prevent feedback loops.
   - Set `isApplyingFromCrdt = true` before `editor.setState(...)`.
   - Ignore Plim transaction callbacks triggered by rematerialization.
   - Reset the guard after Plim confirms state update.

5. Example UI.
   - Show one Plim editor backed by CRDT.
   - Add debug panels for current CRDT ops/state and materialized Plim JSON.
   - Add buttons for applying scripted remote ops to validate retained selection.
   - Do not build collaborative presence yet.

6. Tests.
   - React/Vitest component tests for local insert, split, join, block insert/delete, mark toggle.
   - Remote op tests that keep local selection stable.
   - Regression tests that Plim temporary ids are replaced by Lamport ids after rematerialization.

## Phase 6: Remote/Concurrency Scenarios

Goal: prove the example behaves like a CRDT-backed editor, not only a local editor.

1. Add a two-replica harness.
   - Two adapter instances with different actor ids.
   - Shared initial CRDT state.
   - Manual op exchange in both orders.

2. Cover convergence cases.
   - Concurrent text inserts in the same block.
   - Remote delete before local retained caret.
   - Concurrent split and insert.
   - Concurrent move and delete of the same block.
   - Concurrent inserts between the same sibling anchors.
   - Mark add/remove conflicts.

3. Cover Plim rematerialization behavior.
   - Active editor selection survives remote text insert/delete.
   - Selection inside joined right block resolves into left block text.
   - Selection inside moved block stays in the moved block.
   - Deleted block fallback lands on a visible nearby block.

4. Pending remote ops.
   - Surface `applyRemoteMany(...).pending` in the example debug UI.
   - Retry pending ops after missing dependencies arrive.
   - Add a test for a remote child block op arriving before its parent.

## Phase 7: Polish, Docs, And Known Limits

Goal: make the example useful to future adapter work without pretending it is production-complete.

1. Document the adapter.
   - Add `examples/plim-block-crdt/README.md`.
   - Explain authoritative CRDT state and Plim-as-view-cache.
   - Document Lamport ids as Plim ids.
   - Document block-only delete mismatch with native Plim semantics.
   - Document undo/redo intentionally skipped for the first spike.

2. Document unsupported Plim operations.
   - Keep a table of transaction ops: supported, partially supported, unsupported.
   - Note any block types or marks that are lossy.

3. Add package scripts.
   - Example dev script.
   - Example typecheck script.
   - Focused adapter tests.

4. Run verification.
   - `npm run build`
   - `npm run typecheck`
   - Block CRDT tests.
   - Example tests.
   - Manual browser smoke test for text, blocks, marks, remote scripted ops, and grapheme input.

## Phase 8: Upstream/Fork Decision

Goal: decide whether the adapter is good enough without Plim changes.

1. Evaluate friction after the example works.
   - Does post-transaction observation cause visible flicker or broken extension behavior?
   - Do random temporary block ids cause real state loss?
   - Does Plim history interfere even when undo is skipped?
   - Are grapheme conversions reliable through Plim's DOM pipeline?

2. If needed, propose upstream Plim changes.
   - Id factory or explicit ids for transactions that create blocks.
   - Controlled dispatch hook where host returns authoritative next state.
   - Public path/id lookup helpers.
   - Document-history disable/customization hook.
   - Clarified offset metric or grapheme offset option.

3. Keep fork as fallback.
   - Only fork if the adapter cannot be made robust through public APIs and upstream hooks are unavailable.
   - Re-check the Dazza Public License distribution requirements before publishing a modified Plim package.

## Definition Of Done For The Spike

- The example app renders a block CRDT document through Plim.
- Local Plim edits translate to CRDT ops and rematerialize back into Plim.
- Supported operations include text replace, split, join, insert block, remove block, move block, metadata update, and mark toggle.
- Block ids in Plim are canonical Lamport strings after every adapter cycle.
- Grapheme offsets are correct for emoji, combining marks, and ZWJ sequences.
- Remote ops can be applied and local retained selection survives common remote edits.
- Undo/redo and collaborative presence are explicitly documented as out of scope.
- Tests cover pure materialization, pure transaction translation, retained selection rematerialization, and at least one two-replica convergence harness.
