# Research: Zustand for Block Rich Text State

## Goal

Adopt a state-management shape for `examples/block-rich-text` that avoids rerendering every visible block on every selection-only update. Zustand is a good candidate because it gives React components selector-based subscriptions without forcing the document model into React context/provider updates.

The target behavior is:

- A caret move or selection capture rerenders only the blocks whose visible selection decorations changed, plus any toolbar/popover UI that depends on the active selection.
- A text edit rerenders the edited block, structurally affected neighbors/parents, and selection-decorated blocks, not the full document.
- History replay, undo/redo, offline queues, retained selections, annotations, tables, kanban blocks, previews, and attachments keep their current semantics.

## Current State

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/selectionSet.ts`
- `examples/block-rich-text/src/retainedSelection.ts`
- `examples/block-rich-text/src/typingPerf.test.ts`

`EditorApp` owns broad React state: history, attachments, key perf samples, transient selections, history status, undo status, reset signal, and rainbow id mode. The displayed document is recomputed from history and transient selections:

```ts
const demo = useMemo(... replayHistory / applyHistoryAction ...);
const displayDemo = useMemo(
    () => overlayTransientSelections(demo, transientSelections),
    [demo, transientSelections],
);
```

Selection-only commands call `setTransientSelections` from `runCommand` when `result.ops.length === 0`. That means a caret movement changes `displayDemo`, recreates the `replica` prop for the editor, and rerenders the whole `BlockEditor` tree.

Inside `BlockEditor`, the expensive derived values are all computed at the editor component level:

- `materializeFormattedBlocks(replica.state, annotationVirtualParents(replica.state))`
- annotation body filtering and `renderedAnnotations(...)`
- `buildRenderTree(blocks)`
- `charIdsByBlock` for all blocks
- `resolveSelectionSet(replica.state, replica.selection)`
- `decorationsForSelectionSet(...)`
- `blockLevelDecorationsForSelectionSet(...)`
- `deriveActiveInlineMarks(...)`

The block rendering path passes one large `RenderBlockContext` through recursive render helpers. Each `EditableBlock` receives many props, including `selection`, `decorations`, `blockLevelDecoration`, `charIdsByOffset`, drag state, popover maps, command callbacks, and global flags. Even though `RichTextEditableSurface` manually replaces DOM children only when serialized runs change, React still visits every block component after the parent rerenders.

## Why Zustand Fits

Zustand's useful property here is not global state by itself. The useful property is selector subscriptions:

```ts
const block = useEditorStore((s) => s.replicas.left.blockViews[blockId]);
const decorations = useEditorStore((s) => s.replicas.left.selectionDecorationsByBlock.get(blockId));
```

With stable snapshots and shallow/equality checks, a block row can skip React rerendering when unrelated selection decorations, unrelated text, or unrelated UI state changes.

Zustand also has a vanilla store API, which is a good match for code that already has imperative command functions. Commands can call `store.getState()` and `store.setState(...)` without threading a huge callback object through every row. React components can subscribe to slices.

Alternatives:

- A hand-rolled `useSyncExternalStore` store would work and the repo already has a tiny example in `examples/react-crdt/src/lib/store.ts`, but it only supports whole-snapshot subscriptions today. We would need to build selector/equality mechanics that Zustand already provides.
- Jotai could model per-block atoms, but the block CRDT state is already one coherent immutable snapshot. Atomizing it may introduce more synchronization surface than needed.
- Valtio/proxy state is less appealing here because the command layer returns immutable CRDT snapshots and explicit ops. Selector-style immutable snapshots are easier to reason about.
- React context plus `memo` can help, but a changing context or parent render still makes it easy to accidentally fan out through the tree. Zustand gives a clearer boundary.

Recommendation: use Zustand for the example. Keep CRDT command logic as pure functions and store only app/runtime state plus derived view snapshots.

## Proposed Store Shape

Create a local store module, for example `examples/block-rich-text/src/editorStore.ts`.

Use `zustand/vanilla` plus `useStore` from `zustand`:

```ts
type EditorReplicaView = {
    replica: Replica;
    blocks: RichFormattedBlock[];
    blocksById: Map<string, RichFormattedBlock>;
    renderRoots: RenderTreeNode[];
    renderChildrenById: Map<string, string[]>;
    charIdsByBlock: Map<string, string[]>;
    resolvedSelectionSet: EditorSelectionSet;
    primarySelection: EditorSelection;
    decorationsByBlock: Map<string, BlockSelectionDecorations>;
    blockLevelDecorationsByBlock: Map<string, BlockLevelSelectionDecorations>;
    annotations: RenderedAnnotation[];
    popoverTextById: Map<string, string>;
    footnoteNumberById: Map<string, number>;
};

type BlockRichTextStore = {
    history: HistoryState;
    demo: DemoState;
    transientSelections: Partial<Record<EditorId, RetainedSelectionSet>>;
    replicas: Record<EditorId, EditorReplicaView>;
    attachments: AttachmentStore;
    keyPerfSamples: KeyPerfSample[];
    rainbowLamportIds: boolean;
    ui: { ... };
    runCommand(editorId: EditorId, command: (replica: Replica) => MultiCommandResult): void;
    updateSelection(editorId: EditorId, selection: RetainedSelectionSet): void;
    ...
};
```

The exact type names can be adjusted, but the important split is:

- command/runtime state: history, demo, transient selections, attachments;
- per-editor derived view state: block snapshots, render topology, char ids, resolved selections, per-block decorations;
- local ephemeral UI state: popovers, drag state, comment panel state, pending marks.

## Key Implementation Detail: Stable Derived Objects

Selector subscriptions only help if unchanged slices keep referential identity.

A naive derived recompute that creates new `Map` objects and new block view objects for every state change will still wake many subscribers. The store update should intentionally preserve old references where values are equal.

Useful helpers:

- `reuseEqualMapEntries(previous, next, isEqual)` for maps such as `decorationsByBlock`, `blockLevelDecorationsByBlock`, `charIdsByBlock`, `popoverTextById`, and `footnoteNumberById`.
- `sameDecoration(a, b)` for `BlockSelectionDecorations`.
- `sameBlockLevelDecoration(a, b)` for block selections.
- `sameFormattedBlock(a, b)` or object identity reuse from `materializeFormattedBlocks` if available. If materialization always creates new objects, build `blocksById` by comparing `id`, `depth`, `parentId`, `text`, `block.meta`, and run content enough to preserve old per-block references.

For selection-only updates, we should be able to avoid recomputing most document-derived data:

1. Resolve the new retained selection set.
2. Recompute selection decorations.
3. Reuse previous block snapshots, render tree, annotation maps, char ids, and ordered list numbers.
4. Replace only map entries for old/new selected blocks.

For text or structural ops, recompute more broadly first. We can optimize structural invalidation later once the store boundary is in place.

## Suggested Migration Plan

1. Add `zustand` to `examples/block-rich-text/package.json`.

   The example currently has no Zustand dependency. This should update the lockfile from the workspace package manager.

2. Introduce `editorStore.ts` with a vanilla store factory.

   Start by moving `history`, `demo` replay cache behavior, `transientSelections`, `attachments`, `keyPerfSamples`, `rainbowLamportIds`, and existing top-level command actions into the store. Keep the command functions' behavior identical to `EditorApp.runCommand`.

3. Keep `EditorApp` as a thin shell.

   It should create the store once with `useRef`, then subscribe top-level controls to small selectors:

   - history count/cursor
   - key perf samples
   - rainbow flag
   - history/import/export status
   - undo state per editor

4. Split `BlockEditor` into a store-connected editor.

   Instead of receiving a full `replica` prop, pass `editorId` and store reference/context. Subscribe to editor-level slices only where necessary:

   - online/queue status for the editor header
   - active inline marks for toolbar
   - comments/sidebar annotations for comment UI
   - root render ids/topology for the document body

5. Introduce `BlockRow`/`EditableBlockContainer` subscribed by `blockId`.

   The container should select only the data needed by that block:

   - formatted block snapshot
   - block length and char ids
   - attachment for image blocks
   - selection decorations for that block
   - block-level decoration for that block
   - neighbor ids/lengths for caret navigation
   - drag/drop status affecting that block
   - global flags that genuinely affect every block, such as rainbow ids

   Then keep most existing `EditableBlock` and `RichTextEditableSurface` code intact initially.

6. Move command dispatch out of the render context.

   The current `RenderBlockContext` carries many callback props. In the store version, row components can call stable actions from the store or a small actions context. This reduces prop churn and makes `React.memo`/selector subscriptions more effective.

7. Add render-count/perf tests.

   Existing `typingPerf.test.ts` measures command-layer performance, not React render fanout. Add a focused React test or test-only instrumentation to assert that a selection-only update in a large document does not rerender every block. Existing key perf monitor tests around DOM selection updates are useful regression coverage but do not directly prove targeted rendering.

## Risks

- The biggest risk is accidentally storing derived objects that are recreated on every update. Zustand will not fix rerenders unless selectors return stable references for unchanged blocks.
- `App.tsx` is large and tightly coupled. A full rewrite would be risky. The migration should preserve existing behavior and move one state boundary at a time.
- Selection decorations can span many blocks. Cross-block ranges should rerender all touched blocks, but caret moves should only affect old and new caret blocks.
- Table, kanban, annotation, and footnote rendering are structurally nested. Row-level subscriptions need enough topology data to update when a block moves, splits, joins, or changes type.
- Some UI state is genuinely editor-wide: toolbar active marks, slash/link/code/embed popovers, comment sidebars, drag state, and active annotation body selection. Moving all of it to per-block subscriptions is not necessary for the first performance win.
- React 19 and contentEditable interactions require care. `RichTextEditableSurface` relies on layout effects and imperative DOM restoration; that code should remain close to its current behavior during the first migration.

## Open Questions

- Should `transientSelections` remain outside history as today, or should the store hold the displayed selection directly on each replica view and derive persisted history separately?
    - use your judgement
- Should selection-only updates update both the canonical `Replica.selection` and a separate displayed selection, or continue the current overlay model?
    - use your judgement
- Do we want to add Zustand only to the example, or is this a precursor to a reusable state layer for `umkehr/block-richtext`?
    - only example for now
- Is `materializeFormattedBlocks` expected to preserve object identity for unchanged blocks? If not, should we optimize it or perform identity reuse in the example store?
    - use your judgement
- What is the target perf budget for selection-only moves with large docs: max React renders, max commit time, or keypress monitor duration?
    - duration from (keypress) to (finished render) should be <50ms
- Should large-document perf fixtures be added to `documentFixtures` so regressions are easy to reproduce manually?
    - yeah. the 'many blocks' fixture is a good start. feel free to expand, including many rows but with deep (5-level) nesting.
- How should annotation sidebars and footnotes subscribe: as editor-level derived views, or by annotation id/body block id?
    - by IDs I should think
- Should drag/drop state be moved into the store immediately, or left local until document/selection subscriptions are proven?
    - whatever is simpler for the moment

## Verification

Minimum checks after implementation:

- `npm exec vitest -- run examples/block-rich-text/src/typingPerf.test.ts`
- `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`
- `npm run typecheck:examples`

Add at least one new React render fanout test. A practical shape:

1. Load or create a document with many blocks.
2. Instrument `EditableBlock` or `RichTextEditableSurface` render counts behind a test-only hook.
3. Move the caret within one block.
4. Assert only the old/new decoration blocks and editor-level controls rerender, not every block.

Manual verification should include typing, caret movement, cross-block selection, multi-selection, table cell selection, block drag, comments/sidebar annotations, image/preview/code blocks, undo/redo, history import/export, and offline queue replay.
