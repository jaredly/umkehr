# Plan 12a: Phase 7-12 Follow-Up Hardening

## Context

Phases 7-12 moved most feature ownership into plugin declarations and added registry gates for rendering, commands, metadata, selections, and styles. The focused phase tests pass, but the review found three places where the implementation is still more transitional than the plan implies:

- Custom selections are still effectively table-only.
- Code preview metadata loads with `codePlugin` even when the preview renderer plugin is absent.
- Plugin style contributions are collected as metadata, but not actionable outside static bundled CSS imports.

This follow-up should close those gaps before Phase 13 public documentation presents the plugin system as extensible.

## Goals

- Make the selection extension point usable by non-table plugins.
- Make persisted code preview metadata require the owning preview plugin.
- Make style contribution behavior explicit and testable for both bundled static CSS and custom plugin styles.
- Preserve the current legacy preset behavior.
- Keep broad command-handler extraction deferred unless a gap cannot be closed without it.

## Non-Goals

- Do not move all table commands/rendering out of the central editor in this follow-up.
- Do not redesign selection UI or table behavior.
- Do not replace the static full-preset CSS entrypoint.
- Do not add CSS Modules or rename existing class names.
- Do not introduce a large runtime theming system.

## Track 1: Generalize Custom Selection Plumbing

### Problem

Phase 10 added `BlockEditorSelectionPlugin`, but the core selection unions and default helpers still hard-code table-cell selections:

- `EditorSelection = CoreEditorSelection | TableCellSelection`
- `RetainedSelection = CoreRetainedSelection | RetainedTableCellSelection`
- `retainSelection` / `resolveSelection` call `tableSelectionPlugin` directly.
- `BlockRichTextEditor` still uses non-registry helpers in important paths, including initial resolved selection derivation.

This preserves table behavior, but it does not let a future plugin add a new persisted selection type without editing core unions and legacy helpers.

### Work Items

1. Widen public selection state types.
   - Change `EditorSelection` to include `PluginEditorSelection`.
   - Change `RetainedSelection` to include `PluginRetainedSelection`.
   - Keep exported table selection constructors/types for compatibility.
   - Audit places where discriminated narrowing assumes the only non-core type is `table-cells`.

2. Make registry-aware helpers the editor default.
   - Use `resolveSelectionSetFromRegistry` in `BlockRichTextEditor` for the main resolved selection set.
   - Use `retainSelectionSetFromRegistry`, `replacePrimarySelectionFromRegistry`, or equivalent helpers where editor paths retain selections after plugin-aware operations.
   - Keep non-registry helpers as compatibility wrappers for tests and standalone command helpers.

3. Remove direct table plugin calls from generic selection helpers.
   - Move table-specific branches out of `selectionModel.ts` and `retainedSelection.ts` generic code paths where practical.
   - Keep table convenience helpers such as `tableCellSelection`, `tableRowsForSelection`, and `tableCellsForSelection` as table-specific exports.
   - Ensure generic fallback paths throw a clear `BlockEditorSelectionPluginError` for unknown plugin selections instead of returning empty block ids silently.

4. Add a non-table custom selection test plugin.
   - Define a test-only selection type such as `test-zone`.
   - Register retain, resolve, focus, selected block ids, decorations, and compare handlers.
   - Verify it flows through registry-aware selection set helpers and the editor-level compatibility check.

### Verification

- Existing table selection tests still pass.
- Existing caret/range/block selection tests still pass.
- A test-only custom selection resolves, retains, decorates, and reports selected block ids without core code knowing its shape.
- Unknown persisted custom selections fail compatibility checks when their plugin is absent.
- Unknown custom selections throw a clear selection plugin error if a caller bypasses compatibility checks.

Suggested commands:

```sh
npm exec vitest -- run src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts examples/block-rich-text/src/selectionSet.test.ts src/block-editor/clipboard.test.ts examples/block-rich-text/src/clipboard.test.ts
npm run typecheck
```

## Track 2: Preview Renderer Compatibility

### Problem

`codePlugin` currently validates code metadata with `preview: 'mermaid' | 'vega-lite'`, and document compatibility only checks that `code` is a registered block type. A document with Mermaid or Vega-Lite preview metadata can load with `codePlugin` alone, then silently render as a plain code block because `code/mermaid` or `code/vega` is absent.

Phase 9 only required `code/mermaid` and `code/vega` to require `code`; it did not fully enforce the reverse persisted-data requirement.

### Work Items

1. Extend compatibility issue reporting for metadata sub-features.
   - Add an issue type for missing code preview renderer, for example:
     - `{type: 'code-preview'; id; previewKind; language}`
   - During document compatibility checks, inspect `code` block metadata with `preview`.
   - Require a registered preview renderer whose `previewKind` matches the stored preview and whose language set matches the block language through `codePreviewRendererForMeta`.

2. Decide whether metadata validation should stay permissive.
   - Keep `codePlugin` metadata validation accepting known preview kinds if compatibility catches missing renderer plugins.
   - Alternatively, move preview-kind validation into a registry-aware validator.
   - Prefer compatibility enforcement first because static block type validators do not receive the full registry.

3. Add focused tests.
   - `codePlugin` alone accepts plain code metadata.
   - `codePlugin` alone reports a compatibility issue for `{type: 'code', language: 'mermaid', preview: 'mermaid'}`.
   - `codePlugin + codeMermaidPlugin` accepts Mermaid preview metadata.
   - `codePlugin + codeVegaPlugin` accepts both `vega-lite` and `vegalite` language aliases when preview is `vega-lite`.
   - A preview kind/language mismatch reports a compatibility issue rather than silently disabling preview UI.

### Verification

- Existing code plugin tests still pass.
- New compatibility tests cover missing preview sub-plugins.
- Existing legacy preset fixture/document tests still pass because `legacyRichTextPlugins` includes `codePlugin`, `codeMermaidPlugin`, and `codeVegaPlugin`.

Suggested commands:

```sh
npm exec vitest -- run src/block-editor/plugins/code.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/legacyRichTextPlugins.test.ts examples/block-rich-text/src/documentFixtures.test.ts
npm run typecheck
```

## Track 3: Make Style Contributions Actionable

### Problem

Phase 12 successfully split static CSS and declared `registry.styles`, but the registry style contributions are metadata only. That is acceptable for bundled plugins using `legacyRichTextPlugins.css`, but short-sighted for plugin authors because a plugin can declare `{type: 'css'; cssText}` or `{type: 'import'; href}` and nothing in the runtime or exported helpers tells consumers how to apply it.

### Work Items

1. Document the two supported style-loading modes.
   - Static bundled mode:
     - users import `umkehr/block-editor/style.css`
     - users import `umkehr/block-editor/legacyRichTextPlugins.css`
     - users import individual `umkehr/block-editor/plugins/*.css` entrypoints
   - Registry-driven mode:
     - users can read `registry.styles`
     - `cssText` can be injected by a helper
     - `import` entries are static package URLs and may need bundler imports

2. Add a small helper for `cssText` style injection or extraction.
   - Prefer a framework-neutral helper if possible, for example:
     - `styleTextFromRegistry(registry): string`
     - `styleImportsFromRegistry(registry): string[]`
   - If runtime DOM injection is added, it must:
     - dedupe by style id
     - preserve registry order
     - remove stale style nodes when plugin sets change
     - be opt-in, not automatic in the core editor

3. Test style metadata against static CSS entrypoints.
   - Assert every bundled plugin `import` style href maps to an exported package CSS path.
   - Assert every bundled plugin style file exists in source.
   - Assert the build copy script includes all plugin CSS files.
   - Assert full preset CSS imports the same bundled plugin CSS files in registry order, or document intentional deviations.

4. Decide what to do with empty placeholder CSS files.
   - Keep `lists.css` and `legacyRichTextBlocks.css` only if stable entrypoints are valuable.
   - Otherwise remove their style contributions and CSS files to avoid implying feature styles exist.
   - If kept, document that these are stable empty entrypoints.

### Verification

- Package smoke tests cover CSS exports and copied CSS assets.
- Registry style tests cover deterministic order and helper output.
- Full preset CSS remains the one-line import path for current examples.
- A custom test plugin with `{type: 'css'; cssText}` can be converted into deterministic CSS text by the helper.

Suggested commands:

```sh
npm exec vitest -- run src/block-editor/plugins/registry.test.ts src/package-smoke.test.ts
npm run build
```

## Track 4: Documentation And Cleanup Notes

### Work Items

- Update Phase 13 documentation inputs after Tracks 1-3 land.
- Mention that renderer/command declarations are still partially central for legacy feature implementations.
- Keep Phase 14 cleanup items for:
  - generic block renderer execution
  - generic option panel execution
  - plugin-owned clipboard hooks
  - plugin command handlers with richer editor service context
  - structural command extraction

## Test Matrix

Selection:

- core caret/range/block selection retain/resolve/decorate
- table cell selection retain/resolve/decorate/copy/paste/delete
- test-only non-table plugin selection retain/resolve/decorate
- missing persisted custom selection plugin load error

Preview compatibility:

- plain code with `codePlugin`
- Mermaid preview with and without `codeMermaidPlugin`
- Vega-Lite preview with and without `codeVegaPlugin`
- language/preview mismatch
- legacy preset fixture compatibility

Styles:

- deterministic registry style ordering
- duplicate style id failure
- static hrefs match package exports/files
- `cssText` helper output order
- full preset CSS includes bundled feature CSS

## Completion Criteria

- A custom selection plugin can define a persisted selection shape without editing core union types.
- Missing code preview renderer plugins are document compatibility errors, not silent rendering downgrades.
- Plugin style contributions have an explicit consumption path, even if bundled editor users still prefer static CSS imports.
- Focused tests cover the above behavior.
- Phase 13 docs can describe these APIs without caveats that contradict the implementation.
