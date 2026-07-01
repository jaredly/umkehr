# Plan 1.6: Slide Renderer Extraction

## Goal

Move slide rendering execution out of `BlockRichTextEditor.tsx` and into the slides plugin, while
preserving current behavior for:

- slide deck overview, outline, and presentation modes;
- orphan slide view/outline modes;
- fullscreen presentation state;
- slide selection/focus behavior;
- slide scaling and footer rendering;
- add-slide behavior;
- slide title/body relative-depth rendering;
- slide option controls in overview mode.

This plan continues `plan-1.md` phase 6 after columns were extracted. It assumes the current
renderer bridge exists:

- `BlockEditorRenderedBlockNode`
- `BlockEditorBlockRenderContext`
- `children: 'renderer'`
- `context.blocks.renderEditableBlock(...)`
- `context.blocks.renderNodeAtRelativeDepth(...)`
- `context.dragDrop.*`
- `context.decorations.*`

## Current Slide Ownership

`slidesPlugin` still declares placeholder structural renderers in `src/block-editor/plugins/slides.ts`:

- `render:slide-deck`
- `render:slide`

The actual rendering still lives centrally in `BlockRichTextEditor.tsx`:

- `SlideDeckBlock`
- `SlideFullScreenControls`
- `SlideDeckToolbar`
- `OrphanSlideBlock`
- `SlideBlockView`
- `SlideBlockOptions`
- `slideFooterText`
- `calculateSlideScale`
- `useElementSize`

The central `renderBlockNode` still hard-codes:

- `slide_deck` -> `SlideDeckBlock`
- orphan `slide` -> `OrphanSlideBlock`

## Design Targets

- `slidesPlugin` should own actual `slide_deck` and `slide` block renderers.
- Both slide deck and orphan slide renderers should declare `children: 'renderer'`.
- Core should keep common block row chrome where possible, but slide viewport rendering may still
  contain slide-specific selection and presentation surfaces.
- Plugin renderers may import existing central/shared helpers during this extraction if that avoids
  premature churn, but avoid importing `BlockRichTextEditor.tsx`.
- `BlockRichTextEditor.tsx` should provide slide services through `context.slides`, not direct
  component props.
- Existing central fallback branches can remain until both plugin renderers return real output, then
  slide-specific branches should be removed from `renderBlockNode`.

## Phase A: Define Slide Render Services

Replace the current untyped `BlockEditorSlideRenderServices = Record<string, unknown>` with a typed
public service in `src/block-editor/plugins/types.ts`.

Add public types:

- `BlockEditorSlideDeckDisplayMode = 'presentation' | 'overview' | 'outline'`
- `BlockEditorOrphanSlideDisplayMode = 'view' | 'outline'`
- `BlockEditorSlideDeckUiState = {mode; currentSlideId; fullScreen}`
- `BlockEditorElementSize = {width; height}`

Add services:

- `deckUiForBlock(deckId): BlockEditorSlideDeckUiState`
- `setDeckUiForBlock(deckId, update)`
- `orphanModeForBlock(slideId): BlockEditorOrphanSlideDisplayMode`
- `setOrphanModeForBlock(slideId, mode)`
- `addSlideToDeck(deckId, afterSlideId?)`
- `selectSlideBlock(slideId, options?)`
- `isCurrentBlockSelection(blockId): boolean`
- `isEditableSurfaceEventTarget(target): boolean`
- `registerSlideViewport(slideId, element)`
- `measureElement<T extends HTMLElement>(): [(element: T | null) => void, BlockEditorElementSize]`
- `calculateScale(viewport, deckSize): number`
- `footerText(footer, deckTitle, slideIndex, slideCount): string`
- `setSlideTitleVisibility(slideId, showTitle)`
- `setSlideTransition(slideId, transition)`
- `setBlockStyle(blockId, attribute, value)`

Notes:

- `measureElement` can initially wrap the existing `useElementSize` logic, but the hook must live in
  a module that plugin components can import or be exposed as a context method that is safe to call
  during render.
- `selectSlideBlock` must preserve the current `{constrainFullscreenSlideSelection: false}` behavior
  when deck mode changes into presentation mode.
- `isEditableSurfaceEventTarget` should preserve the current `eventFromEditableSurface(...)`
  behavior without requiring plugins to import editor internals.

Verification:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`

## Phase B: Move Pure Slide Helpers

Create a plugin-owned helper/component module, likely:

- `src/block-editor/plugins/slideRenderer.tsx`

Move or duplicate pure helpers into that module:

- `calculateSlideScale`
- `slideFooterText`
- `useElementSize` if not exposed by context
- `SlideFullScreenControls`
- `SlideDeckToolbar`

Keep helper semantics identical:

- invalid or zero slide/viewport dimensions return scale `1`;
- footer text preserves current deck-title / slide-number combinations;
- toolbar labels and button disabled states stay unchanged;
- fullscreen controls preserve current keyboard/mouse behavior where applicable.

Verification:

- Typecheck.
- Add focused unit tests for `calculateSlideScale` and `slideFooterText` if they are exported.

## Phase C: Implement `slide_deck` Renderer

Add `slideDeckBlockRenderer` in `slideRenderer.tsx`.

Renderer behavior:

- `id: 'render:slide-deck'`
- `blockType: 'slide_deck'`
- `children: 'renderer'`
- returns `null` when `node.block.block.meta.type !== 'slide_deck'`

Preserve current behavior:

- derive `slides` from direct children whose meta type is `slide`;
- read deck UI from `context.slides.deckUiForBlock(node.id)`;
- validate `currentSlideId` against actual slide children;
- compute `currentIndex`, `currentSlide`, and `deckTitle`;
- selecting presentation mode selects the current slide block;
- previous/next navigation updates current slide and selects it in presentation mode;
- fullscreen toggles via `requestFullscreen` / `exitFullscreen`;
- `fullscreenchange` reconciles stored `fullScreen` state;
- presentation key handling:
  - advance on `ArrowRight`, `PageDown`, and space;
  - go back on `ArrowLeft` and `PageUp`;
  - exit fullscreen on `Escape` unless event came from an editable surface.

Rendering modes:

- `outline`
  - render toolbar;
  - render deck title editable surface with `surfaceClassName: 'slideDeckTitleText'`;
  - render all children through `context.blocks.renderChildren(node)`.
- `overview`
  - render deck header and toolbar;
  - render every slide via the slide view component in overview mode.
- `presentation`
  - render only current slide via the slide view component;
  - render fullscreen controls only when `ui.fullScreen` is true.

Important detail:

- Because the deck renderer consumes children, it must render non-slide children in outline mode
  exactly as before. In overview/presentation mode it should only render slide children, matching
  current behavior.

Verification:

- Existing structural/default tests.
- Add or update focused render tests for deck outline, overview, and presentation mode if a render
  test harness exists.

## Phase D: Implement Orphan `slide` Renderer

Add `slideBlockRenderer` in `slideRenderer.tsx`.

Renderer behavior:

- `id: 'render:slide'`
- `blockType: 'slide'`
- `children: 'renderer'`
- returns `null` when `node.block.block.meta.type !== 'slide'`
- detects whether the slide has a slide deck parent.

Parent detection options:

- Prefer adding a context service such as `context.slides.deckForSlide(slideId): string | null`.
- Alternatively, use CRDT parent traversal in the editor bridge and expose the result as a service.
- Avoid importing `slideDeckForSlide` into the plugin if it creates a circular dependency.

Behavior:

- If the slide belongs to a deck, the standalone `slide` renderer should return `null` so the deck
  renderer owns it.
- If orphaned:
  - `outline` mode renders the toolbar, editable slide title/body via core helpers, and children;
  - `view` mode renders `SlideBlockView` with a default deck config:
    `{type: 'slide_deck', width: 1920, height: 1080, footer: 'none', ts: slide.ts}`.

Verification:

- Existing document fixture tests.
- Add a focused orphan slide smoke test if practical.

## Phase E: Move `SlideBlockView`

Move `SlideBlockView` into `slideRenderer.tsx` and convert it to use `BlockEditorBlockRenderContext`.

Services/behavior to preserve:

- viewport measurement and scale calculation;
- slide style CSS variables:
  - `--slide-width`
  - `--slide-height`
  - `backgroundColor` from `background-color` block style or `#ffffff`;
- drag state classes:
  - `dragging`
  - `draggingRoot`
  - drop placement class
- block selection classes:
  - `blockSelected`
  - `blockSelectionFocus`
- register row/viewport element for slide id;
- rim pointer down starts block drag;
- surface pointer down selects slide block unless event came from editable surface;
- slide title rendering:
  - relative depth `0`;
  - `surfaceClassName: 'slideTitleText'`;
  - hide affordance, inline controls, block-level decoration;
  - `registerBlockRow: false`;
  - if inside a deck, splitting title adds a slide after the current slide.
- slide body renders children at relative depth `node.block.depth + 1`;
- footer text renders when non-empty;
- overview mode renders `SlideBlockOptions`.

Likely API additions:

- `context.blocks.renderEditableBlock(..., {onSplit?})` currently does not expose `onSplit` in
  `BlockEditorEditableBlockOptions`. Add it before moving title split behavior:
  - `onSplit?(): void`
- `context.dragDrop.dropTargetForBlock(...)` currently exposes only placement. Confirm slide needs
  only placement, or widen to include enough data for future table/slide use.

Verification:

- Typecheck.
- Manual smoke test with slide title split after moving `onSplit`.

## Phase F: Move Slide Option Controls Or Bridge Them Cleanly

Current `SlideBlockOptions` directly renders central `BlockOptions` with no-op handlers for
non-slide controls, and real handlers for:

- show title;
- transition;
- block style.

Choose one of these paths:

### Preferred Path

Add enough option-panel service support to render slide-specific controls from the slides plugin:

- move slide option UI to `slideRenderer.tsx` or a dedicated slides option panel component;
- dispatch through slide services:
  - `setSlideTitleVisibility`
  - `setSlideTransition`
  - `setBlockStyle`

This avoids importing `BlockOptions` into a plugin-owned renderer.

### Temporary Bridge

If full option-panel extraction is too large for this pass:

- expose `renderBlockOptions(blockId, meta, className?)` on the block render context;
- keep central `BlockOptions` implementation in core;
- call it from `SlideBlockView` in overview mode.

This preserves behavior while still moving slide body rendering. Log it as a workaround because
section 4 is supposed to remove central option branches later.

Verification:

- Existing option panel behavior for slides remains unchanged.
- `npm exec vitest -- src/block-editor/defaultBlockEditorPlugins.test.ts`

## Phase G: Wire `slidesPlugin`

Update `src/block-editor/plugins/slides.ts`:

- remove `structuralRenderers(...)` usage for slides;
- import real renderers from `slideRenderer.tsx`;
- set:
  - `blockRenderers: [slideDeckBlockRenderer, slideBlockRenderer]`

Keep:

- block type specs;
- toolbar items;
- slash commands;
- command placeholders;
- option panel declarations;
- styles.

Verification:

- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts`
- confirm expected renderer ids remain:
  - `render:slide-deck`
  - `render:slide`

## Phase H: Remove Central Slide Branches

After plugin renderers return real output:

- remove or bypass central `renderBlockNode` hard-coded branches for:
  - `slide_deck`
  - orphan `slide`
- delete migrated central components/helpers from `BlockRichTextEditor.tsx`:
  - `SlideDeckBlock`
  - `SlideFullScreenControls`
  - `SlideDeckToolbar`
  - `OrphanSlideBlock`
  - `SlideBlockView`
  - `SlideBlockOptions`
  - `slideFooterText`
  - `calculateSlideScale`
  - `useElementSize` if fully moved
- remove now-unused slide imports/types from `BlockRichTextEditor.tsx`.

Keep central editor responsibilities:

- owning the actual state stores:
  - `slideDeckUiByBlockId`
  - `orphanSlideModesByBlockId`
- bridging those stores through `context.slides`;
- command execution for add-slide and metadata/style mutation until command extraction.

Verification:

- `npm exec tsc -- --noEmit`
- `rg -n "SlideDeckBlock|OrphanSlideBlock|SlideBlockView|SlideBlockOptions|slideFooterText|calculateSlideScale" src/block-editor/BlockRichTextEditor.tsx`
  should return no central component/helper definitions.

## Phase I: Focused Tests

Add tests where existing harnesses make this reasonable. If there is no DOM render harness for
`BlockRichTextEditor`, start with unit/type-level coverage and rely on existing integration tests.

Suggested coverage:

- Registry:
  - slides plugin registers real non-placeholder block renderers;
  - renderer ids remain stable.
- Pure helpers:
  - scale calculation;
  - footer text.
- Behavior smoke tests if render harness exists:
  - outline mode renders deck title and children;
  - overview mode renders all slides;
  - presentation mode renders only current slide;
  - next/previous buttons update current slide;
  - orphan slide view/outline toggles;
  - slide title split calls `addSlideToDeck`.

Required existing suite:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/block-editor/plugins/structuralPlugins.test.ts src/block-editor/defaultBlockEditorPlugins.test.ts`
- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts`
- broader safety:
  - `npm exec vitest -- examples/block-rich-text/src/multiSelectionCommands.test.ts`

## Risks And Workarounds

- Fullscreen API behavior is browser-dependent. Keep code guarded exactly as today and avoid
  test assumptions that require actual fullscreen support.
- Slide view selection currently mutates editor selection directly. This should stay a service
  method until command extraction defines a cleaner command owner.
- `SlideBlockOptions` overlaps with option-panel extraction. Prefer a narrow slide option renderer,
  but a temporary `renderBlockOptions` context bridge is acceptable if logged.
- Core-owned row chrome and slide viewport chrome are not the same thing. Do not force the slide
  viewport into ordinary `blockRow` if that breaks presentation sizing/selection.
- Deck renderers consuming children means fallback child rendering must be handled deliberately.
  Outline mode should render all children; overview/presentation should render slide children only.

## Completion Criteria

Slide extraction is complete when:

- `slidesPlugin` uses real plugin-owned renderers for `slide_deck` and `slide`.
- `BlockRichTextEditor.tsx` no longer has hard-coded slide render branches.
- Slide deck overview, outline, presentation, and fullscreen behavior match current behavior.
- Orphan slide view/outline behavior matches current behavior.
- Slide body/title child rendering preserves relative depth and title split behavior.
- Existing focused and broad test suites pass.
- Any temporary bridge to central option panels is documented in `implementation-log-1.md`.

