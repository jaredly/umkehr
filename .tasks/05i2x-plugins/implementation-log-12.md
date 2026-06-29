# Implementation Log 12: Plugin-Owned Styles

## Slice 1: Style Entry Points And Registry Metadata

- Added static CSS entrypoints for core editor shell CSS, full legacy preset CSS, and bundled plugin CSS files.
- Added `bundledPluginStyle` metadata helper and wired style contributions into bundled plugins with stable ids, hrefs, and explicit order values.
- Kept `registry.styles` as metadata only. The React editor still does not inject styles at runtime.

## Slice 2: Core CSS Split

- Replaced `src/block-editor/style.css` with core editor shell styles only: toolbar, block rows, block options, editable blocks, retained selection, shared popover/layout primitives, and responsive shell rules.
- Created `src/block-editor/legacyRichTextPlugins.css`, importing core CSS first and then bundled plugin CSS in deterministic full-preset order.
- Created plugin CSS files under `src/block-editor/plugins/`.
- Issue encountered: the mechanical split initially moved the base `.blockRow:hover .blockOptionsButton` selector into `slides.css` because it shared a rule with `.slideViewport`. Added the base block-row hover rule back to core.

## Slices 3-5: Feature CSS Split

- Moved clearly named low-coupling selectors to plugin CSS files for basic marks, links, math, inline date/embed, headings, todos, quote, and callouts.
- Moved medium feature selectors for code/previews, ingredients, images, link previews, and annotations.
- Moved structural selectors for polls, columns, slides, and tables.
- Workaround: `lists.css` and `legacyRichTextBlocks.css` are intentionally empty placeholders because those plugins currently do not own dedicated selectors, but stable entrypoints and registry metadata now exist.
- Known follow-up: cross-feature selectors such as preview cards inside tables remain in the feature file selected by the concrete visual class. These should be revisited during the later cleanup phase.

## Slice 6: Example Cleanup And Packaging

- Updated `examples/block-rich-text` to import `umkehr/block-editor/legacyRichTextPlugins.css` before its local app/demo stylesheet.
- Updated `examples/react-crdt` to import the full preset source stylesheet because its block-notes app uses `legacyRichTextPlugins`.
- Reduced `examples/block-rich-text/src/style.css` to app shell, history controls, fixture controls, demo gallery, performance monitor, and two-replica layout styles.
- Added a Vite alias for package CSS imports in the example so local source CSS resolves during dev.
- Added explicit package exports for block editor CSS entrypoints.
- Changed package `sideEffects` to preserve CSS imports in bundlers.
- Added `scripts/copy-css.mjs` and wired it into `npm run build` because `tsc` does not emit CSS assets.
