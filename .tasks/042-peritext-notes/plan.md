# Peritext performance plan

## Goal

Rework rich-text storage and application so Peritext scales to thousands of characters with collaborative concurrent edits.

The target shape is:

- User-visible rich text JSON contains the actual rich-text data, not only the current `{kind: 'rich-text', version: 1}` sentinel.
- CRDT metadata for rich-text fields contains JSON-serializable indexes and caches only.
- Applying rich-text operations remains persistent/immutable for now.
- No-op operation application can return the same object.
- Unresolved rich-text operations may stay in a retained pending queue. This is especially useful for mark operations whose start/end anchors are not resolvable yet.
- Pending should mean "retained unresolved rich-text op", not "expensive retry loop driven by thrown exceptions".
- No `Map` in persisted metadata; use objects/arrays so archive/import/export remains JSON-friendly.

## Phase 1: Define the new data and metadata contract

Update the types before changing behavior.

- Split the current `RichTextState` concept into:
  - durable user data: chars/operations/tombstones/mark operations needed to reconstruct the Peritext document,
  - CRDT metadata caches: indexes, counters, visible-order helpers, and any hydration/version fields.
- Replace `RichTextMeta.chars` as the canonical store with metadata that points at or indexes the user-visible rich-text value.
- Keep cache fields JSON-serializable:
  - `charIndexById: Record<RichTextOpId, number>`
  - `childrenByAfterId: Record<string, RichTextOpId[]>`, with a stable sentinel key for root/null
  - `visibleCount`
  - `maxOpCounter`
  - optional parsed ID cache as `parsedOpIds: Record<RichTextOpId, {counter: number; actorId: RichTextActorId}>`
- Decide exact durable shape for unresolved operations:
  - insert with missing `afterId` can either be stored as an unreachable char or retained in pending; choose the simpler invariant for cache maintenance,
  - remove with missing `removedId` should be retained in pending and applied when the char exists,
  - mark ops with unresolved anchors should be retained in pending and applied when the anchors resolve.
- Add cache build/repair helpers:
  - build caches from durable rich-text data,
  - validate caches in tests,
  - rebuild caches after import/migration.

## Phase 2: Keep pending, but make it explicit and cheap

Keep unresolved rich-text operations, but remove exception-driven dependency detection and broad retry/cloning costs.

- Keep `pending?: RichTextOperation[]` on the rich-text state, or rename it to `unresolvedOps` if that makes the semantics clearer.
- Define pending precisely:
  - it stores operations that are valid but cannot currently be integrated because referenced chars/anchors are unavailable,
  - it is part of durable rich-text state, not transient control flow,
  - it is JSON-serializable and sufficient to replay when dependencies arrive.
- Replace current `applyRichTextOperation` retry behavior with explicit immutable application:
  - duplicate op returns the same state,
  - insert stores the char immediately when possible, or retains it pending if the chosen invariant requires a resolvable `afterId`,
  - remove marks the target deleted when available, otherwise retains the remove pending,
  - mark/unmark integrates into boundary op sets when anchors resolve, otherwise retains the mark op pending.
- Stop detecting expected missing dependencies via thrown exceptions and regex matching.
- Add direct dependency checks:
  - insert checks `afterId`,
  - remove checks `removedId`,
  - marks check start/end anchor resolution and ordering.
- Retry pending selectively after an operation that could satisfy dependencies:
  - avoid cloning the whole state before knowing anything changed,
  - avoid repeatedly applying permanently unresolved ops in a tight loop,
  - remove ops from pending only when successfully integrated.
- Update CRDT apply so a rich-text update is only document-level pending when the field itself is missing or the path/incarnation is not ready. Rich-text-internal references should not push the parent CRDT update into `doc.pending`.
- Update tests around nested pending to assert retained unresolved operations and later integration once dependencies arrive.

## Phase 3: Make materialization and integration tolerate unresolved data

Materialization should not crash when the retained state contains unresolved operations. Pending ops that have not been integrated should not affect output.

- Replace assumptions that every `afterId` exists.
- Materialize by traversing from root/null through reachable children only.
- Preserve the current sibling ordering rule.
- Ensure children of unreachable parents are also ignored until the parent becomes reachable.
- If inserts with missing `afterId` are stored directly, materialization ignores them until reachable.
- If removes/marks stay pending until integrated, materialization can continue to read integrated char deletion and boundary mark data only.
- If the durable shape stores any unresolved remove/mark data outside pending, materialization must ignore it until it resolves.
- Add tests for:
  - insert before parent arrives is invisible, then visible after parent arrives,
  - child chain under a missing parent becomes visible together,
  - remove before insert suppresses the char once insert arrives,
  - mark before anchor arrival takes effect after anchors arrive,
  - malformed cyclic/unreachable graphs do not crash materialization.

## Phase 4: Optimize sequence application

Remove full-document clones and sort-on-every-insert.

- Make duplicate insert and duplicate/already-applied remove return the same state.
- Replace `sortChars` in `applyInsert` with incremental cache updates:
  - update `charIndexById`,
  - update the parent child list in `childrenByAfterId`,
  - insert the op ID into that child list in sibling order,
  - update `maxOpCounter`.
- Keep `sortChars` only as a test/debug/import canonicalization helper, or remove it from hot paths entirely.
- Avoid global afterId validation in `applyInsert`.
- Avoid cloning char metadata arrays unless the operation actually changes durable data.
- Add an optimized `insertMany`/`applyInsertRun`:
  - validates/builds the whole run once,
  - allocates/appends contiguous durable char entries,
  - updates indexes/counters once,
  - handles sequential `afterId` chaining without repeated sibling sorting.
- Use `insertMany` for paste and rich-text import; evaluate undo/redo once the new durable operation shape is in place.

## Phase 5: Optimize visible index and range helpers

Remove avoidable `visibleChars()` materialization from hot paths.

- Rewrite `insertionAfterIdForIndex` to scan until the target visible index, or use cached visible order if maintained.
- Rewrite `charIdsForVisibleRange` to collect only IDs in the requested visible range.
- Rewrite `anchorsForMarkRange` so it computes needed boundary IDs in one pass.
- Rewrite `insertionAfterIdForIndexPreservingBoundary` to avoid:
  - full visible array allocation,
  - repeated `findIndex`,
  - `slice().filter()` tombstone allocation.
- Consider a cached visible order array if benchmarks show single-pass scans are still too expensive for the target document sizes.

## Phase 6: Optimize op ID parsing and counters

Reduce repeated regex parsing in comparison and allocation paths.

- Replace `tryParseOpId` try/catch with explicit validation that returns `null`.
- Cache `maxOpCounter` in rich-text metadata and update it incrementally for every applied/stored rich-text operation.
- Make `allocateOpIds` read the cached counter instead of scanning chars and mark boundaries.
- Avoid reparsing IDs in `compareOpIds` where possible:
  - use metadata parsed cache, or
  - parse once when hydrating/building cache, or
  - store parsed counter/actor next to durable operations if that proves simplest and remains JSON-safe.
- Keep `parseOpId` throwing for external validation/error-reporting APIs, but keep hot paths on non-throwing helpers.

## Phase 7: Migrate callers and public APIs

Move the sentinel/data split without breaking existing behavior.

- Update `richText()` to create the new user-visible empty rich-text value.
- Update `materializeRichText` to read rich-text data from `doc.state` and use metadata caches from `doc.meta`.
- Update document creation/materialization so rich-text fields are initialized with durable rich-text JSON in state and cache metadata in meta.
- Update patch creation in `src/crdt/updates.ts` to use metadata caches for:
  - insertion point lookup,
  - range lookup,
  - op ID allocation.
- Update undo/redo in `src/crdt/history.ts` to use cached counters and the new durable rich-text state.
- Update import/export helpers to build durable data and cache metadata without repeatedly applying one operation at a time.
- Add migration support for old sentinel-based documents if archive/local storage compatibility matters for existing test fixtures.

## Phase 8: Verification and benchmarks

Lock behavior first, then measure.

- Preserve existing Peritext behavior tests:
  - concurrent sibling order,
  - descendant subtree order,
  - tombstone insertion boundaries,
  - mark range presets.
- Add new unresolved-reference tests from Phase 3.
- Add no-op referential equality tests.
- Add cache rebuild/validation tests.
- Add microbenchmarks for:
  - appending 1k/10k chars,
  - paste/import of 1k/10k chars through `insertMany`,
  - duplicate replay of inserts/removes,
  - delete over large ranges with tombstones,
  - mark/unmark large ranges,
  - collaborative concurrent sibling inserts.
- Run the relevant suites after each phase:
  - `pnpm test src/peritext`
  - `pnpm test src/crdt/richtext.test.ts`
  - broader CRDT/history tests after metadata/state migration.

## Implementation notes

- Keep changes phased so representation changes do not land mixed with all performance rewrites at once.
- Prefer JSON object indexes over `Map`, even internally, unless a transient-only helper is clearly scoped and rebuilt per call.
- Treat caches as derived data. Durable rich-text state must remain sufficient to rebuild all metadata indexes.
- Do not use thrown exceptions for expected unresolved references.
- Be careful with naming: `pending` is acceptable if it specifically means retained unresolved rich-text operations, not a transport queue and not exception-driven control flow.
