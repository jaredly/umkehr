# Implementation Log

## 2026-06-27

- Started Phase 1.
- Initial scan found direct `deleted` boolean checks across `src/block-crdt` and `examples/block-rich-text`. The example constructs raw block/char ops, so it will need call-site updates in addition to core library changes.
- Completed first core pass for Phases 1-5:
  - Added `DeletedState` and deletion helpers.
  - Changed `Char.deleted` / `Block.deleted` to optional LWW state.
  - Updated core apply merge logic to use timestamp ordering.
  - Updated traversal/formatting checks to use `isDeleted`.
  - Changed undo of char/block delete ops to restore original ids instead of recreating replacement records.
- `npm run typecheck` passes for the root package after threading `ts` into `src/block-richtext/plugin.ts`.
- First focused test run failed mostly because tests still used raw `char:delete` / `block:delete` ops without the new `deleted` payload. Those old-shape raw ops can silently no-op at runtime because raw `apply` assumes typed inputs; I am updating tests and fixtures rather than adding a backwards-compatible shim.
- Migrated focused block-crdt tests to timestamped delete payloads and updated undo expectations to assert original-id restoration.
- `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts` passes.
- Migrated example call sites:
  - Added `ts` to delete helper calls in block-rich-text, block-richtext plugin, and plim adapter.
  - Threaded `CommandContext` through table/slash deletion helpers where deletes previously had no timestamp source.
  - Fixed local raw char/block constructors to use `deleted: undefined`.
- Issue encountered: an initial bulk edit added `ts: context.nextTs` to some non-delete option objects. I removed those inserted lines and reran a narrower rewrite limited to `deleteRangeOps` / `deleteBlockOps` call sites.
- `npm run typecheck:examples` passes.
- Replaced runtime truthiness checks for CRDT `deleted` records with `isDeleted(...)` in example adapters/utilities to avoid treating restored `{value:false}` records as hidden.
- Updated `src/block-crdt/Readme.md` for timestamped LWW deletion and undo restore behavior.
- Full verification:
  - `npm run typecheck` passes.
  - `npm run typecheck:examples` passes.
  - `npm run typecheck:tests` passes.
  - `npm test` passes: 80 files passed, 1 skipped; 1276 tests passed, 3 skipped.
- Note: the first full test run had two perf threshold failures, but rerunning `examples/block-rich-text/src/typingPerf.test.ts` alone passed, and the final full `npm test` passed. Treated as run noise.
