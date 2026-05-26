# WhiteboardPanel refactor plan

This plan performs an aggressive structural refactor of `examples/react-crdt/src/apps/whiteboard/WhiteboardPanel.tsx` while preserving behavior and the existing `WhiteboardApp.tsx` import boundary.

The target is:

- keep `WhiteboardPanel` as the exported top-level component;
- split helper logic, constants, leaf components, commands, ephemeral plumbing, and gestures into focused modules;
- leave the global CSS file alone for this pass;
- improve toolbar structure and labels while extracting it;
- make ephemeral support easier to consume through the shared example app/editor abstraction;
- add focused tests for extracted pure logic.

There are existing worktree changes under `.tasks/component-simple` and `src/react-crdt/react-crdt.test.tsx`. Implementation should inspect current diffs before editing shared files and must not revert unrelated user work.

## Phase 1: Constants and Pure Helper Split

Add focused modules under `examples/react-crdt/src/apps/whiteboard/`.

Files:

- `constants.ts`
- `geometry.ts`
- `elementStyles.ts`
- update `helpers.ts` if names/imports need cleanup
- update `helpers.test.ts` or add `geometry.test.ts`

Work:

- Move `noteColors`, `emojiChoices`, `Tool`, `labelForTool`, pen color, stroke width, minimum note size, default note size, default emoji size, initial viewport, minimap dimensions, and zoom limits into `constants.ts`.
- Move panel-local geometry/data helpers into `geometry.ts`:
  - `elementPreviewData`
  - `elementPreviewMessages`
  - `strokePreviewPoints`
  - `boundsForElement`
  - `boundsForPreview`
  - `boundsForElements`
- Move style helpers into `elementStyles.ts`:
  - `elementClassName`
  - `elementStyle`
  - `previewElementStyle`
- Keep existing board dimensions, path helpers, z-order helpers, coordinate transforms, stroke simplification, and `strokePath` in `helpers.ts` unless moving them is needed for clearer imports.

Acceptance:

- `WhiteboardPanel.tsx` no longer defines pure geometry/style/constant helpers.
- Tests cover note/emoji/stroke bounds, preview bounds, combined bounds, preview data, and pressure-preserving stroke preview points.
- Existing helper and ephemeral tests still pass.

## Phase 2: Shared Ephemeral Editor Surface

Make app-level ephemeral support easier to consume from example panels so whiteboard code does not need to type-narrow the editor by checking for `publishEphemeral` and `useEphemeral`.

Files:

- `examples/react-crdt/src/lib/crdtApp.ts`
- possibly app/runtime call sites that depend on `AppEditorContext`
- whiteboard model/app types as needed

Work:

- Extend the example app/editor type layer with an optional or generic ephemeral payload type.
- Ensure CRDT-backed editor contexts can expose:
  - `publishEphemeral(messages)`
  - `useEphemeral(query)`
- Keep history-only editors compatible by making ephemeral unavailable or a typed no-op at the app abstraction boundary.
- Prefer a typed app definition/runtime shape over ad hoc whiteboard-local capability detection.
- Remove `hasWhiteboardEphemeral`, `WhiteboardEphemeralEditor`, and `useWhiteboardEphemeral` from the panel once the new surface is available.

Acceptance:

- Whiteboard can read and publish `WhiteboardEphemeralData` through its editor props without local capability guards.
- Non-CRDT/history mode still compiles and still renders without remote ephemeral overlays.
- No changes are made to the core ephemeral transport semantics.

## Phase 3: Presentational Components

Extract leaf rendering without changing state ownership yet.

Files:

- `UndoRedoButtons.tsx`
- `Toolbar.tsx`
- `ArchiveTray.tsx`
- `ElementViews.tsx`
- `EphemeralOverlays.tsx`
- `Minimap.tsx`
- `BoardViewport.tsx` if useful at this stage

Work:

- Move undo/redo components and CRDT/history type guards into `UndoRedoButtons.tsx`.
- Extract toolbar rendering into `Toolbar.tsx`.
  - Use the constants from `constants.ts`.
  - Clean up button labels/grouping while preserving all current commands.
  - Keep disabled behavior for `readOnly` and no-selection states.
- Extract archive list rendering into `ArchiveTray.tsx`.
- Extract element slots and views into `ElementViews.tsx`:
  - `ElementSlot`
  - `StrokeSlot`
  - `NoteView`
  - `EmojiView`
  - `StrokeView`
  - `RemoteSelections`
  - `useSelectionStatuses`
- Extract remote/local preview overlay rendering into `EphemeralOverlays.tsx`.
- Extract minimap rendering into `Minimap.tsx`.
- If it reduces prop clutter, introduce `BoardViewport.tsx` as the canvas/viewport composition component after the smaller leaves are moved.

Acceptance:

- `WhiteboardPanel.tsx` imports presentational components instead of defining them inline.
- Per-element `useValue(editor.$.elements[id])` subscriptions remain in element slot components so edits stay scoped.
- CSS class names remain unchanged unless the toolbar cleanup strictly requires a local JSX-only adjustment.

## Phase 4: Ephemeral Publishing Hook

Extract frame-coalesced ephemeral publishing and cleanup.

Files:

- `useWhiteboardEphemeral.ts`
- update `WhiteboardPanel.tsx`
- optionally add hook tests only if the repo has a suitable pattern

Work:

- Create a hook that returns:
  - remote records from `editor.useEphemeral({kinds: whiteboardEphemeralKinds})` when available;
  - `publishEphemeral(messages, mode)` where `mode` is `'now' | 'frame'`;
  - cleanup of any pending animation frame.
- Preserve current semantics:
  - immediate publish cancels pending frame publish;
  - frame publish coalesces high-frequency pointer updates;
  - clear messages can publish immediately.
- Keep whiteboard-specific selection clear/update effects in the panel or a small hook, whichever gives the simpler dependency graph.

Acceptance:

- `WhiteboardPanel.tsx` no longer owns `pendingEphemeralRef` or `publishFrameRef`.
- Remote overlays still receive the same records and local pointer movement still publishes previews per frame.

## Phase 5: Command Hook

Extract editor mutation commands.

Files:

- `useWhiteboardCommands.ts`
- update `WhiteboardPanel.tsx`

Work:

- Move creation and mutation callbacks into a hook:
  - `makeBase`
  - `addElement`
  - `addNote`
  - `addEmoji`
  - `commitStroke`
  - `archiveSelected`
  - `recover`
  - `setLayer`
- Keep command inputs explicit: `editor`, `actor`, `readOnly`, selected id, selected emoji, note color, and state callbacks for selection/tool/focus/archive visibility.
- Use constants for note sizes, emoji size, pen color, stroke width, and minimum note size.

Acceptance:

- `WhiteboardPanel.tsx` calls command functions returned from the hook.
- Mutation paths and dispatch payloads are unchanged.
- Note creation still selects and autofocuses the new note.
- Stroke commit still simplifies and stores points relative to the first point.

## Phase 6: Gesture and Viewport Hook

Extract the stateful pointer/viewport behavior last.

Files:

- `useWhiteboardGestures.ts`
- update `WhiteboardPanel.tsx`
- update `BoardViewport.tsx` props if present

Work:

- Move gesture state and handlers into a hook:
  - active stroke
  - drag state
  - local element preview
  - viewport
  - viewport size
  - minimap dragging
  - board pointer down/move/up/cancel
  - element drag start
  - resize start
  - wheel zoom
  - zoom controls
  - minimap recenter and pointer handlers
- Keep `viewportRef` either owned by the hook or passed in from the panel.
- Preserve window-level pointer move/up/cancel listeners for move, resize, and pan.
- Use command hook callbacks for durable commits and geometry helpers for preview data/bounds.
- If one large hook becomes hard to review, split into `useBoardViewport`, `useElementDrag`, and `usePenStroke`.

Acceptance:

- `WhiteboardPanel.tsx` no longer contains raw pointer gesture implementations.
- Read-only behavior is unchanged.
- Drag/resize local previews clear on commit, cancel, missing rect, missing element, or read-only transition.
- Pan and minimap interactions continue to update only local viewport state.

## Phase 7: Final Panel Composition

Trim `WhiteboardPanel.tsx` down to orchestration.

Work:

- Keep subscriptions for visible/stroke/surface/archive IDs in the panel unless `BoardViewport` makes a cleaner owner.
- Keep high-level UI state only where it improves readability: selected id, selected tool, selected emoji, note color, archive visibility, and focus note id.
- Compose:
  - header with `UndoRedoButtons`
  - `Toolbar`
  - `ArchiveTray`
  - `BoardViewport`
- Remove dead imports and duplicate type aliases.
- Keep `WhiteboardApp.tsx` import path unchanged.

Acceptance:

- `WhiteboardPanel.tsx` is primarily composition and should be materially smaller than the current 1,690 lines.
- Public behavior and app registration remain unchanged.

## Phase 8: Verification

Run focused checks after the refactor.

Commands:

```sh
npm run test -- --run examples/react-crdt/src/apps/whiteboard/helpers.test.ts examples/react-crdt/src/apps/whiteboard/ephemeral.test.ts examples/react-crdt/src/apps/whiteboard/geometry.test.ts
npm run typecheck:examples
npm --prefix examples/react-crdt run build
```

If the exact test command differs in this repo, use the package's existing Vitest command from `package.json`.

Manual smoke coverage:

- create note, type text, Enter commits, Escape reverts draft;
- create emoji;
- draw stroke;
- select, move, resize note;
- archive and recover element;
- layer selected element forward/back/front/back;
- zoom buttons, wheel zoom, pan, minimap recenter;
- read-only panel blocks mutations but still allows select/pan affordances;
- two CRDT panels still show remote selection, drag/resize preview, and stroke preview where supported.

## Non-goals

- Do not move whiteboard CSS out of `examples/react-crdt/src/style.css` in this pass.
- Do not change the CRDT document schema or persisted whiteboard state.
- Do not redesign the whiteboard feature set beyond toolbar cleanup.
- Do not change durable CRDT update, undo/redo, or persistence semantics.
