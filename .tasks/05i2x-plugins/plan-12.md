# Plan 12: Phase 12 Plugin-Owned Styles

## Context

The plugin API already has a style contribution type:

- `{type: 'css'; cssText}`
- `{type: 'import'; href}`

The registry also collects and sorts `registry.styles` deterministically. What is missing is an actual style loading/export convention and a migration path away from one large feature-heavy stylesheet.

The current block editor stylesheet is centralized, and the block-rich-text example imports a local copy directly. Phase 12 should make bundled plugin styles available with the plugins that need them without making runtime layout depend on plugin registration order.

## Goal

Create a stable style packaging and loading model for plugin-owned styles while preserving all existing class names and visuals under the full legacy preset.

The result should be:

- Core editor shell styles remain available without requiring feature plugin CSS.
- Bundled feature plugins have stable CSS entrypoints or CSS string exports.
- Full legacy preset users can import one stable full-preset stylesheet.
- Individual plugin users can import only the feature CSS they need.
- `registry.styles` remains deterministic and documented, even if runtime injection is not the first implementation.
- Feature-specific CSS can move out of the monolithic stylesheet in stages.

## Non-Goals

- Do not rename existing DOM class names in this phase.
- Do not redesign component markup just to make CSS splitting easier.
- Do not introduce CSS Modules if that would force class name churn.
- Do not require runtime style injection for the bundled editor if static CSS entrypoints are simpler and more reliable.
- Do not move app/demo-only styles from `examples/block-rich-text/src/style.css` into package plugin CSS.
- Do not complete broad visual redesign or theme token work in this phase.

## Current Ownership To Untangle

Core/editor shell styles:

- editor layout
- toolbar
- block surface
- text selection and retained selection
- drag handles and drop targets
- block options shell
- shared popover shell styles where not feature-specific

Feature-specific style groups:

- basic inline marks
- links
- math
- inline embeds/date
- annotations
- headings/lists/todos/quote
- code and code previews
- callouts
- ingredients
- images
- link previews
- polls
- columns
- slides
- tables

Example-only styles:

- app shell
- history controls
- fixture controls
- demo gallery/blog visuals
- performance monitor
- two-replica layout

These should stay in the example stylesheet.

## Style Loading Decision

Use static CSS entrypoints for bundled plugins as the first implementation.

Recommended model:

- `src/block-editor/style.css`: core editor shell CSS only.
- `src/block-editor/plugins/<plugin>.css`: bundled feature CSS.
- `src/block-editor/legacyRichTextPlugins.css`: imports core CSS plus all bundled feature CSS in deterministic preset order.
- Optional plugin exports expose CSS URLs/strings only where the build supports it cleanly.

Keep `registry.styles` as metadata for:

- deterministic style contribution order
- future runtime style injection
- documentation of which plugin owns which CSS
- tests that verify style declarations exist

Do not make the core React editor inject `<style>` tags in this phase unless static entrypoints are insufficient for examples or package consumers.

## Proposed Plugin Style Boundary

Each bundled plugin may declare a style contribution:

- `id`: stable id such as `annotations:styles`
- `type`: preferably `import` for bundled CSS entrypoint metadata, or `css` for small CSS strings
- `href`: stable package-relative CSS path where feasible
- `order`: deterministic order within the full preset

The plugin does not own layout outside its rendered surface. For example:

- annotations own inline annotation classes, cards, footnotes, and popover visuals
- editor shell owns sidebar grid/layout width and global panel layout
- table owns table grid/cell/row controls
- core owns generic drag/drop affordance base classes

## Required Foundation Work

### 1. Define CSS Entry Point Convention

Decide and document import paths for:

- core editor CSS
- full legacy preset CSS
- individual bundled plugin CSS

Example shape:

```ts
import '@package/block-editor/style.css';
import '@package/block-editor/legacyRichTextPlugins.css';
import '@package/block-editor/plugins/annotations.css';
```

Use the actual package/export layout in this repo during implementation.

### 2. Make Style Contributions Meaningful

Update bundled plugins to declare `styles` metadata for their feature CSS.

At minimum, tests should verify:

- style ids are unique
- registry sorting is deterministic
- full preset registry contains expected style contributions

If `type: 'import'` is used, make the `href` value match the documented static CSS entrypoint.

### 3. Split Core Shell CSS First

Identify CSS that must remain loaded for every editor:

- root editor classes
- toolbar shell
- editable block shell
- block options shell
- selection rendering
- generic block affordances
- generic drag/drop styles
- shared variables/custom properties

Move only clearly feature-specific selectors out at first.

### 4. Move Feature CSS In Stages

Split feature CSS in a conservative order:

1. Low-coupling inline/simple features:
   - basic marks
   - links
   - math
   - inline date/embed
   - headings/lists/todos/quote
2. Medium features:
   - code/code previews
   - callouts
   - ingredients
   - images
   - link previews
   - annotations
3. Heavy structural features:
   - polls
   - columns
   - slides
   - tables

Do not move a selector if ownership is ambiguous. Leave it in core and document it for cleanup.

### 5. Update Examples

The block-rich-text example should import:

- package/editor full preset CSS for editor visuals
- example-local CSS for app chrome and demos

Avoid duplicating package CSS inside the example stylesheet after the split.

### 6. Document Runtime Injection Status

Document that:

- `registry.styles` is currently a deterministic declaration surface
- bundled CSS is loaded through static entrypoints
- runtime injection from `cssText`/`href` is future-compatible but not required for the bundled editor unless implemented in this phase

If runtime injection is implemented, it must:

- dedupe by style id
- apply deterministic registry order
- remove or disable styles when plugin sets change
- avoid SSR/hydration surprises

## Implementation Slices

### Slice 1: Style Entry Points And Registry Metadata

- Add or document core and full-preset CSS entrypoints.
- Add style contributions to existing bundled plugins without moving large CSS blocks yet.
- Add registry tests for style contribution ordering and full preset coverage.

Verification:

- `legacyRichTextPlugins` registry exposes expected style ids.
- Duplicate style ids still fail registry construction through existing contribution validation.

### Slice 2: Core CSS Split

- Keep shared editor shell styles in core CSS.
- Create the full-preset CSS entrypoint that imports core CSS and plugin CSS files.
- Keep feature CSS initially imported by the full preset, even if some files are still broad.

Verification:

- Existing example/editor visuals are unchanged when full preset CSS is imported.
- A minimal editor can import only core CSS without feature-specific selectors being required for base layout.

### Slice 3: Low-Coupling Feature CSS

- Move simple inline/block feature selectors to plugin CSS files.
- Preserve class names exactly.
- Update plugin style metadata href/order values as needed.

Verification:

- Toolbar, inline marks, links, math, date/embed, headings, lists, todos, and quotes render unchanged under full preset CSS.
- Omitting a simple plugin CSS file does not break core editor shell layout.

### Slice 4: Medium Feature CSS

- Move code, previews, media, annotations, callouts, and ingredients CSS into plugin CSS files.
- Keep editor-level annotation layout styles in core if they define global editor panel layout.

Verification:

- Code highlighting/previews, images, link previews, annotations, callouts, and ingredients render unchanged under full preset CSS.
- Feature CSS files are included only through their plugin or full preset entrypoint.

### Slice 5: Structural Feature CSS

- Move polls, columns, slides, and table CSS into their plugin CSS files after Phase 11 extraction is complete.
- Keep generic drag/drop base styles in core if they are shared across structural plugins.

Verification:

- Polls, columns/card columns, slide decks/slides, and tables render unchanged under full preset CSS.
- Base editor CSS does not include structural feature selectors except shared shell/drag primitives.

### Slice 6: Example Cleanup

- Remove package/editor feature CSS from the example-local stylesheet.
- Keep app shell, fixture UI, blog demos, and performance monitor styles local to the example.
- Update imports to use the new full-preset CSS entrypoint.

Verification:

- Example app visual tests/screenshots, if any, remain stable.
- Example stylesheet no longer duplicates package feature selectors.

## Test Matrix

Registry:

- style contribution ids are unique
- style contribution order is deterministic
- full legacy preset registry contains core/full feature style declarations
- individual plugin registries contain only their style contributions

CSS packaging:

- core CSS entrypoint exists
- full preset CSS entrypoint exists
- plugin CSS entrypoints exist for bundled plugin styles
- package exports include documented CSS entrypoints, if package exports are used

Behavior:

- full preset visual classes remain present
- base editor shell renders with core CSS only
- plugin feature visuals are present when the plugin CSS is imported
- omitting feature CSS does not break base editor shell layout

Examples:

- block-rich-text example imports full preset CSS plus local app CSS
- example-local CSS only contains example/app/demo styles after cleanup

## Risks

- CSS selectors are currently global and class-name based. Moving rules without preserving load order can create subtle visual regressions.
- Some selectors mix shell and feature concerns. Do not force a split when ownership is unclear.
- Runtime style injection can complicate SSR and tests. Prefer static CSS entrypoints first.
- Example CSS may duplicate package CSS. Clean up gradually to avoid breaking demo-only visuals.
- Plugin CSS files need stable package export paths, which may interact with package build configuration.

## Completion Criteria

- Core editor CSS and full legacy preset CSS have stable documented entrypoints.
- Bundled plugins declare deterministic style metadata.
- Feature-specific CSS is split out of core in staged, ownership-aligned files.
- Full preset visuals remain unchanged.
- Base editor shell can be used without importing all feature plugin CSS.
- Remaining ambiguous/shared selectors are documented for Phase 14 cleanup rather than silently owned by the wrong plugin.
