# Implementation Log 10

## Slice 1: Selection Plugin Types And Registry

- Added executable `BlockEditorSelectionPlugin` contributions with retain, resolve, clamp, focus, selected-block, decoration, and comparison hooks.
- Indexed `selectionPlugins` by selection type in `BlockEditorRegistry`.
- Added registry validation for duplicate selection plugin ids and selection handlers without matching public `selectionTypes`.
- Moved `table-cells` public ownership out of `legacyRichTextBlocksPlugin` and into a dedicated transitional `table-selection` plugin.

## Slice 2: Core Registry-Aware Selection Helpers

- Split selection typing into `CoreEditorSelection`, `CoreRetainedSelection`, `PluginEditorSelection`, and `PluginRetainedSelection` while preserving existing runtime shapes.
- Added `selectionPlugins.ts` with strict registry-aware retain, resolve, clamp, focus, selected-block, decoration, and comparison helpers.
- Kept existing non-registry helpers as compatibility wrappers.

## Slice 3: Table Selection Adapter

- Added `tableSelectionPlugin.ts` as the owner of `table-cells` selection behavior.
- Moved table-cell rectangle, row, cell, position, selection-id, retain, resolve, clamp, focus, and decoration logic behind the adapter.
- Kept compatibility exports in `selectionModel.ts` so existing table rendering, drag/drop, and keyboard command code can continue to compile during Phase 10.

## Slice 4: Retained Selection Set Integration

- Added registry-aware selection set helpers for resolve, retain, sorting, block-level decorations, and selected top-level block ids.
- Preserved existing text selection dedupe and range merge behavior for compatibility.
- Plugin selections are preserved as block-level selections and are not fed through text-range dedupe.

## Slice 5: Clipboard And Command Compatibility

- Updated clipboard serialization to optionally accept the active selection registry.
- Routed plugin block-id derivation through registry-aware selected-block helpers when a registry is provided.
- Kept table TSV export as a narrow table selection helper for Phase 10 instead of introducing a broader clipboard plugin API.

## Slice 6: Editor Call Site Cleanup

- Updated the main editor copy, block-level decoration, and selected-block drag/delete paths to pass/use the active registry.
- Left table rendering, drag/drop, structural commands, arrow/tab movement, and table option UI central for Phase 11 cleanup.

## Issues And Workarounds

- Existing `focusPoint(selection)` is stateless, while general plugin focus can require document state. Workaround: keep the compatibility wrapper table-aware only and expose `focusPointFromRegistry(registry, state, selection)` for plugin-aware paths.
- `serializeSelectionToClipboardPayload` is used by tests and nested annotation-body editors without registry context. Workaround: make the registry argument optional; legacy behavior remains available, while the main editor copy path passes the active registry.
- TypeScript cannot preserve discriminated narrowing if `EditorSelection` includes a fully open `{type: string}` plugin branch. Workaround for Phase 10: expose structural `PluginEditorSelection` and `PluginRetainedSelection` for handler APIs, but keep the concrete editor union to core variants plus the registered transitional `table-cells` adapter.

## Verification

- `npm run typecheck` passed.
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit` passed.
- `npm exec vitest -- run src/block-editor/plugins/registry.test.ts src/block-editor/plugins/compatibility.test.ts src/block-editor/legacyRichTextPlugins.test.ts examples/block-rich-text/src/selectionSet.test.ts src/block-editor/clipboard.test.ts examples/block-rich-text/src/clipboard.test.ts` passed: 6 files, 68 tests.
