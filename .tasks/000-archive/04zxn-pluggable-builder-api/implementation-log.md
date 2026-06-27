# Implementation Log: Typed Builder Extensions

## Progress

- Implemented core builder extension definitions in `src/builderExtensions.ts`, including `defineLeafBuilderExtension(...)`, runtime normalization, and duplicate key checks.
- Threaded builder extension tuple generics through `PatchBuilderInternal`, `PatchBuilder`, draft nested patches, `createPatchBuilder`, `createPatchBuilderWithContext`, `createPatchDispatcher`, `resolveAndApply`, `rebase`, and CRDT local command application.
- Removed the hardcoded `$text` and `$block` runtime branches from `src/helper.ts`; extension commands now emit generic plugin-tagged `leaf` draft patches.
- Added optional `builder` metadata to leaf CRDT plugins plus `builderExtensionsFromLeafPlugins(...)`.
- Moved `$text` into `src/richtext` as `richTextBuilderExtension` with single-object command arguments.
- Moved `$block` into `src/block-richtext` as `blockRichTextBuilderExtension` with single-object command arguments.
- Removed legacy rich/block patch aliases from core types so plugin-specific patch change types live with their plugins.
- Updated CRDT tests, type tests, and React example call sites to pass explicit builder extension tuples and use the new single-argument builder command shape.
- Made `createSyncedContext` and the example app shell types extension-aware so configured providers preserve `$text`/`$block` typing through app runtimes, panels, previews, and nested dispatches.
- Added helper tests covering generic builder extension patch emission, preview timing, duplicate key rejection, and nested patch propagation.
- Formatted touched TypeScript files with `oxfmt`.

## Verification

- `npm run typecheck`
- `npm run typecheck:tests`
- `npm run typecheck:examples`
- `npm test`

## Issues / Workarounds / Bugs

- TypeScript cannot infer a builder extension tuple when only the document state generic is explicitly provided, e.g. `createPatchBuilder<State>({builderExtensions: [...]})`. The strongly typed form currently needs the tuple as the second generic: `createPatchBuilder<State, [typeof richTextBuilderExtension]>({builderExtensions: [richTextBuilderExtension]})`. The same pattern is used in type tests and standalone builder tests.
- Runtime contexts can derive builder extensions from registered leaf plugins when no explicit tuple is supplied, but compile-time typing still requires the tuple in the `createSyncedContext<..., Extensions>(..., {builderExtensions})` call.
