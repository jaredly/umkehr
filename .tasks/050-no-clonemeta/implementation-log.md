# Implementation Log

## 2026-05-30

- Started implementation from `plan.md`.
- First step: add focused regression coverage for no-op identity, pending-only
  sharing, applied-update immutability, array metadata copy-on-write, pending
  retry immutability, and rich-text metadata immutability.
- Added regression tests in `src/crdt/crdt.test.ts` and
  `src/crdt/richtext.test.ts`.
- Next step: refactor `src/crdt/apply.ts` so apply operations return copied
  metadata/state results instead of mutating an eager `cloneMeta` tree.
- Refactored `applyCrdtUpdate`/`applyOne` to return immutable apply results,
  use shallow metadata node cloning along changed paths, and return the input
  document for discarded updates.
- Focused verification passed:
  - `pnpm test src/crdt/crdt.test.ts`
  - `pnpm test src/crdt/richtext.test.ts`
- Broader verification passed:
  - `npm run build`
  - `./node_modules/.bin/vitest run src/crdt/history.test.ts src/crdt/proof.test.ts src/migration/migration.test.ts`
  - `npm run typecheck`
  - `npm test` (`51` files, `408` tests)
- `src/crdt/apply.ts` no longer imports or calls `cloneMeta`. Discarded
  updates return the exact input document, and pending-only updates avoid
  metadata cloning and materialization.
