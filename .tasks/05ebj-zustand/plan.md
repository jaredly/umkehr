# Plan: Adopt Zustand for Targeted Block Rich Text Rendering

## Decisions

- Use Zustand only inside `examples/block-rich-text` for now.
- Keep CRDT command logic pure and continue using existing command/result types.
- Preserve the current history behavior: selection-only updates stay outside history.
- Prefer a displayed-selection model inside the store over the current external overlay object. The store can still derive history-persisted selections separately from transient displayed selections.
- Because `materializeFormattedBlocks` returns fresh formatted block objects, add example-level identity reuse for per-block view snapshots.
- Perf target: duration from keypress/selection input to finished render should be under 50ms on large fixtures.
- Add or expand manual fixtures, including the existing `many-blocks` fixture and a many-row, 5-level-deep nested fixture.
- Subscribe annotation sidebar/footnote/popover bodies by ids where practical.
- Keep drag/drop local unless moving it into the store is simpler during the row-subscription split.

## Phase 1: Dependency and Store Foundation

1. Add `zustand` to `examples/block-rich-text/package.json` and update the workspace lockfile.

2. Add `examples/block-rich-text/src/editorStore.ts`.

   The initial store should be a vanilla Zustand store with React hooks layered on top. Keep the store example-local and avoid exporting anything through package-level `umkehr` entrypoints.

3. Define the core store state:

   - `history`
   - replay cache equivalent to the current `replayCacheRef`
   - `demo`
   - displayed/transient selection state per editor
   - derived replica views per editor
   - `attachments`
   - key perf samples
   - history/undo status strings
   - reset signal
   - rainbow id flag

4. Port top-level actions from `EditorApp` into the store:

   - run local editor command
   - update selection without appending history
   - toggle online
   - update history cursor
   - undo/redo
   - reset/import/export history state helpers where possible
   - create/merge attachments
   - record keystrokes
   - record key perf samples
   - replace document from fixture

5. Keep behavior identical in this phase. It is acceptable if this phase still rerenders broadly; the goal is to establish a correct single source of state before optimizing subscriptions.

## Phase 2: Derived Replica Views

1. Add a derived view builder for each editor replica.

   It should compute the current values now computed near the top of `BlockEditor`:

   - formatted blocks with annotation bodies
   - annotation body id set
   - visible editor blocks
   - render tree/topology
   - blocks by id
   - child ids by parent/block id
   - ordered root ids
   - char ids by block
   - ordered list numbers
   - resolved selection set
   - primary selection
   - decorations by block
   - block-level decorations by block
   - annotations by id
   - sidebar/popover/footnote annotation id lists
   - popover text by id
   - footnote number by id

2. Add identity reuse helpers.

   Required helpers:

   - reuse unchanged `Map` entries
   - compare char id arrays
   - compare formatted block snapshots deeply enough for rendering
   - compare selection decoration objects
   - compare block-level decoration objects
   - compare annotation view slices where needed

3. Optimize selection-only updates as a special path.

   When only the displayed selection changes:

   - reuse formatted blocks, topology, annotations, char ids, ordered list numbers, and block maps;
   - recompute resolved selections and decoration maps;
   - preserve decoration map entries for blocks whose decoration did not change.

4. For text/structural ops, start with a broad recompute plus identity reuse.

   Do not attempt fine-grained CRDT op invalidation in the first implementation. The per-block identity reuse and selector subscriptions should still limit most React fanout.

## Phase 3: Thin `EditorApp`

1. Change `EditorApp` to create the store once.

   Use a provider/context only for the store object, not for changing editor state.

2. Replace top-level `useState`/`useMemo` ownership with store selectors.

   Suggested components/selectors:

   - `KeyPerfMonitor` subscribes to key perf samples and rainbow flag.
   - history controls subscribe to `history.cursor`, `history.actions.length`, status, and fixture/import actions.
   - editor grid renders `StoreBlockEditor editorId="left"` and `StoreBlockEditor editorId="right"`.

3. Keep existing UI output and user-facing labels unchanged.

4. Preserve cleanup behavior for attachments.

   The current `EditorApp` revokes attachments on unmount and when replacing/importing history. Keep equivalent lifecycle logic in the store shell or store actions.

## Phase 4: Store-Connected Editor Shell

1. Split `BlockEditor` into a store-connected wrapper and a mostly presentational editor internals component.

   Initial props should shrink to:

   - `editorId`
   - store action access
   - stable refs/local UI state that should remain local

2. Subscribe editor-level UI to editor-level selectors:

   - online state and queued op count
   - undo state/status
   - selected block type
   - active inline marks
   - annotation id lists
   - active popover ids/positions
   - root render topology ids

3. Keep local state local where it does not cause global block fanout:

   - pending DOM restore refs
   - focus flags
   - drag gesture refs
   - hover timers
   - slash/link/code/embed popover edit drafts if moving them is not needed

4. Replace direct `replica` prop usage with selectors and `store.getState()` inside command dispatch.

   Command callbacks should remain stable and read the latest replica from the store at execution time.

## Phase 5: Per-Block Subscriptions

1. Introduce a `BlockNode` or `BlockRowContainer` component keyed by `editorId` and `blockId`.

2. Replace recursive rendering of formatted block objects with recursive rendering of ids/topology.

   The tree should pass ids, not large per-render context objects. Each row subscribes to its own data.

3. The per-block selector should return a stable object containing only that block's render needs:

   - formatted block snapshot
   - block meta
   - block length
   - char ids by offset
   - attachment for image blocks
   - selection decoration for this block
   - block-level decoration for this block
   - previous/next editable block ids and lengths
   - ordered list number
   - relevant drag/drop state for this block
   - relevant annotation/popover/footnote maps or ids
   - global flags that genuinely affect this block, such as rainbow ids

4. Use selector equality.

   Use Zustand's equality support or shallow comparison so rows are not notified when the selected slice is referentially and structurally unchanged.

5. Keep `EditableBlock` and `RichTextEditableSurface` mostly unchanged at first.

   Their current imperative DOM rendering and selection restoration are delicate. Make the subscription boundary around them before doing any component-level refactors.

6. Move command dispatch out of `RenderBlockContext`.

   Replace the large context object with stable store actions or narrow action hooks.

## Phase 6: Annotation, Footnote, Table, and Kanban Refinement

1. Subscribe annotations by ids.

   Sidebar, footnotes, and floating popovers should render from annotation id lists and subscribe to each annotation/body view by id. This avoids rebuilding all annotation UI when unrelated blocks update.

2. Keep table and kanban topology id-based.

   - Table blocks subscribe to row ids and column count.
   - Row components subscribe to cell ids.
   - Cells render block rows by id.
   - Kanban boards subscribe to column ids.
   - Columns subscribe to card ids.

3. Keep drag/drop local unless the id-based topology makes a store representation simpler.

   If moved to the store, expose per-block derived drag/drop status so only affected rows rerender during drag.

## Phase 7: Fixtures and Perf Instrumentation

1. Expand fixtures in `documentFixtures.ts`.

   Add at least one fixture beyond `many-blocks`:

   - many rows with 5-level nesting;
   - enough total blocks to make fanout obvious;
   - mixed block types only if it does not make the fixture too noisy.

2. Update `documentFixtures.test.ts`.

   Assert the new fixture imports and has the expected scale/depth.

3. Add render fanout instrumentation.

   A low-risk approach is a test-only render counter callback or module-level test hook around `EditableBlock` or `RichTextEditableSurface`.

4. Add a React test for selection-only updates.

   Test shape:

   - load `many-blocks` or the new deep fixture;
   - reset render counters after initial load;
   - perform a caret move or block selection;
   - assert elapsed time is under 50ms;
   - assert the number of rerendered block surfaces is bounded and clearly less than all visible blocks.

5. Keep the existing many-block selection timing test, but make it use the new store path.

## Phase 8: Verification and Cleanup

1. Run focused tests frequently during migration:

   - `npm exec vitest -- run examples/block-rich-text/src/documentFixtures.test.ts`
   - `npm exec vitest -- run examples/block-rich-text/src/typingPerf.test.ts`
   - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx`

2. Run typechecking:

   - `npm run typecheck:examples`

3. Manual smoke checks:

   - type text in both editors;
   - move caret with arrows and mouse;
   - create cross-block range selections;
   - use multi-selection;
   - select and edit table cells;
   - drag blocks;
   - edit comments/sidebar annotations;
   - verify footnotes and popovers;
   - edit code, preview, image, table, and kanban blocks;
   - undo/redo;
   - import/export history;
   - toggle editor online/offline and flush queued ops.

4. Clean up old state plumbing after tests pass.

   Remove now-unused overlay helpers, broad prop threading, and stale memoization that the store has replaced.

## Implementation Notes

- Do not optimize command-layer CRDT performance as part of this task unless a test exposes a regression introduced by the store migration.
- Avoid changing behavior and state architecture in the same edit when possible. Move first, then narrow subscriptions.
- Zustand will only help if selectors return stable references. Treat identity reuse as part of correctness for this migration.
- Keep user-visible app behavior and fixture labels stable except for newly added fixtures.
