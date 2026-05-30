# Peritext implementation log

## 2026-05-30

### Phase 2: explicit pending semantics

- Started by keeping rich-text `pending` as retained unresolved operations rather than removing it.
- Targeted the current exception-driven dependency flow in `apply.ts` first, because it affects inserts, removes, and marks before the larger representation/cache migration.
- Changed duplicate rich-text ops to return the same state instead of cloning.
- Replaced missing dependency try/catch detection with direct checks for insert `afterId`, remove `removedId`, and mark anchor resolution.
- Kept unresolved operations in `pending` and retry them after successful operations, but removed the up-front whole-state clone from retry.
- Added tests for retained insert/remove/mark operations resolving when dependencies arrive.

### Phase 5/6 early low-risk optimizations

- Rewrote visible index/range helpers to avoid allocating full `visibleChars()` arrays.
- Rewrote mark boundary lookup to compute needed visible IDs in one pass.
- Replaced `tryParseOpId` try/catch with a non-throwing parser.

### Phase 4: incremental insert path

- Replaced the `applyInsert` hot path that cloned every char and called `sortChars` with an incremental insertion point calculation.
- Kept `sortChars` available as a canonicalization/debug helper, but it is no longer used for normal single-character insert application.
- Changed `applyRemove` to clone only the array and changed char instead of cloning every char and mark boundary array.

### Phase 6: cached max operation counter

- Added optional `maxOpCounter` to rich-text state/meta and initialize it for new rich-text fields.
- Updated insert, remove, mark, and pending-retention paths to bump the counter incrementally.
- This also fixes a latent correctness issue: applied remove operation IDs were not represented in `chars`, so scan-only allocation could otherwise miss them.

### Issues encountered

- TypeScript inferred `cloneChars` as returning required `markOpsBefore`/`markOpsAfter` properties with `undefined` values. Added an explicit `RichTextCharMeta[]` return type to keep the intended optional-property shape.

### Verification

- `pnpm test src/peritext` passed.
- `pnpm test src/crdt/richtext.test.ts` passed.
- `pnpm test src/crdt` passed.
- `pnpm test` passed: 50 files, 393 tests.

### Phase 7: rich-text data moved into user-visible state

- Changed `richText()` from a sentinel-only value into an empty durable rich-text value: `{kind: 'rich-text', version: 1, chars: []}`.
- Changed rich-text CRDT metadata to keep cache/control data only for now: `kind`, `created`, and `maxOpCounter`.
- Updated CRDT materialization to preserve rich-text values from existing document state instead of reconstructing them from metadata.
- Updated CRDT rich-text apply to read/write the durable rich-text value at the normal document path and update metadata's cached `maxOpCounter`.
- Updated rich-text patch generation to read visible text/ranges from `doc.state` while allocating op IDs from metadata's cached counter.
- Updated undo/redo rich-text effect capture and target checks to use durable rich-text state instead of rich-text metadata.
- Updated the React rich-text hook to materialize views from document state rather than metadata.
- Removed the accidental `maxOpCounter` cache from user-visible `RichTextState`; it now lives only in CRDT rich-text metadata.

### Phase 7 issues encountered

- Changing `RichCollaborativeText` to intersect with `RichTextState` caused the generated Typia schema marker to disappear. Rewrote the public type so `chars`/`pending` are explicit properties on the same plugin-marked object.
- Several tests still asserted the old sentinel-only state shape. Updated those tests to assert the new durable state representation.

### Phase 7 verification

- `pnpm test src/crdt/richtext.test.ts` passed.
- `pnpm test src/crdt src/react-crdt src/richtext src/peritext` passed.
- `pnpm test` passed: 50 files, 393 tests.
