# WhiteboardPanel refactor research

`examples/react-crdt/src/apps/whiteboard/WhiteboardPanel.tsx` is currently doing too much in one file. It is 1,690 lines and combines app orchestration, editor mutations, pointer gesture state, viewport math, ephemeral/presence publishing, archive controls, minimap rendering, element rendering, remote overlay rendering, undo/redo integration, and several pure geometry/view helpers.

The refactor should preserve the existing public app boundary: `WhiteboardApp.tsx` imports and renders `WhiteboardPanel`, so `WhiteboardPanel` can remain the top-level container while most of the behavior moves into smaller colocated modules.

## Current responsibilities

`WhiteboardPanel` itself owns:

- Subscriptions for visible, stroke, surface, and archived element IDs.
- Local UI state: active tool, selection, selected emoji, note color, viewport, active stroke, drag state, local preview, archive visibility, viewport size, minimap drag, and note autofocus.
- Ephemeral publishing, frame coalescing, selection messages, local preview messages, and cleanup.
- Pointer gesture handling for board clicks, pen strokes, panning, moving elements, resizing notes, erasing, wheel zoom, and minimap recentering.
- Mutation commands for creating notes/emojis/strokes, archiving, recovering, and z-order changes.
- Top-level JSX for the panel header, toolbar, archive tray, viewport, canvas, SVG layer, HTML element layer, preview overlays, and minimap.

The same file also defines:

- `UndoRedoButtons`, CRDT/history-specific wrappers, and type guards.
- Element slot components: `ElementSlot`, `StrokeSlot`, `MinimapElement`, `ArchivedElementButton`.
- Element views: `NoteView`, `EmojiView`, `StrokeView`.
- Presence/status UI: `useSelectionStatuses`, `RemoteSelections`.
- Ephemeral support: `hasWhiteboardEphemeral`, `useWhiteboardEphemeral`, `RemoteEphemeralOverlays`, `ElementPreviewOverlay`, `StrokePreviewOverlay`, `SelectionPreviewOverlay`.
- Pure helpers: `elementPreviewData`, `elementPreviewMessages`, `strokePreviewPoints`, `boundsForElement`, `boundsForPreview`, `boundsForElements`, `elementClassName`, `elementStyle`, `previewElementStyle`, `labelForTool`, `nameForElement`.

Some pure whiteboard helpers already live in `helpers.ts`, including board dimensions, path builders, ordering, z-order helpers, coordinate transforms, stroke simplification, and SVG path generation. `ephemeral.ts` already owns the wire/message shape for whiteboard ephemeral data.

## Existing tests

Current focused tests are:

- `helpers.test.ts`: z-order sorting, stroke simplification, and `strokePath`.
- `ephemeral.test.ts`: payload validation and message builders.

There does not appear to be direct component or hook coverage for `WhiteboardPanel`. That makes a structural refactor safest if it is mostly file extraction first, with low-risk pure helper tests added for behavior that moves out of the component.

## Recommended split

Keep `WhiteboardPanel.tsx` as the exported composition root, but shrink it to subscriptions plus composition. A reasonable target is below 300-400 lines after extraction.

Proposed files:

- `constants.ts`
  - `noteColors`, `emojiChoices`, `Tool`, `labelForTool`.

- `geometry.ts`
  - Move panel-local geometry helpers from the bottom of `WhiteboardPanel.tsx`: `boundsForElement`, `boundsForPreview`, `boundsForElements`, `elementPreviewData`, `strokePreviewPoints`.
  - Consider leaving `screenToBoard`, board dimensions, z-order helpers, and `strokePath` in `helpers.ts` unless a broader naming cleanup is desired.

- `elementStyles.ts`
  - `elementClassName`, `elementStyle`, `previewElementStyle`.
  - This keeps UI styling helpers out of geometry and avoids importing React `CSSProperties` in unrelated logic.

- `useWhiteboardEphemeral.ts`
  - `hasWhiteboardEphemeral`, `useWhiteboardEphemeral`, and a `useEphemeralPublisher` hook that owns the requestAnimationFrame coalescing refs and cleanup.
  - This would remove the ephemeral publish bookkeeping from the panel while preserving current behavior.

- `useWhiteboardCommands.ts`
  - Command callbacks for `makeBase`, `addElement`, `addNote`, `addEmoji`, `commitStroke`, `archiveSelected`, `recover`, and `setLayer`.
  - Return stable callbacks and any command-specific state setters that must remain in the panel, such as focus-after-add.

- `useWhiteboardGestures.ts`
  - Board pointer handlers, window pointer listeners for drag/resize/pan, wheel zoom, minimap recentering, and drag-related state.
  - This is the trickiest extraction because it touches editor mutations, viewport state, active stroke state, selection state, local preview state, read-only rules, and ephemeral publishing. It should probably be done after pure helpers and leaf components are extracted.

- `Toolbar.tsx`
  - Header actions can stay separate or share this module.
  - Props should be plain state/callbacks: current tool, note color, emoji, selected ID, archive count, read-only, layer/archive/zoom handlers.

- `UndoRedoButtons.tsx`
  - Move the current undo/redo components and history type guards intact.

- `ArchiveTray.tsx`
  - Archive list rendering plus `ArchivedElementButton`.

- `BoardViewport.tsx`
  - Viewport/canvas shell, board SVG background, stroke layer, element layer, local preview, remote overlays, minimap.
  - It should receive handlers and render data from the panel or gesture hook.

- `ElementViews.tsx`
  - `ElementSlot`, `StrokeSlot`, `NoteView`, `EmojiView`, `StrokeView`, `RemoteSelections`, and `useSelectionStatuses`.

- `EphemeralOverlays.tsx`
  - `RemoteEphemeralOverlays`, `ElementPreviewOverlay`, `StrokePreviewOverlay`, `SelectionPreviewOverlay`.

- `Minimap.tsx`
  - `MinimapElement` and the minimap button/SVG. This can be folded into `BoardViewport` if splitting it separately feels too granular.

## Suggested order

1. Extract pure helpers and constants.
   - Lowest risk and easiest to test.
   - Add tests for bounds and preview data because those are core to selection/drag/remote preview behavior.

2. Extract presentational leaf components.
   - Move `UndoRedoButtons`, element views, archive tray, overlays, and minimap without changing props/behavior.
   - This reduces file size immediately and keeps the stateful panel code visible during review.

3. Extract ephemeral publishing into a hook.
   - Keep the hook small: capability detection, `useEphemeral`, frame-coalesced publish, and cleanup.
   - The panel should not need to know about `pendingEphemeralRef` or `publishFrameRef`.

4. Extract command callbacks.
   - This creates a clean boundary between editor mutations and pointer/UI event code.
   - It also makes later gesture extraction less coupled to z-order, archive, and creation details.

5. Extract gesture/viewport state last.
   - This has the highest regression risk because pointer handlers rely on current React state, refs, read-only mode, and editor snapshots.
   - If this step becomes awkward, stop with a smaller `useElementDrag` and `useBoardViewport` rather than forcing one large hook.

## Behavioral risks to preserve

- `readOnly` still allows select/pan affordances but blocks creation, resize, move, archive, recover, layer changes, and note edits.
- Pointer capture and `preventDefault` behavior should stay intact for pen drawing, minimap dragging, pan, move, and resize.
- Local element previews suppress the committed element visually during drag/resize, then clear on commit/cancel.
- Ephemeral messages are coalesced per frame for high-frequency pointer movement, but immediate clears cancel pending frame work.
- Selection presence is cleared on unmount/read-only/no selection and updated with element bounds when selection changes.
- Note creation still selects and autofocuses the new note.
- Strokes still simplify points and store points relative to the first point.
- Undo/redo behavior must continue to support both CRDT local history and non-CRDT history editors.
- `useValue(editor.$.elements[id])` should stay in per-element slots where possible so one element edit does not force the whole board to re-render.

## Testing opportunities

Add low-cost tests around extracted pure logic:

- `boundsForElement` for note, emoji, and translated stroke points.
- `boundsForPreview` for note resize, emoji fallback size, and stroke preview position.
- `boundsForElements` ignoring missing/archived elements and returning combined bounds.
- `elementPreviewData` including size for notes/emojis and omitting size for strokes.
- `strokePreviewPoints` preserving optional pressure.

Component-level tests are optional for the first refactor because the current repo does not have whiteboard component tests. If added, the highest-value coverage would be:

- read-only mode disables mutation controls but leaves pan/select usable;
- note creation focuses the textarea;
- archive/recover dispatches the expected operations;
- drag/resize publishes preview messages and commits final replace operations.

## Open questions

- How aggressive should this pass be? A conservative extraction can reduce the file substantially without changing state ownership; a full hook-based split will take longer and needs more regression testing.
  -> aggressive
- Should the existing `helpers.ts` be renamed or split? It currently contains both data/model helpers and view/coordinate helpers. Moving more into it may make it too broad.
  -> split sounds good
- Should `noteColors`, `emojiChoices`, pen color, stroke width, minimum note size, and zoom limits become exported constants? They are currently scattered as literals in the component.
  -> yeah let's make a constants.ts or something like that
- Should the refactor also move whiteboard CSS out of the global `examples/react-crdt/src/style.css` file, or is the scope strictly TypeScript/component structure?
  -> let's leave css alone for now
- Is preserving every current UI label required, or can the toolbar be cleaned up while it is being extracted?
  -> yeah cleanup sounds great
- Should ephemeral capability detection remain whiteboard-local, or should app-level ephemeral support be made easier to consume from the shared React CRDT example infrastructure?
  -> making it easier that sounds like a great idea
