# Plan: Extract Block Editor and Use It in Block Notes

## Decisions From Research

- Extract the full feature set from `examples/block-rich-text`, not a reduced notes-only editor.
- `src/block-editor` can be specific to the rich editor feature set and `RichBlockMeta` for now. Generic/plugin-based metadata can come later.
- The host connection layer should provide timestamp/session support for editor commands.
- The editor should emit raw block CRDT ops and the host should apply them through `$block.ops`.
- Attachments should live outside the CRDT using the existing `examples/react-crdt` artifact-store pattern.
- Selection presence should be ephemeral/presence data, not persisted document state.
- `block-notes` should use the full toolbar and feature controls.
- Backwards compatibility for existing serialized `BlockRichText` documents is not required.

## Phase 1: Establish Package Boundaries

Goal: make the intended public contracts explicit before moving the large UI.

Tasks:

- Add `src/block-editor/index.ts` as the future public entrypoint.
- Define exported editor types:
  - `RichBlockMeta` and related metadata helpers.
  - `BlockEditorValue` containing `CachedState<RichBlockMeta>` plus retained selection.
  - `BlockEditorChange` containing raw `Op<RichBlockMeta>[]`, next cached state, next retained selection, and optional command metadata.
  - host callback types for timestamps, attachments, presence, undo/redo, and readonly mode.
- Decide the timestamp prop shape. A practical first shape is:

  ```ts
  type BlockEditorClock = {
      actor: string;
      nextTs(): HLC;
      previewTs?(): () => HLC;
  };
  ```

- Add package exports for `./block-editor` and `./block-editor/*` in root `package.json`.
- Add source-development path mappings for `umkehr/block-editor` in both relevant example tsconfigs if needed.

Validation:

- `npm run typecheck` should still pass before any behavioral move.

## Phase 2: Move Editor Domain Modules

Goal: move pure editor logic into `src/block-editor` while keeping `examples/block-rich-text` functional.

Move these modules first:

- `blockMeta.ts`
- `blockEditorTypes.ts`
- `charUtils.ts`
- `localTextOps.ts`
- `markdownShortcuts.ts`
- `virtualParents.ts`
- `selectionModel.ts`
- `retainedSelection.ts`
- `selectionSet.ts`
- `domSelection.ts`
- `inlineMarks.ts`
- `inlineEmbeds.ts`
- `blockCommands.ts`
- `multiSelectionCommands.ts`
- `blockTypeHelpers.ts`
- `blockDropTargets.ts`
- `pollBlocks.ts`
- `annotations.ts`
- `editorCrdtConfig.ts`
- focused utility/render modules that those imports require

Keep demo-only files in `examples/block-rich-text`:

- `blockEditorRuntime.ts`
- `history.ts`
- `undoHistory.ts`
- `editorAppUtils.ts`
- `documentFixtures.ts`
- `documentFormat.ts`
- `BlogVisualDemos.tsx`
- `KeyPerfMonitor.tsx`
- top-level `App.tsx` and demo history controls

Update imports in the example to import moved modules from `umkehr/block-editor`.

Validation:

- Move or update unit tests with their modules where practical.
- Run targeted tests for moved logic, especially `blockCommands`, `multiSelectionCommands`, `selectionSet`, `retainedSelection`, `clipboard`, `annotations`, and `undoHistory`.
- Run `npm run typecheck:examples`.

## Phase 3: Align `src/block-richtext` With Rich Metadata

Goal: make the leaf CRDT wrapper able to store/apply the full editor ops.

Tasks:

- Update `src/block-richtext` command/change types so raw ops and block meta can carry `RichBlockMeta` or JSON-compatible custom metadata instead of being limited to `DefaultBlockMeta`.
- Ensure `$block.ops({ops})` accepts the raw ops emitted by `src/block-editor`.
- Apply rich editor CRDT config where needed, especially metadata merging and virtual parent behavior currently handled by `richTextCrdtConfig`.
- Remove or relax assumptions that would reject rich editor metadata.
- Since backwards compatibility is not required, update initial values if the standard block-rich-text meta should become `RichBlockMeta` paragraphs.

Validation:

- Existing `src/block-richtext` tests pass after type updates.
- Add tests that apply representative raw ops from rich editor commands through the leaf plugin:
  - set rich block meta,
  - table/virtual-parent-related op,
  - annotation-related op,
  - poll metadata merge.

## Phase 4: Extract the React Editor Component

Goal: move the reusable full editor UI out of `EditorApp.tsx`.

Tasks:

- Create `src/block-editor/BlockRichTextEditor.tsx`.
- Extract the current `BlockEditor` component from `examples/block-rich-text/src/EditorApp.tsx`.
- Extract nested render components and helper hooks used by `BlockEditor`, including:
  - editable surface,
  - block render tree rendering,
  - toolbar wiring,
  - floating popovers,
  - slash command UI,
  - media block renderers,
  - annotation body editor,
  - table/slide/poll controls,
  - block reorder handling.
- Replace `replica: Replica` with explicit props:
  - `state: CachedState<RichBlockMeta>`;
  - `selection: RetainedSelectionSet`;
  - `clock: BlockEditorClock`;
  - `readOnly?: boolean`;
  - `attachments` host API;
  - `presence` host API;
  - `onChange(change)`;
  - `onSelectionChange(selection)`;
  - `onUndo` / `onRedo`;
  - optional demo/debug props.
- Keep demo-specific controls out of the reusable component:
  - online/offline toggle,
  - import/export history,
  - fixture replacement,
  - keystroke log,
  - performance monitor.
- Extract CSS used by the editor into `src/block-editor/style.css`, leaving demo shell CSS in the example.

Validation:

- `examples/block-rich-text` renders the same editor through the new component.
- Existing app-level tests still pass or are updated for changed import paths.
- Manual smoke test: typing, formatting, paste, table, annotation, image, slide/poll controls.

## Phase 5: Adapt `examples/block-rich-text`

Goal: keep the original demo as a consumer of the new library component.

Tasks:

- In `EditorApp.tsx`, keep only the demo shell and adapter code.
- Build a `ReplicaBlockEditorAdapter` that maps:
  - `replica.state` to editor `state`;
  - `replica.selection` to editor `selection`;
  - `makeCommandContext` / `nextReplicaTs` to `BlockEditorClock`;
  - emitted raw ops back into `applyLocalChange` history actions.
- Keep demo attachment handling as the first attachment host implementation.
- Keep transient selection overlay behavior in the demo adapter.
- Wire undo/redo buttons to existing demo undo history.

Validation:

- `examples/block-rich-text` should behave like before.
- Existing history/replay import-export tests should continue to cover the demo shell.

## Phase 6: Add Block Notes Artifacts and Presence

Goal: provide the host services that the full editor needs in `examples/react-crdt`.

Tasks:

- Add a block-notes artifact store modeled after `examples/react-crdt/src/apps/wordsearch/artifacts.ts`.
- Define image attachment artifacts:
  - stable attachment id,
  - kind such as `block-notes-image`,
  - version,
  - fingerprint hash,
  - serialized data needed to restore images.
- Register the artifact store on `blockNotesApp.artifacts`.
- Add `BlockNotesEphemeralData` for selection presence:
  - type: `selection`;
  - retained selection payload or a compact serializable representation;
  - optional visible block/anchor info for path scoping.
- Configure `createSyncedContext` for block-notes with `validateEphemeralData`.
- Add helper functions like `selectionMessage(actor, selection)` and `clearSelectionMessage(actor)`, following wordsearch/whiteboard patterns.

Validation:

- Artifact serialization/load tests for block-notes attachments.
- Ephemeral validation tests for block-notes selection messages.

## Phase 7: Integrate Editor Into `block-notes`

Goal: replace the placeholder panel with the full editor.

Tasks:

- Replace `BlockNotesPanel`'s materialized text view and "Insert actor" button with a `BlockRichTextEditor` adapter.
- Adapter responsibilities:
  - read `body` via `useValue(editor.$.body)`;
  - convert with `cachedBlockRichTextValue(body)`;
  - own local retained selection state;
  - pass actor/clock/timestamp support to the editor;
  - apply emitted ops with `editor.$.body.$block.ops({ops})`;
  - update `updatedAt` after edit ops;
  - publish ephemeral selection messages on selection change;
  - read peer ephemeral records and pass them to the editor for remote selection rendering;
  - use block-notes artifact store for image attachments;
  - wire `readOnly`, `editor.undo()`, and `editor.redo()`.
- Preserve the existing `react-crdt` panel shell and responsive layout classes.
- Import `umkehr/block-editor/style.css` or equivalent styles into the app.

Validation:

- Local mode: typing in block-notes updates the document.
- Local sync mode: two panes converge when editing both sides.
- Server/PeerJS modes: raw block ops sync and remote selection presence appears.
- Undo/redo works through the react-crdt document history.
- Image attachment survives archive/export/import through artifacts.

## Phase 8: Test and Polish

Goal: harden the extraction and integration.

Tasks:

- Add/adjust unit tests:
  - `src/block-editor` command/selection/clipboard tests.
  - `src/block-richtext` raw-op and rich-meta tests.
  - `examples/react-crdt` block-notes artifact and ephemeral tests.
- Add smoke/e2e coverage:
  - block-notes local typing and selection retention.
  - block-notes local-sync convergence.
  - block-notes undo/redo.
  - artifact-backed image block where feasible.
- Run:
  - `npm run typecheck`
  - `npm run typecheck:examples`
  - targeted `vitest` suites
  - relevant Playwright smoke tests for `examples/react-crdt`
- Verify UI manually at desktop and mobile widths:
  - toolbar controls do not overflow;
  - popovers position correctly inside the `react-crdt` shell;
  - editor content is not clipped by panel chrome;
  - remote selections and retained selections are visually distinct.

## Risks and Watchpoints

- `EditorApp.tsx` is very large. The safest path is to first extract a component boundary with minimal internal rewrites, then split internal pieces afterward.
- Timestamp/session handling is the highest-risk adapter contract. The editor must generate valid block-crdt ids before raw ops are sent to `$block.ops`.
- Rich metadata and virtual parent config need to be consistent between command generation and leaf-plugin application.
- Attachment storage should not leak object URLs. The artifact store or editor adapter needs lifecycle cleanup similar to the existing example attachment code.
- Presence data must stay bounded. Add validation and byte limits, and avoid publishing on every render.
- Full feature extraction may pull demo assumptions into `src/block-editor`; keep fixture/history/replay/debug code out of the package.

## Completion Criteria

- `src/block-editor` exports the full reusable block rich text editor and supporting types.
- `examples/block-rich-text` consumes `src/block-editor` instead of owning the editor implementation.
- `examples/react-crdt` `block-notes` uses the full editor against its `BlockRichText` CRDT leaf.
- Raw block ops sync correctly in local, local-sync, server, and peer workflows.
- Attachments are handled through artifacts outside the CRDT.
- Selections are retained locally and shared to peers through ephemeral presence, not persisted.
- Typecheck and targeted unit/smoke tests pass.
