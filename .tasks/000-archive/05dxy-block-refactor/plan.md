# Plan: Split Block Rich Text App

## Intent

Break `examples/block-rich-text/src/App.tsx` and `style.css` into logical modules without changing editor behavior. This should be a deep refactor, not just a few leaf extractions:

- Move `EditorApp` and supporting app orchestration out of `App.tsx`.
- Introduce architectural seams where they make the code easier to reason about.
- Move tests to import helpers from their real module homes.
- Split CSS by component/domain ownership.
- Keep behavior, DOM roles, labels, class names, and user-visible text stable unless a change is required by the extraction.

## Ground Rules

- Treat existing modified files as user-owned until inspected. Do not revert unrelated work.
- Prefer extraction and relocation over rewriting logic.
- Keep each phase buildable when practical.
- Avoid circular imports by extracting shared types before moving components that depend on each other.
- Keep `App.tsx` as the public app entrypoint, but it does not need to keep compatibility re-exports for test-only helpers.
- Update tests to import moved helpers directly from their new modules.
- Split CSS after component ownership is clear, while preserving class names.

## Phase 0: Baseline And Safety

1. Inspect current diffs in the affected files:
   - `examples/block-rich-text/src/App.tsx`
   - `examples/block-rich-text/src/style.css`
   - tests that import from `App.tsx`
   - any files already modified in this area

2. Capture current symbol boundaries:
   - exported symbols from `App.tsx`
   - local component/function list
   - CSS selector groups and their rough ownership

3. Run a baseline verification if the workspace allows it:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx src/typingPerf.test.ts
```

If baseline tests fail before refactoring, log the failure in `implementation-log.md` and continue only if the failure is clearly unrelated or already understood.

## Phase 1: Shared Types And Pure Utilities

Create shared modules that lower import-cycle risk before moving the large components.

Proposed files:

- `src/blockEditorTypes.ts`
- `src/editorUiUtils.ts`
- `src/blockDropTargets.ts`
- `src/keyPerf.ts`

Move or define:

- `RichFormattedBlock`
- `RenderedAnnotation`
- `CommentFocusRequest`
- popover state types
- `PendingInlineMarks`
- `BlockTypeMenuValue`
- `RenderTreeNode`
- `RenderBlockContext`
- table drag target types
- key perf sample types
- selection equality/key helpers
- pointer/click helpers such as `isSameClick`
- image file helpers
- measurement and key label helpers
- block drag/drop hit-testing helpers
- dragged block ordering helpers

Notes:

- Use `import type` aggressively.
- Keep function bodies unchanged unless TypeScript requires a small signature adjustment.
- Avoid moving helpers into a module that imports `BlockEditor`; utility modules should point inward to domain/model modules, not outward to React shells.

Verification:

```sh
cd examples/block-rich-text
pnpm build
```

## Phase 2: App Shell Extraction

Create:

- `src/EditorApp.tsx`
- `src/KeyPerfMonitor.tsx`

Move:

- `EditorApp`
- app-level history replay/cache code
- import/export/reset/fixture replacement logic
- `deriveToolbarUndoState`
- `actionsSharePrefix`
- `removeLast`
- `overlayTransientSelections`
- `formatKeystroke`
- `KeyPerfMonitor`
- key perf constants and formatting/classification helpers

Leave `App.tsx` small:

```ts
import {BlogVisualDemos} from './BlogVisualDemos';
import {EditorApp} from './EditorApp';

export function App() {
    return hasDemoQuery() ? <BlogVisualDemos /> : <EditorApp />;
}
```

Update tests only where they imported helpers from `App.tsx`; `App.test.tsx` should continue importing `App` from `./App`.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx
```

## Phase 3: Toolbar, Popovers, Slash Commands

Create:

- `src/Toolbar.tsx`
- `src/slashCommands.tsx`
- `src/floatingPopovers.tsx`

Move:

- `Toolbar`
- slash command constants/types/helpers
- `SlashCommandPopover`
- slash trigger extraction/deletion/query logic
- slash popover positioning helpers
- `LinkFloatingPopover`
- `LinkHoverPopover`
- `CodeFloatingPopover`
- `CodeHoverPopover`
- `DateEmbedFloatingPopover`
- link/code/embed trigger helpers and popover position helpers where ownership fits

Notes:

- `BlockEditor` should own state transitions and pass callbacks into these components.
- Popover components should stay presentational where possible.
- If helper ownership is ambiguous, prefer placing the pure helper beside the component that exclusively uses it.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx
```

## Phase 4: Inline Run Rendering And Active Marks

Create:

- `src/inlineRunRendering.tsx`

Move:

- `deriveActiveInlineMarks`
- inline marks by offset helpers
- selection segment helpers used for link/code ranges if appropriate
- `renderRunNodes`
- `renderRunChunkNode`
- `runRenderChunks`
- `RunRenderChunk`
- `renderCaretsAtOffset`
- `renderRetainedCaret`
- `applyRunClasses`
- decorator class helpers
- annotation/link/code/sidebar/footnote mark data extraction helpers
- syntax token range helpers for inline code

Update:

- `typingPerf.test.ts` should import `deriveActiveInlineMarks` from `./inlineRunRendering`.
- Any other moved helper imports should point to the new module directly.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/typingPerf.test.ts src/App.test.tsx
```

## Phase 5: Annotation Views

Create:

- `src/annotationViews.tsx`

Move:

- `AnnotationSidebar`
- `Footnotes`
- `FloatingAnnotationPopover`
- `AnnotationBodyBlock`
- `annotationBodyMarker`
- `renderStaticRuns`

Keep in `BlockEditor`:

- annotation selection state
- comment focus request state
- sidebar open/collapsed state
- command callbacks that mutate document state
- popover controller hook usage, unless a later controller hook naturally absorbs it

Notes:

- Annotation body editing has many command callbacks. Resist changing behavior while extracting.
- Preserve aria labels and class names; `App.test.tsx` heavily depends on them.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx
```

## Phase 6: Media And Specialized Blocks

Create:

- `src/mediaBlocks.tsx`

Move:

- `MermaidBlock`
- `MermaidPreview`
- `MermaidRenderState`
- `ensureMermaidInitialized`
- `sanitizeDomId`
- `errorMessage`
- `PreviewBlockCard`
- `PreviewFetchStatus`
- `previewUrlInvalidMessage`
- `ImagePreview`

Notes:

- Keep Mermaid initialization module-local and single-sourced.
- Keep preview fetch behavior and CORS proxy constant unchanged.
- Image attachment rendering should continue to use the same `AttachmentStore` inputs.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx
```

## Phase 7: Table Rendering

Create:

- `src/tableRendering.tsx`

Move:

- `TableBlock`
- `TableRowHeader`
- `renderTableCell`
- table cell/row/rectangle selection helpers
- table cell border/slot hit-testing helpers
- table row slot target helpers
- table-specific render context helpers

Keep command execution in `BlockEditor`:

- add row/column
- create missing cell
- move cell/row/block commands
- table keyboard movement callbacks

Notes:

- This phase has high circular-dependency risk because table rendering calls back into `RenderBlockContext` and render dispatch.
- If cycles appear, move only pure table helpers first, then the React components after `blockRenderTree.tsx` exists.
- Use type-only imports from `blockEditorTypes.ts` for `RenderBlockContext`.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx src/blockCommands.test.ts src/multiSelectionCommands.test.ts
```

## Phase 8: Editable Block Surface

Create:

- `src/EditableBlock.tsx`

Move:

- `EditableBlock`
- `RichTextEditableSurface`
- `BlockAffordance`
- `BlockInlineControls`
- editable block render options
- block-specific key/input/paste/copy event plumbing that is purely presentational

Keep in `BlockEditor` or controller hook:

- command callbacks
- selection restoration refs
- pending mark state
- live DOM selection reads
- editor-level drag selection state

Notes:

- This file will have a large props surface. That is acceptable initially.
- After extraction, look for groups of props that can become typed callback bundles, but do not combine that with the move unless it is clearly mechanical.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx
```

## Phase 9: Render Tree Dispatch

Create:

- `src/blockRenderTree.tsx`

Move:

- `buildRenderTree`
- `renderBlockNode`
- `renderBlockNodeAtRelativeDepth`
- `withRelativeDepth`
- `renderEditableBlock`
- `deriveOrderedListNumbers`
- `blockTypeMeta`
- `blockTypeMenuValue`

Notes:

- This module will import `EditableBlock`, `tableRendering`, `mediaBlocks`, and inline run rendering.
- Keep the public render API small: ideally `buildRenderTree`, `renderBlockNode`, and block type helpers.
- If `renderBlockNode` and `tableRendering` form a cycle, use an explicit callback in `RenderBlockContext` for child rendering, or keep the minimal recursive dispatch in one module.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx src/typingPerf.test.ts
```

## Phase 10: Introduce Editor Controller Seam

After the presentational/rendering pieces are extracted, shrink `BlockEditor` by moving stateful orchestration into a hook.

Create:

- `src/useBlockEditorController.ts`

Move cohesive groups:

- derived document/render state:
  - materialized blocks
  - annotation body ids
  - annotations by presentation
  - popover text and footnote numbers
  - char IDs by block
  - resolved selection set and decorations

- selection restoration and capture:
  - pending restore refs
  - `scheduleSelectionRestore`
  - `focusBlockSelectionTarget`
  - `captureSelection`
  - `captureMouseDown`
  - drag selection pointer handlers
  - vertical caret intent helpers

- command wrappers:
  - `liveSelectionSet`
  - `runEditCommand`
  - `runBlockControlCommand`
  - inline mark/code toggles
  - paste/copy/image insertion flows
  - link/code/embed popover application
  - block/table selection keyboard handling

Keep `BlockEditor.tsx` as mostly composition:

- refs returned by the hook
- render of editor header, toolbar, document column, annotation sidebar, and floating popovers
- passing hook callbacks/state to child components

Notes:

- This phase is allowed to introduce architectural seams, but still avoid behavioral rewrites.
- If the hook becomes too large, split by responsibility:
  - `useEditorSelectionController`
  - `useEditorClipboardController`
  - `useEditorPopoverController`
  - `useEditorCommandController`

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx src/typingPerf.test.ts
```

## Phase 11: CSS Split

Create CSS files by ownership and import them from a single stylesheet entrypoint or directly from `main.tsx`.

Proposed files:

- `src/styles/app.css`
- `src/styles/history.css`
- `src/styles/keyPerf.css`
- `src/styles/editorPanel.css`
- `src/styles/toolbar.css`
- `src/styles/editableBlock.css`
- `src/styles/table.css`
- `src/styles/annotations.css`
- `src/styles/popovers.css`
- `src/styles/mediaBlocks.css`
- `src/styles/blogVisualDemos.css`

Recommended approach:

1. Keep `src/style.css` as the entrypoint initially.
2. Move selector groups into the new files.
3. Replace `style.css` contents with `@import` statements in stable order.
4. Keep class names and cascade order unchanged.
5. Only after verification consider importing the style files directly from component modules. Direct component imports are optional; the first goal is ownership and readability.

Verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx
```

If a dev server/browser check is useful after CSS splitting:

```sh
npm run dev
```

Then inspect the editor and `?demos` view manually or with browser screenshots.

## Phase 12: Cleanup And Final Verification

1. Remove dead imports and unused helpers.
2. Ensure module names are consistent:
   - React components in `PascalCase.tsx`
   - pure/helper modules in `camelCase.ts`
   - style files grouped under `styles/`
3. Check that `App.tsx` is small and only owns the route switch.
4. Check that `BlockEditor.tsx` is composition-oriented and controller logic is in hooks.
5. Confirm `typingPerf.test.ts` imports `deriveActiveInlineMarks` from its new module.
6. Update `implementation-log.md` with:
   - completed phases
   - verification commands and results
   - issues/workarounds/bugs encountered
   - any intentionally deferred cleanup

Final verification:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/*.test.ts
```

If full test runtime is too high, at minimum run:

```sh
cd examples/block-rich-text
pnpm build
pnpm exec vitest -- run src/App.test.tsx src/typingPerf.test.ts src/blockCommands.test.ts src/multiSelectionCommands.test.ts
```

## Expected End State

- `App.tsx` is tiny and only chooses between `BlogVisualDemos` and `EditorApp`.
- `EditorApp.tsx` owns demo/history/attachment orchestration.
- `BlockEditor.tsx` is primarily composition; dense behavior lives in controller hooks.
- Rendering code is split by domain:
  - editable blocks
  - inline runs
  - tables
  - annotations
  - popovers
  - media/preview blocks
- CSS is split by ownership while preserving cascade and class names.
- Tests import helper functions from their actual modules.
- Build and targeted tests pass.
