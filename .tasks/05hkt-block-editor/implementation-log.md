# Implementation Log

## 2026-06-27

- Started Phase 1.
- Added the initial `src/block-editor` package boundary with host-facing type contracts for editor value, changes, clocks, attachments, and presence.
- Kept `BlockEditorSelectionState` as `unknown` for the first checkpoint because the concrete retained selection types still live in `examples/block-rich-text` and will move during Phase 2.
- Typecheck exposed that block editor metadata generics must extend `TimestampedBlockMeta`; updated the public type contracts to preserve the block-crdt constraint.
- Started Phase 2 by copying editor domain modules from `examples/block-rich-text/src` into `src/block-editor` and mechanically rewriting their block-crdt imports to local source imports.
- Replaced the temporary unknown selection type with `RetainedSelectionSet` now that `selectionSet.ts` is present in `src/block-editor`.
- Typecheck exposed copied example assumptions: a stale `../../../src/crdt/hlc` import, Vite-only `import.meta.env` access, and preview libraries that were only installed under the example. Fixed the stale import, wrapped Vite env access, made Mermaid a lazy optional import, and declared preview modules as optional peer dependencies.
- `examples/block-rich-text` source typecheck did not automatically include the optional preview ambient declarations through path mapping, so `mediaBlocks.tsx` now references the declaration file explicitly.
- Rewrote `examples/block-rich-text` imports to consume moved modules through `umkehr/block-editor`, removed the stale example copies, and verified:
  - `npm run typecheck`
  - `tsc -p examples/block-rich-text/tsconfig.json --noEmit`
  - `tsc -p examples/react-crdt/tsconfig.json --noEmit`
- Started Phase 3 by changing `src/block-richtext` to use `RichBlockMeta` and rich paragraph initial state, widening raw ops to `Op<RichBlockMeta>`, and applying raw ops with `richTextCrdtConfig`.
- Added leaf-plugin tests for rich block metadata and poll metadata merging through raw block ops.
- Verified Phase 3 with:
  - `npm exec vitest -- run src/crdt/leafPlugin.test.ts`
  - `npm run typecheck`
  - `tsc -p examples/block-rich-text/tsconfig.json --noEmit`
  - `tsc -p examples/react-crdt/tsconfig.json --noEmit`
- Workaround/known issue: `planUndoOps` does not accept virtual parent config, so Phase 3 only applies `richTextCrdtConfig` on raw op application. Undo behavior remains covered by existing leaf-plugin tests but may need deeper table/annotation cases later.
- Started Phase 4/5 by mechanically extracting the former `BlockEditor` implementation from `examples/block-rich-text/src/EditorApp.tsx` into `src/block-editor/BlockRichTextEditor.tsx`.
- Updated `examples/block-rich-text/src/EditorApp.tsx` to import and render `BlockRichTextEditor`, then removed the old local implementation tail.
- Verified the extraction with:
  - `tsc -p examples/block-rich-text/tsconfig.json --noEmit`
  - `npm run typecheck`
- Workaround/known issue: the extracted component currently preserves the old replica-shaped props and owns structural clock helpers internally. This kept the demo behavior stable, but the public host contract still needs cleanup as `block-notes` integration proceeds.
- Copied the editor stylesheet into `src/block-editor/style.css` and imported it from `examples/react-crdt/src/main.tsx` for the block-notes integration.
- Replaced the placeholder `BlockNotesPanel` with a `BlockRichTextEditor` adapter that:
  - reads `BlockRichText` through `cachedBlockRichTextValue`;
  - owns local retained selection state;
  - creates a structural editor replica with actor, clock, state, and selection;
  - applies emitted raw ops through `editor.$.body.$block.ops({ops})`;
  - updates `updatedAt`;
  - wires document undo/redo into the editor toolbar.
- Added `examples/react-crdt/src/apps/block-notes/artifacts.ts` and registered `blockNotesArtifactStore` on the app definition. Image attachments now serialize through the existing artifact-store pattern rather than living in the CRDT document.
- Added block-notes ephemeral selection message helpers and validation, then updated the app registry type to treat block-notes as an ephemeral app.
- Added tests for block-notes image artifacts and selection presence validation.
- Added root Vitest aliases for `umkehr/block-editor` so tests can resolve the new source package without building `dist`.
- Verified integration with:
  - `npm exec vitest -- run examples/react-crdt/src/apps/block-notes/model.test.ts examples/react-crdt/src/lib/appRegistry.test.ts src/crdt/leafPlugin.test.ts`
  - `npm run typecheck`
  - `tsc -p examples/block-rich-text/tsconfig.json --noEmit`
  - `tsc -p examples/react-crdt/tsconfig.json --noEmit`
- Workaround/known issue: block-notes publishes selection presence, but the extracted editor does not yet accept/render remote selections. The presence transport and validation are in place; visual remote selection rendering still needs an explicit prop and decoration path.
- Workaround/known issue: block-notes currently imports `src/block-editor/style.css` by relative source path. The package build does not yet copy CSS into `dist`, so published CSS export/copy handling remains to be finalized.

## 2026-06-28

- Fixed a circular import introduced by the extraction: `BlockRichTextEditor.tsx` imported most editor helpers from `./index.js`, while `index.ts` also exports `BlockRichTextEditor`. This could initialize the barrel before `inlineMarks.ts` exported `CODE_MARK`, causing `cannot access CODE_MARK before initialization`.
- Replaced every `BlockRichTextEditor.tsx` import from `./index.js` with direct imports from concrete local modules.
- Changed `src/block-richtext` to import `paragraphMeta`, `RichBlockMeta`, and `richTextCrdtConfig` from concrete `src/block-editor` modules instead of the `block-editor` barrel, so the leaf plugin does not initialize the React editor path.
- Verified with:
  - `npm run typecheck`
  - `tsc -p examples/block-rich-text/tsconfig.json --noEmit`
  - `tsc -p examples/react-crdt/tsconfig.json --noEmit`
  - `npm exec vitest -- run examples/react-crdt/src/apps/block-notes/model.test.ts examples/react-crdt/src/lib/appRegistry.test.ts src/crdt/leafPlugin.test.ts`
