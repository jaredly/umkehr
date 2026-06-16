# Implementation Log: Pluggable Leaf CRDTs

## Progress

- Started implementation from `plan.md`.
- Added `src/crdt/plugins.ts` with leaf plugin descriptors, registry creation, required-plugin assertion, operation validation result types, and the generic plugin contract.
- Replaced core CRDT rich text metadata/update types with generic `LeafMeta` and `CrdtLeafUpdate`.
- Added schema marker collection for `x-umkehr-leaf-crdt` / `x-umkehr-leaf-crdt-version`, including deterministic required-plugin descriptors and exact version checks.
- Threaded leaf plugin registries into `createCrdtDocument` and `createCrdtUpdateValidator`.
- Added `richTextLeafPlugin` and updated `RichCollaborativeText` to emit the generic leaf schema marker.
- Updated CRDT update creation, application, validation, path change reporting, and local history capture to use generic `op: 'leaf'` updates.
- Moved rich text undo/redo and effect-target checks into `richTextLeafPlugin`.
- `npm run typecheck` passes for `src`.
- Focused suite passes: `npm exec vitest -- run src/crdt/richtext.test.ts src/crdt/crdt.test.ts src/crdt/validation.test.ts src/richtext/index.test.ts src/richtext/builder.test.ts`.
- Replaced public rich text draft patches with plugin-tagged `op: 'leaf'` patches while preserving the `$text` builder surface.
- Added plugin-aware schema fingerprint input using schema-required leaf plugin descriptors.
- Threaded optional app/protocol plugin registration through React CRDT app definitions, rich notes, document archive validation, peer sync, local-first sync, and server sync parsing.
- Passed an explicit session id from CRDT local command generation into plugin operation creation.
- Added `src/crdt/leafPlugin.test.ts` as a block-crdt plugin spike using a test-only plugin around `initialState`, `insertTextOps`, `applyMany`, and `validateOp`.
- Removed the old `x-umkehr-crdt: rich-text` schema fallback; rich text now uses only `x-umkehr-leaf-crdt`.
- `npm run typecheck:examples` passes.
- `npm test` passes: 62 passed, 1 skipped test file; 647 passed, 1 skipped tests.

## Issues / Workarounds / Bugs

- The public rich text patch shape now uses `op: 'leaf'` with `plugin: 'umkehr.rich-text'`.
- While wiring plugin effect checks, `null` from a plugin meant "not blocked" but was accidentally converted to unsupported by `??`. Fixed by only using the unsupported fallback when the hook is absent.
- The implementation keeps the ergonomic `$text` command surface, but it now emits plugin-tagged `op: 'leaf'` patches. A more general typed third-party builder extension API is still a future design task.
- The block-crdt integration is a focused spike/test proving the plugin contract can host block-crdt operations. It is not yet a full exported `blockRichTextLeafPlugin` with editor-level high-level commands.
