# Block CRDT Additions Implementation Log

## 2026-06-12

- Started implementation from `.tasks/050xn-plim-integration/block-crdt-additions.md`.
- Initial inspection found the task folder is untracked; no unrelated worktree changes were present.
- Existing helpers provide useful foundations: `moveBlockOps` anchor validation, visible tree traversal with hidden-parent splicing, and single-block `markRange`.
- Added public block insertion/deletion helpers, multi-block mark helpers, visible path helpers, retained selection helpers, grapheme conversion helpers, and visible text wrappers.
- Exported the new APIs from `src/block-crdt/index.ts` and documented them in `src/block-crdt/Readme.md`.
- Added `src/block-crdt/adapter-additions.test.ts` for the new adapter-facing contracts.
- Issue encountered: the initial test fixture already contains a root paragraph, so insertion tests must provide explicit sibling anchors instead of assuming an empty root.
- Workaround/behavior note: `deleteBlockOps` intentionally does not emit `char:delete`; block tombstones already hide text and keep future resurrection/inverse planning possible.
- Verification passed: `npm exec vitest -- run src/block-crdt/adapter-additions.test.ts`, `npm run typecheck`, `npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts src/block-crdt/adapter-additions.test.ts`, `npm run build`, and full `npm exec vitest -- run`.
