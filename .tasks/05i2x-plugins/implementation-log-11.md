# Implementation Log 11

## 2026-06-29

- Added structural plugin declaration helpers in `src/block-editor/plugins/structuralHelpers.ts`.
- Added `pollsPlugin`, `columnsPlugin`, `slidesPlugin`, and `tablePlugin`.
- Moved structural metadata/menu ownership out of `legacyRichTextBlocksPlugin` and `legacyRichTextUiPlugin`.
- Moved poll merge behavior into `pollsPlugin`.
- Moved table virtual parent behavior into `tablePlugin`, with `requires: ['table-selection']`.
- Updated `legacyRichTextPlugins` and legacy CRDT composition to include the structural plugins.
- Gated central structural rendering by block renderer ownership for polls, columns, slide decks/slides, and tables.
- Gated structural option panels and option command paths by option-panel ownership.
- Gated table keyboard navigation from editable blocks by the `table:keyboard-navigation` command declaration.
- Gated table-cell clipboard source/TSV serialization by the `table:clipboard` command declaration.
- Gated fullscreen slide selection constraints by slide deck renderer ownership.

Issues and workarounds:

- Central rendering, drag/drop, and most structural command implementations still live in `BlockRichTextEditor.tsx`, `blockCommands.ts`, and `multiSelectionCommands.ts`. Phase 11 uses registry-gated declarations as the intermediate boundary, leaving execution extraction for Phase 14.
- `legacyRichTextCrdtPlugins` now includes `pollsPlugin`, `tableSelectionPluginBundle`, and `tablePlugin` so standalone CRDT config construction still satisfies the table plugin dependency.
- Poll slash commands were not added because the existing default slash menu did not expose poll creation; poll creation remains available through toolbar block-type entries under the legacy preset.
