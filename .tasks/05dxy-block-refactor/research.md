# Research: Split `examples/block-rich-text/src/App.tsx`

## Goal

`examples/block-rich-text/src/App.tsx` is currently the catch-all file for the block rich text demo. It is about 8,861 lines and mixes app-level history orchestration, the editor panel component, toolbar/popover components, block/table rendering, preview/media rendering, keyboard and clipboard handlers, and many low-level formatting helpers.

The task is to break it into logical files without changing behavior.

## Current Shape

Relevant files:

- `examples/block-rich-text/src/App.tsx`
- `examples/block-rich-text/src/App.test.tsx`
- `examples/block-rich-text/src/typingPerf.test.ts`
- `examples/block-rich-text/src/style.css`
- Existing domain modules such as `blockCommands.ts`, `multiSelectionCommands.ts`, `selectionSet.ts`, `retainedSelection.ts`, `annotations.ts`, `inlineMarks.ts`, `inlineEmbeds.ts`, `attachments.ts`, `previewMetadata.ts`, and `documentFixtures.ts`

`App.tsx` currently contains these major sections:

- `App` route switch: renders `BlogVisualDemos` when `?demos` is present, otherwise renders the editor app.
- `EditorApp`: owns replay/history state, attachments, import/export/reset, fixture replacement, per-editor undo status, key performance samples, transient selections, and renders two `BlockEditor` instances.
- `KeyPerfMonitor`: small UI for recent key latency plus the rainbow Lamport ID toggle.
- `BlockEditor`: the largest section. It owns editor refs, selection restoration, popover state, annotation sidebar state, slash command state, pending retained inline marks, clipboard/image insertion flows, editor command dispatch, drag selection, block selection keyboard handling, table navigation, and the top-level editor panel render.
- Rendering model and render helpers: `RenderTreeNode`, `RenderBlockContext`, `buildRenderTree`, `renderBlockNode`, `renderEditableBlock`, `renderRunNodes`, run chunking, decorators, retained carets, static annotation rendering, and type/meta helpers.
- Table rendering and table hit-testing/drag helpers: `TableBlock`, `renderTableCell`, row/column/cell selection helpers, table drag target helpers, and cell/row slot detection.
- UI components: `Toolbar`, `EditableBlock`, `RichTextEditableSurface`, `BlockAffordance`, `BlockInlineControls`, `AnnotationSidebar`, `Footnotes`, `FloatingAnnotationPopover`, `SlashCommandPopover`, `LinkFloatingPopover`, `DateEmbedFloatingPopover`, `LinkHoverPopover`, `CodeFloatingPopover`, `CodeHoverPopover`, `AnnotationBodyBlock`, `MermaidBlock`, `PreviewBlockCard`, and `ImagePreview`.
- Utility helpers: clipboard payload helpers, selection key/equality helpers, popover positioning, link/code range extraction, inline embed lookup/input formatting, history/key perf labels, image file filtering, block type metadata, ordered list numbering, syntax token range helpers, etc.

Tests currently import:

- `App` from `./App` in `App.test.tsx`.
- `deriveActiveInlineMarks` from `./App` in `typingPerf.test.ts`.

That means a low-risk refactor should keep `App.tsx` as a compatibility facade that exports `App` and re-exports any helpers that tests or other modules already import.

## Recommended File Boundaries

A conservative first split:

- `App.tsx`: keep tiny facade only.
  - `export function App()`
  - `hasDemoQuery`
  - imports `BlogVisualDemos` and `EditorApp`
  - re-export `deriveActiveInlineMarks` for existing tests, or update the test in the same commit.

- `EditorApp.tsx`: move the current `EditorApp` plus app-level history helpers.
  - `actionsSharePrefix`
  - `deriveToolbarUndoState`
  - `removeLast`
  - app-level key perf state/types if not moved to `KeyPerfMonitor`
  - `overlayTransientSelections`
  - `formatKeystroke`

- `BlockEditor.tsx`: move the current `BlockEditor` shell and editor command orchestration.
  - This file will still be large after the first pass, but it is the natural owner for stateful editor behavior.
  - It should import presentational pieces from the new files below.

- `blockEditorTypes.ts`: shared local types that would otherwise create circular imports.
  - `RichFormattedBlock`
  - `RenderedAnnotation`
  - `CommentFocusRequest`
  - `LinkPopoverState`, `CodePopoverState`, `EmbedPopoverState`
  - `PendingInlineMarks`
  - `BlockTypeMenuValue`
  - `RenderTreeNode`
  - `RenderBlockContext`
  - table drag target types
  - key perf sample types if shared by `EditorApp` and `KeyPerfMonitor`

- `blockRenderTree.tsx`: pure block tree/render dispatch.
  - `buildRenderTree`
  - `renderBlockNode`
  - `renderBlockNodeAtRelativeDepth`
  - `withRelativeDepth`
  - `renderEditableBlock`
  - `deriveOrderedListNumbers`
  - `blockTypeMeta`
  - `blockTypeMenuValue`

- `EditableBlock.tsx`: contenteditable block surface.
  - `EditableBlock`
  - `RichTextEditableSurface`
  - `BlockAffordance`
  - `BlockInlineControls`
  - related keyboard/input measurement helpers if tightly coupled

- `runRendering.tsx` or `inlineRunRendering.tsx`: inline run rendering helpers.
  - `renderRunNodes`
  - `renderRunChunkNode`
  - `runRenderChunks`
  - `applyRunClasses`
  - `renderCaretsAtOffset`
  - `renderRetainedCaret`
  - annotation/link/code/sidebar/footnote mark metadata helpers
  - `deriveActiveInlineMarks`
  - syntax token range helpers

- `Toolbar.tsx`: `Toolbar` and toolbar-only constants/types if not shared.

- `KeyPerfMonitor.tsx`: `KeyPerfMonitor`, `formatDuration`, `keyPerfClass`, and key perf constants.

- `slashCommands.tsx`: slash command data and popover UI.
  - `SLASH_COMMANDS`
  - `SlashCommandPopover`
  - `slashCommandId`
  - `canOpenSlashMenuForSelection`
  - `slashTriggersFromInsertResult`
  - `deleteSlashTriggers`
  - slash popover positioning helpers

- `floatingPopovers.tsx`: link/code/embed floating and hover popovers.
  - `LinkFloatingPopover`
  - `LinkHoverPopover`
  - `CodeFloatingPopover`
  - `CodeHoverPopover`
  - `DateEmbedFloatingPopover`
  - link/code/embed trigger and positioning helpers if they are not needed elsewhere

- `annotationViews.tsx`: annotation-specific views.
  - `AnnotationSidebar`
  - `Footnotes`
  - `FloatingAnnotationPopover`
  - `AnnotationBodyBlock`
  - `annotationBodyMarker`
  - `renderStaticRuns`

- `tableRendering.tsx`: table rendering and table hit-testing helpers.
  - `TableBlock`
  - `TableRowHeader`
  - `renderTableCell`
  - table/cell selection helpers
  - table drag target helpers
  - table row/cell slot target helpers

- `blockDropTargets.ts`: non-React block drag/drop hit testing.
  - `blockDropTargetFromPoint`
  - `blockElementFromHitTestElement`
  - `dropTargetForBlockElement`
  - `orderDraggedBlockIds`
  - `orderDraggedBlockIdsForCellSlot`

- `mediaBlocks.tsx`: non-text block previews.
  - `MermaidBlock`
  - `MermaidPreview`
  - `PreviewBlockCard`
  - `ImagePreview`
  - `ensureMermaidInitialized`
  - preview URL validation message helpers

- `editorUiUtils.ts`: generic utilities used by the extracted views.
  - `stopEditorControlEvent`
  - `isJsdom`
  - `imageFilesFromDataTransfer`
  - `isImageFile`
  - `isPlainArrowKey`
  - `isSameClick`
  - selection key/equality helpers
  - `measureInput`, `measureTextInput`, `textInputLabel`, `beforeInputLabel`, `keyboardEventLabel`
  - clipboard read/write helpers if they do not fit better beside `BlockEditor`

## Suggested Refactor Plan

1. Start with leaf components that have mostly prop-based dependencies:
   - `KeyPerfMonitor.tsx`
   - `Toolbar.tsx`
   - `mediaBlocks.tsx`
   - floating popover components

2. Extract shared types before moving the large render helpers. This avoids introducing import cycles between `BlockEditor`, table rendering, run rendering, and annotation views.

3. Move pure helpers next:
   - block type metadata helpers
   - ordered list numbering
   - selection equality/key helpers
   - clipboard and key perf label helpers
   - slash command filtering and trigger helpers

4. Move render helpers in larger chunks:
   - inline run rendering
   - annotation views
   - table rendering
   - editable block surface
   - render tree dispatch

5. Move `EditorApp` out last or near-last. It is straightforward, but keeping it in place while extracting editor internals can reduce churn in the top-level export.

6. Leave `App.tsx` as the stable public entrypoint:

```ts
export {App} from './EditorAppEntry';
export {deriveActiveInlineMarks} from './inlineRunRendering';
```

The exact module name can vary; the key point is preserving existing imports until consumers are intentionally updated.

## Risk Areas

- Circular dependencies are the main risk. `BlockEditor` currently passes a very large `RenderBlockContext` into render helpers, and those helpers call back into editor command closures. Moving the type/context into a shared types file should happen before splitting table/editable/render files.
- Some helpers are currently defined after use and rely on file-level closure availability. Once split, import order is explicit and type-only imports should be used where possible.
- `deriveActiveInlineMarks` is exported from `App.tsx` and used by `typingPerf.test.ts`. Preserve the export or update the test import.
- `mermaid` initialization has module-level state. Keep it in exactly one module, likely `mediaBlocks.tsx`, to avoid duplicate initialization logic.
- The CSS is still monolithic. The task asks to split `App.tsx`, so CSS can remain untouched unless class ownership becomes confusing.
- Tests select DOM by roles/classes from the current rendered output. Avoid renaming classes, labels, roles, button text, and aria labels during this refactor.
- Existing worktree has modified files in this area. Implementation should inspect current diffs before editing and avoid overwriting unrelated changes.

## Verification

Run at least:

```sh
cd examples/block-rich-text
pnpm build
```

Targeted tests:

```sh
pnpm exec vitest -- run src/App.test.tsx src/typingPerf.test.ts
```

If the refactor touches modules imported by command/model tests, broaden to:

```sh
pnpm exec vitest -- run src/*.test.ts
```

## Open Questions

- Should `App.tsx` remain the compatibility entrypoint permanently, or should imports be migrated to `EditorApp.tsx`/new modules after the split?
    - EditorApp & stuff sounds good
- Is the goal only file organization, or is it acceptable to introduce small architectural seams such as a `useBlockEditorController` hook to shrink `BlockEditor` itself?
    - architectural seams would be great
- Should tests be updated to import `deriveActiveInlineMarks` from its new home, or should `App.tsx` continue re-exporting it to reduce test churn?
    - let's update imports
- Should `style.css` also be split by component ownership, or left alone for this task?
    - yeah let's split it too
- How aggressive should the first pass be? A minimal pass can move leaf components and pure helpers; a deeper pass can also split table rendering, annotation rendering, and editable block rendering, but that has more import-cycle risk.
    - let's go deep
