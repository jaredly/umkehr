# Implementation Log 12a

## Progress

- Started by auditing selection plumbing, plugin registry, compatibility checks, code preview registry, style metadata, package smoke tests, and the rich text editor call sites.
- Widened public selection unions to include plugin selection shapes and added a shared `BlockEditorSelectionPluginError`.
- Added registry-aware selection-set helpers for single/replace/append/dedupe flows and switched the editor's top-level resolved selection state plus DOM selection capture paths to registry-aware helpers.
- Kept legacy table behavior available through table-specific helper exports while making unknown non-table plugin selections fail clearly when non-registry helpers are used.
- Added document compatibility checks for persisted code preview metadata so Mermaid/Vega-Lite preview data requires a matching registered preview renderer.
- Added registry style extraction helpers: `styleTextFromRegistry` and `styleImportsFromRegistry`.
- Updated focused tests for custom non-table selections, code preview compatibility, registry style helpers, and bundled CSS package/static preset alignment.
- Updated README style guidance and Phase 13 documentation inputs.
- Verification passed:
  - `npm exec vitest -- run src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/plugins/code.test.ts src/block-editor/legacyRichTextPlugins.test.ts examples/block-rich-text/src/selectionSet.test.ts src/block-editor/clipboard.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/documentFixtures.test.ts src/package-smoke.test.ts`
  - `npm run typecheck`
  - `npm run build`
  - `npm exec vitest -- run src/package-smoke.test.ts`

## Issues / Workarounds / Bugs

- The working tree already had an unrelated untracked `.tasks/05jou-jigsaw-perf/plan.md`; left it untouched.
- Broad command-handler/render extraction remains deferred; central legacy table and command paths still use compatibility wrappers unless they operate at the editor selection-state boundary.
- Widening plugin selection ids to unconstrained `string` broke TypeScript discrimination for core `caret`/`range`/`block` selections. Used a `PluginSelectionType` template requiring punctuation (`-`, `/`, or `:`), which preserves narrowing and still supports namespaced/custom ids like `test-zone`.
- `table-cells` also matches the custom-id template, so table-specific code now uses `isTableCellSelection` before reading table fields in the remaining central command branches.
