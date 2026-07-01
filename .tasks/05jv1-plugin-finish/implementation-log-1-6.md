# Implementation Log 1.6: Slide Renderer Extraction

## 2026-06-30

- Added typed slide render services in `src/block-editor/plugins/types.ts`.
  - Includes deck/orphan display state, slide selection/focus helpers, editable target detection,
    viewport registration and measurement, scale/footer helpers, and slide metadata/style updates.
  - Added `onSplit` to public editable-block render options so the slide title split behavior can
    remain plugin-owned.
- Added `src/block-editor/plugins/slideRenderer.tsx`.
  - Moved slide deck overview, outline, presentation, fullscreen controls, orphan slide view/outline,
    slide viewport rendering, footer text, scale calculation, and slide overview options into the
    slides plugin.
  - Slide overview options use the preferred plugin-owned path and call slide services directly
    instead of bridging back to central `BlockOptions`.
- Wired `slidesPlugin` to real renderers:
  - `render:slide-deck`
  - `render:slide`
- Removed hard-coded central slide render branches and migrated slide component/helper definitions
  from `BlockRichTextEditor.tsx`.
- Added focused tests for stable renderer ids plus pure slide helper behavior.

## Issues And Workarounds

- The editor still owns slide state stores and command mutation paths. The plugin renderer calls
  typed services, and those services bridge to existing central state/command logic until command
  extraction happens.
- The `measureElement` service uses React hooks through the render-context service because viewport
  measurement is still tied to editor render state. It is exposed as a context method and called
  during slide viewport render.
- No temporary bridge to central `BlockOptions` was added; slide overview options were duplicated
  narrowly in the slide renderer to avoid keeping core option UI in the slide viewport path.

## Verification

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts src/block-editor/plugins/slideRenderer.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts`
- `rg -n "SlideDeckBlock|OrphanSlideBlock|SlideBlockView|SlideBlockOptions|slideFooterText|calculateSlideScale|useElementSize" src/block-editor/BlockRichTextEditor.tsx`
  returned no matches.
