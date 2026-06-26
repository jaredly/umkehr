# Implementation Log: Slide Deck Logical Size and Scaling

## Phase 1: Normalize Deck Size Metadata

- Added shared slide deck aspect-ratio constants and helpers in `blockMeta.ts`.
- Document import now rejects slide deck metadata outside `1:4` through `4:1`, matching the decision to treat extreme ratios as invalid imported data.
- Toolbar-driven deck size edits now normalize to positive integer dimensions and clamp the requested width into the allowed ratio range for the given height.
- Added document-format tests for both too-narrow and too-wide imported slide decks.

Issue/workaround:

- The block option setter receives only a width/height pair, not which field the user edited. The first implementation clamps width relative to height. If that feels odd while editing height, a later refinement can pass the edited field through and clamp the edited dimension instead.

## Phases 2-5: Logical Scaling, Layout, Typography, and Full-Screen Chrome

- Added a `ResizeObserver`-based element measurement helper and pure slide scale calculation in `EditorApp.tsx`.
- Changed `SlideBlockView` to render a `.slideScaleLayer` at the deck's logical `width x height`, then scale that layer to the rendered `.slideViewport`.
- Kept the slide viewport ref callback stable by storing the render context in a ref before calling `registerRow()`.
- Added `data-slide-logical-width`, `data-slide-logical-height`, and `data-slide-scale` attributes for easier inspection and jsdom-friendly assertions.
- Updated slide CSS so overview and presentation slides use available width instead of fixed `860px`/`1040px` caps.
- Updated full-screen sizing to reclaim the old header area.
- Converted core slide padding/title/body/footer sizing to logical pixel values, with initial defaults:
  - padding `72px`,
  - title `64px`,
  - body `32px`,
  - body gap `20px`,
  - footer `22px`.
- Added a bottom-center `.slideFullScreenControls` bar for full-screen previous/next/exit controls.
- Changed full-screen presentation to omit the normal deck header/toolbar structurally instead of hiding it only with CSS.

Issue/workaround:

- jsdom reports zero layout size by default, so the scale calculation falls back to `1` when measured dimensions are unavailable. Tests that need exact scale values stub `getBoundingClientRect()`.
- The first full-screen control implementation reused the toggle handler for exit. In jsdom, where no real `document.fullscreenElement` exists, that re-entered full-screen UI state instead of clearing it. Split out an explicit `exitFullScreen()` path for Escape and the hover control.

## Phase 6: Tests

- Added App tests for logical layer dimensions and computed scale.
- Added App tests for deck option aspect-ratio normalization.
- Added App tests for full-screen chrome hiding and hover-control navigation.

Verification:

- `npm exec vitest -- examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/App.test.tsx --run` passes: 259 passed, 1 skipped.
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit` passes.
