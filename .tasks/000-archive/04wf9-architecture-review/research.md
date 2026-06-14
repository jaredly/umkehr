# Architecture Review: `src/block-crdt`

## Scope

Reviewed the current `src/block-crdt` implementation as of this working tree:

- `src/block-crdt/index.ts`
- `src/block-crdt/types.ts`
- `src/block-crdt/utils.ts`
- `src/block-crdt/lseq.ts`
- `src/block-crdt/initialState.ts`
- `src/block-crdt/index.test.ts`
- `src/block-crdt/formatting.test.ts`
- `src/block-crdt/organizeState.stress.test.ts`
- Design notes in `Readme.md`, `Formatting.md`, `Demos.md`, and `notes.md`

The tree already had local modifications in `src/block-crdt/index.ts`, `src/block-crdt/index.test.ts`, and some `examples/block-rich-text` files before this review. I reviewed the current files as-is.

## Executive Summary

The core idea is strong: represent block text as a causal-tree/RGA of stable character ids, make splits and joins non-destructive by moving parent links and adding split/join records, and materialize visible blocks plus formatting from those stable records. The implementation has meaningful tests for concurrent splits, joins, block moves, cycle breaking, formatting over splits, and cache consistency.

For a first public release, the main issue is not lack of cleverness. It is that too much of the algorithm's invariants are implicit and exposed directly through low-level public types and operations. `index.ts` currently combines the op algebra, conflict resolution, cache maintenance, block tree derivation, text traversal, formatting traversal, and high-level command construction in one file. That makes the implementation harder to audit and easier for callers to misuse.

I would not treat the current public API as release-ready. I would keep the core model, but tighten the boundaries: separate the apply engine from commands/materializers, introduce typed constructors for all ops, define pending-op semantics explicitly, and replace ad hoc timestamp unions with named conflict-resolution types and comparators.

## What Is Working Well

- The representation preserves stable char ids through deletion, split, join, and block movement. This is the right foundation for retained selections, formatting, and history.
- Character deletion and block deletion are monotonic tombstones, which keeps convergence simple.
- Blocks use LSEQ ids for sibling order instead of relying only on Lamport order. That is appropriate for repeated user-driven reordering.
- Join records are independent records rather than destructive char/block rewrites. `organizeState` derives synthetic join sentinels from active joins, which keeps the stored state compact.
- Block nesting cycles are handled deterministically by deriving materialized parents and rejecting a cycle root, rather than letting traversal loop forever.
- Tests cover a lot of the real hard cases: concurrent split/split, split/insert, join/insert, nested block moves, duplicate inserts, tombstones, formatting across splits and joins, and cache equality against `organizeState`.

## High-Priority Findings

### 1. Public ops expose too many internal invariants

`Op` is a raw union of storage-level records in `src/block-crdt/index.ts:18`. Callers can construct `char`, `block`, `char:move`, `block:move`, `mark`, `split-record`, and `join-record` directly. Several of those records require non-obvious invariants:

- `Char.parent.ts` must be `''` for normal inserts, a string for intentional moves/joins, or a tuple for incidental split moves.
- `Block.order.path` must be non-empty, omit root, end with the block id, and reference known blocks.
- `SplitRecord.left/right` are not just endpoints; formatting traversal interprets `left` as "walk left tail, then jump".
- Join records create synthetic char records whose id is the right block id.

Some constructors exist (`charOp`, `split`, `join`, `markRange`), but the raw op types are still the public shape. This is fragile for release.

Recommendation: split API into:

- `InternalOp`: current low-level persisted operation shape.
- Change creation functions: user-facing constructors such as `insertTextOps`, `splitBlockOps`, `joinBlocksOps`, `moveBlockOps`, `setBlockMetaOps`, `deleteRangeOps`, `markRangeOp`.
- Validation helpers that can be run at boundaries: `validateOp`, `validateState`, `assertCacheConsistent`.

### 2. Out-of-order dependency handling is inconsistent

`apply` returns `false` for missing chars, missing blocks, and missing block ancestors in many places. `applyMany` immediately throws `op was pending` on `false` (`src/block-crdt/index.ts:456`). That is reasonable for ordered batches, but insufficient as a sync-layer contract.

More concerning: `applyCharMove` allows moving a char under a missing parent (`src/block-crdt/index.ts:168`). The test suite codifies this at `src/block-crdt/index.test.ts:1261`: "allows char moves to point at missing parents". This can hide text from visible traversal until the parent arrives, and there is no explicit pending index or revalidation step.

Recommendation: make one of these contracts explicit:

- Strict apply: any op that references a missing parent returns `pending`, including `char:move`.
- Lenient apply: missing-parent char moves are allowed, but the state type must expose unresolved references and the sync layer must retry/materialize when dependencies arrive.

The current mixed behavior is hard to reason about publicly.

### 3. Timestamp/conflict-resolution semantics need names and tests as first-class units

`CharParentTs` and `BlockOrderTs` are string-or-tuple unions (`src/block-crdt/types.ts:42`). The comparators `laterCharParentTs` and `laterBlockOrderTs` encode important algorithmic meaning but are private ad hoc functions in `index.ts:306` and `index.ts:327`.

The tuple fields are semantically rich:

- char incidental move timestamp: `[baseParentTs, ancestryPath, newTs]`
- block incidental move timestamp: `[baseOrderTs, sourceSiblingIndex, newTs]`

This deserves named types and isolated tests. Right now a reader has to infer why some ancestry comparisons use "later" semantics and how incidental reparenting beats or loses against intentional moves.

Recommendation:

- Replace tuple aliases with discriminated unions:
  - `{kind: 'insert' | 'intentional' | 'incidentalSplit'; ...}`
  - `{kind: 'explicit' | 'incidentalUnindent'; ...}`
- Export/test `compareCharParentVersion` and `compareBlockOrderVersion`.
- Document the ordering law each comparator is supposed to satisfy.

### 4. `index.ts` has too many responsibilities

`src/block-crdt/index.ts` is doing all of this:

- op application
- timestamp conflict resolution
- state/cache rebuilding
- block parent derivation and cycle breaking
- text traversal
- block traversal
- split and join command generation
- formatting mark creation and materialization
- stress-test strategy exports

The implementation is still small enough to read, but the conceptual load is high. This is exactly the point to split it before public API consumers bind to the current shape.

Suggested module layout:

- `ops.ts`: op types, validators, apply dispatch
- `versions.ts`: Lamport/HLC/version comparators
- `chars.ts`: char tree traversal, insertion positions, split move planning
- `blocks.ts`: block order/path validation, parent derivation, outline traversal
- `joins.ts`: active join selection and sentinel materialization
- `marks.ts`: mark creation, split-aware coverage, mark resolution
- `cache.ts`: cache derivation and incremental cache updates
- `changes.ts`: user-facing change creation functions that return related `Op[]`
- `materialize.ts`: `blockContents`, `stateToString`, formatted blocks, outline

### 5. Cache maintenance is partly incremental, partly full-rebuild

Char insert/move updates `cache.charContents` incrementally (`src/block-crdt/index.ts:181` and `src/block-crdt/index.ts:391`), while block changes and joins rebuild cache via `organizeState` (`src/block-crdt/index.ts:251`, `src/block-crdt/index.ts:302`, `src/block-crdt/index.ts:137`). Tests compare cache output after many operations, which is good.

The risk is not current correctness so much as maintainability: every new op must know whether it can safely mutate part of the cache or must rebuild all derived structures. Join sentinels complicate this because they are derived records inserted into `charContents`.

Recommendation: centralize cache update policy. Either:

- always rebuild for correctness first, then optimize with a documented incremental layer, or
- define cache mutation helpers per derived index and never modify cache records inline in apply handlers.

### 6. Formatting materialization is coherent but expensive and semantically dense

Formatting scans all marks, computes all covered char ids, then materializes visible blocks (`src/block-crdt/index.ts:1113`). Mark coverage depends on split records, `crossedSplits`, join-style parent detection, and synthetic join sentinels (`src/block-crdt/index.ts:1166` through `src/block-crdt/index.ts:1249`).

This is acceptable for a prototype and likely fine for small docs, but public release should not leave complexity and expected cost unstated. The safety bound `sequence.length + splits * 20 + 20` is also a heuristic (`src/block-crdt/index.ts:1178`).

Recommendation:

- Document mark semantics in a release-facing spec.
- Add tests for multiple marks across multiple nested/concurrent splits with joins and deletes.
- Consider a formatting index/cache later, but first make `coveredCharIdsForMark` standalone and heavily property-tested.

### 7. String encoding of Lamports is convenient but leaky

`lamportToString` pads the counter to 4 digits (`src/block-crdt/utils.ts:35`) and many ordering decisions rely on lexicographic string sorting for char ids (`src/block-crdt/index.ts:445`, `src/block-crdt/index.ts:850`). Padding means lexical order is only safe while counters remain within the padded width. Once counters exceed 9999, `10000-actor` sorts before `9999-actor` lexicographically.

If descending Lamport order is algorithmically important, this should use `compareLamports(parseLamportString(...))`, not string comparison.

Recommendation: do not use encoded ids for semantic ordering. Keep encoded ids as map keys only. Introduce `compareLamportStrings` if needed.

### 8. `maxSeenCount` is not consistently updated from operation ids

Some handlers update `maxSeenCount` with the op target id rather than all ids in the op payload. For example `applyBlockMeta` only considers `op.id[0]`, not `op.meta.ts` because HLC is string, while `applyCharMove` considers `op.parent.id[0]` but not any Lamports inside a tuple parent timestamp except on insert reapplication. `applyJoinRecord` includes `join.id`, `left`, `right`, and `tail`.

This may be fine if Lamport counters and HLC timestamps are separate domains, but the release contract is unclear. Since new ids are generated from `state.maxSeenCount + 1`, every op carrying a Lamport should be audited to ensure future local ids cannot collide with remote ids.

Recommendation: centralize `maxLamportCounterForOp(op)` and use it in every apply branch.

### 9. Error/return semantics are not cleanly separated

The code currently:

- returns `false` for pending/missing dependencies,
- throws for malformed paths or conflicting duplicate records,
- silently ignores stale operations,
- returns unchanged state for idempotent duplicates.

Those are all reasonable categories, but the public return type `CachedState | false` does not name them.

Recommendation: introduce an apply result:

```ts
type ApplyResult =
    | {status: 'applied'; state: CachedState}
    | {status: 'ignored'; state: CachedState; reason: 'stale' | 'duplicate'}
    | {status: 'pending'; missing: Lamport[]}
    | {status: 'invalid'; error: Error};
```

Then keep a throwing `applyManyStrict` convenience for tests and command batches.

## API Design Notes

The API should be optimized for editor/runtime authors, not CRDT authors. A good public surface would make the common path straightforward:

- initialize a document
- insert text at a visible block/offset
- split/join blocks
- indent/unindent/move blocks
- delete text/ranges
- set block metadata
- apply formatting
- materialize visible blocks/runs
- serialize/deserialize operations or state
- apply remote ops with pending dependency handling

Today, the caller must know too much about Lamports, block paths, LSEQ ids, split records, parent timestamps, and cache shape.

Proposed high-level shape:

```ts
const ops = splitBlockOps(state, {
    actor,
    blockId,
    offset,
    ts,
});

const nextState = applyMany(state, ops);
```

For convenience, the package could also expose paired helpers that return both ops and the applied state:

```ts
const {ops, state: nextState} = splitBlock(state, {
    actor,
    blockId,
    offset,
    ts,
});
```

The important boundary is not a transaction object. It is that public change creation functions encode user intent into a related array of low-level ops, while the op format remains the replication/persistence format.

## Test Coverage Assessment

Strong existing coverage:

- split at multiple positions and tree-shaped text
- concurrent split/split and split/insert
- join with concurrent inserts into left/right/start-of-right
- idempotent deletes and duplicate inserts
- block move conflict resolution
- block path validation and cycle breaking
- formatting over deletes, splits, joins, and generated marked documents
- grapheme insertion via `Intl.Segmenter`
- cache consistency against full rebuild after many operations

Important gaps before public release:

- Property tests for convergence across random mixed operations: insert, delete, split, join, move block, mark, unmark.
- Property tests for all op order permutations within causally valid change batches.
- Pending/out-of-order op tests with explicit dependency resolution.
- Serialization round-trip tests for `State`, `Op`, `LseqId`, and Lamport ids.
- Tests with Lamport counters above 9999 to catch string-order bugs.
- Tests for actor ids containing `-`, since `parseLamportString` splits on `-` and currently assumes the actor id has no delimiter.
- Tests for malformed LSEQ ids and decode/encode edge cases.
- Performance benchmarks that run in CI in a bounded way, not only opt-in stress tests.
- Long-document tests for formatting materialization cost.
- Tests for empty blocks plus marks/joins/splits interaction.

## Documentation Gaps

The existing docs are useful design notes, but they are not yet a public release spec. Before release, write:

- A data model spec: `State`, `Op`, `Block`, `Char`, `Mark`, `SplitRecord`, `JoinRecord`.
- A convergence/invariant spec: what must remain true after applying ops.
- A command semantics spec: insert, split, join, delete, move, mark.
- A sync contract: causality expectations, pending ops, idempotency, invalid ops.
- A performance note: expected complexity and document size assumptions.
- API examples that do not require constructing raw ops manually.

## Suggested Refactor Plan

1. Freeze the current behavior with a broader mixed-operation convergence test suite.
2. Introduce named apply result statuses while keeping the old throwing helpers for compatibility.
3. Extract comparator/version logic into `versions.ts` with isolated tests.
4. Extract block parent derivation/cycle handling into `blocks.ts`.
5. Extract char traversal and split move planning into `chars.ts`.
6. Extract join sentinel logic into `joins.ts`.
7. Extract mark traversal/materialization into `marks.ts`.
8. Add high-level change creation functions and mark raw constructors as internal.
9. Replace semantic string sorting of Lamport ids with Lamport comparators.
10. Write release-facing docs from the extracted modules' invariants.

## Open Questions

- What is the intended network contract: are remote ops always causally ordered within a generated change batch, or must `apply` handle arbitrary out-of-order delivery?
    - apply must handle arbitrary out-of-order delivery, but can respond with `pending` to indicate that the operation depends on other operations that have not yet been seen
- Should `char:move` to a missing parent remain valid, or should it be pending like missing block ancestors?
    - let's go with pending
- Are actor ids allowed to contain `-`? If yes, `parseLamportString` needs a different encoding.
    - no
- Are HLC strings guaranteed to be lexicographically sortable forever, including across actors/devices?
    - yes
- Is the public operation format intended to be stable for persistence, or can it still change before release?
    - we can make changes if needed
- Should formatting be part of the core CRDT package or layered as an optional materializer over stable char ids?
    - formatting is pretty deeply tied to the CRDT implementation. I don't know that there's a way to make it an optional layer
- Should block metadata be open/extensible, or is the current union the intended public schema?
    - block metadata should really be a type argument, the only restriction is that it must have a `ts` field
- What is the target document scale for public release: hundreds, thousands, or tens of thousands of blocks/chars?
    - ideally I'd like to support thousands of blocks, but certainly many hundreds. chars would be one or two orders of magnitude larger
- Should joins be user-visible as archived/hidden blocks, or purely a materialization detail?
    - joined blocks are semantically hidden
- Is undo/redo expected to operate by inverse ops, history snapshots, or UI-layer change batches?
    - it will be executed by producing Ops that undo the given changes made

## Bottom Line

The implementation is promising and already handles several hard collaborative editing cases that many block editors avoid. I would keep the algorithmic direction. The release work should focus on making the invariants explicit, making dependency handling unambiguous, narrowing the public API, and separating the core modules so future changes can be audited locally instead of by rereading all of `index.ts`.
