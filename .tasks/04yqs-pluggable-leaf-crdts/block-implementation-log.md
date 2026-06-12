# Block Rich Text Plugin Implementation Log

## Phase 1: Public Module And Plugin

- Started the exported `blockRichTextLeafPlugin` work from `block-plan.md`, using option B for phase 6.
- Chosen public value shape: `{kind: 'block-rich-text', version: 1, state}`. The wrapper gives the plugin a reliable runtime discriminator and keeps the lower-level `block-crdt` state intact under `state`.
- Initial undo/redo policy was unsupported, then revised after confirming the plugin contract already supports rich-text undo/redo and the block-crdt undo planner can support block leaf batches.
- Added `src/block-richtext/index.ts` and `src/block-richtext/plugin.ts` with constructor, runtime type guard, materialization helpers, and the exported leaf plugin.
- Added the hardcoded `$block` builder surface and the `umkehr/block-richtext` package export.
- Test resolver issue: Vitest uses explicit aliases for package subpaths, so `umkehr/block-richtext` also needed an alias in `vitest.config.ts` even though Node self-resolution already handled the package export after build.

## Phase 2: Tests And Verification

- Replaced the temporary block plugin spike in `src/crdt/leafPlugin.test.ts` with coverage for `blockRichTextLeafPlugin`.
- Added public API/schema-marker tests in `src/block-richtext/index.test.ts`.
- Added `$block` builder tests in `src/block-richtext/builder.test.ts` and compile-only builder assertions in `type-tests/patch-builder.ts`.
- Added package smoke coverage for `umkehr/block-richtext`.
- Hardened block op validation so malformed raw ops report validation failures instead of leaking helper exceptions.
- Added optional batch leaf undo/redo hooks to the plugin contract. Core CRDT history now groups adjacent leaf effects by plugin/path for plugins that need command-level planning.
- Implemented block rich text undo/redo with `planUndoOps(...)`. Undo plans from the original block op batch; redo plans from the undo command's captured block op batch so redo gets fresh Lamport IDs instead of replaying tombstoned originals.
- Added target checks for block effects so undo/redo is blocked when an operation has been deleted, superseded, or points at a missing target.
- Verification passed:
  - `npm run typecheck`
  - `npm run typecheck:tests`
  - `npm test`
  - `npm run typecheck:examples`

## Known Limitations

- Option B integration was implemented as focused library/package/type tests, not a migration of the larger `examples/block-rich-text` app.
