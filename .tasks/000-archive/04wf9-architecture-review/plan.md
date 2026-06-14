# Plan: Tighten `src/block-crdt` Before Public Release

## Goals

- Keep the current algorithmic direction: stable char ids, non-destructive split/join records, LSEQ block order, deterministic materialization.
- Make the implementation easier to audit by separating responsibilities currently concentrated in `index.ts`.
- Preserve low-level `Op[]` as the replication/persistence format.
- Add public change creation functions that produce related `Op[]` for user intents.
- Make arbitrary out-of-order remote apply safe by returning explicit `pending` results for missing dependencies.
- Improve release confidence through broader convergence, pending-op, serialization, and performance tests.

## Policy Decisions From Open Questions

- Remote ops may arrive in arbitrary order. `apply` must handle this and return `pending` when dependencies are missing.
- `char:move` to a missing parent should be pending, not accepted into state.
- Actor ids are not allowed to contain `-`.
- HLC strings are guaranteed lexicographically sortable.
- The public operation format can still change before release.
- Formatting stays in the core CRDT package because it is tightly coupled to split/join semantics.
- Block metadata should become generic. The only core requirement is a `ts` field.
- Target scale is thousands of blocks, with chars one or two orders of magnitude larger.
- Joined blocks are semantically hidden.
- Undo/redo should be implemented by producing normal ops that undo prior changes.

## Phase 1: Lock Current Behavior With Tests

Purpose: create a safety net before structural refactors.

Tasks:

- Add a mixed-operation convergence property test covering insert, delete, split, join, block move, mark, and unmark.
- Add causally valid op-order permutation tests for generated change batches.
- Add explicit out-of-order tests where `apply` returns `pending`, dependencies arrive later, and retrying converges.
- Add tests that `char:move` with a missing parent returns `pending`.
- Add tests with Lamport counters above `9999` to prove encoded string ordering is not used semantically.
- Add tests that actor ids containing `-` are rejected at construction/validation boundaries.
- Add serialization round-trip tests for `State`, `Op`, `Lamport`, and `LseqId`.
- Add formatting stress cases for multiple marks across nested/concurrent splits, joins, deletes, and empty blocks.

Exit criteria:

- Existing behavior is documented by tests.
- Expected policy changes, especially pending `char:move`, have failing tests before implementation and passing tests after.

## Phase 2: Define Apply Results And Dependency Semantics

Purpose: replace `CachedState | false` with a public result model that can support arbitrary out-of-order delivery.

Tasks:

- Introduce an `ApplyResult` type:

```ts
type ApplyResult<M extends {ts: HLC} = DefaultBlockMeta> =
    | {status: 'applied'; state: CachedState<M>}
    | {status: 'ignored'; state: CachedState<M>; reason: 'stale' | 'duplicate'}
    | {status: 'pending'; state: CachedState<M>; missing: Lamport[]}
    | {status: 'invalid'; state: CachedState<M>; error: Error};
```

- Keep strict helpers for local batches and tests:

```ts
applyStrict(state, op): CachedState
applyManyStrict(state, ops): CachedState
```

- Add non-throwing batch helpers for sync:

```ts
applyRemote(state, op): ApplyResult
applyRemoteMany(state, ops): {state; applied; ignored; pending; invalid}
```

- Audit every op handler for dependencies:
  - `char`: parent block/char/join sentinel must exist unless parent is known root/block.
  - `char:move`: moved char and new parent must exist.
  - `char:delete`: target char must exist.
  - `block`: all path ancestors must exist.
  - `block:move`: target block and path ancestors must exist.
  - `block:meta`: target block must exist.
  - `block:delete`: target block must exist.
  - `mark`: start/end chars and crossed split ids should be validated or marked pending.
  - `split-record`: left/right chars should exist.
  - `join-record`: left/right blocks and tail anchor should exist.

- Decide which malformed ops are `invalid` versus `pending`.

Exit criteria:

- No valid op is silently dropped because a dependency was missing.
- Missing dependencies are surfaced with enough Lamport ids for a sync layer to retry intelligently.
- Local change batches can still use strict application for simple ergonomics.

## Phase 3: Fix Core Ordering And Identity Utilities

Purpose: remove semantic dependence on encoded strings and centralize id/version handling.

Tasks:

- Add actor id validation that rejects `-`.
- Keep `lamportToString` as a map-key encoding only.
- Replace semantic char id ordering via string comparison with Lamport-aware comparison.
- Add `compareLamportStrings` or avoid string comparison by storing parsed Lamports at sort points.
- Add `maxLamportCounterForOp(op)` and use it in every apply branch.
- Add `maxLamportCounterForState(state)` for validation and migration checks.
- Harden `parseLamportString` with validation and clear errors.
- Harden `decodeLseqId` with validation for malformed encodings.

Exit criteria:

- Counter values above `9999` sort correctly.
- All local id generation is protected from collisions with any Lamport carried by applied remote ops.
- Id encoding constraints are explicit and tested.

## Phase 4: Name Version/Conflict-Resolution Semantics

Purpose: make split/move conflict resolution auditable.

Tasks:

- Extract version logic into `versions.ts`.
- Replace bare tuple aliases with named types. A discriminated union is preferred if the operation format can still change cleanly:

```ts
type CharParentVersion =
    | {kind: 'insert'}
    | {kind: 'intentional'; ts: HLC}
    | {kind: 'incidentalSplit'; baseTs: HLC; ancestryPath: Lamport[]; ts: HLC};

type BlockOrderVersion =
    | {kind: 'explicit'; ts: HLC}
    | {kind: 'incidentalReparent'; baseTs: HLC; sourceIndex: LseqId; ts: HLC};
```

- If preserving tuple wire shape is preferred, introduce named constructors and comparators while keeping serialized tuples internal.
- Export and test:
  - `compareCharParentVersion`
  - `charParentVersionWins`
  - `compareBlockOrderVersion`
  - `blockOrderVersionWins`
- Write tests for intentional move versus incidental split move, concurrent incidental moves, equal HLC tie-breaking, and block incidental reparenting.
- Document each comparator's ordering law in code comments near the comparator, not only in docs.

Exit criteria:

- Conflict resolution can be understood and tested without reading split/join code.
- Version types describe intent instead of requiring tuple-position knowledge.

## Phase 5: Split `index.ts` Into Focused Modules

Purpose: reduce coupling while preserving public exports through a compatibility barrel.

Suggested modules:

- `types.ts`: generic state, blocks, chars, marks, ops.
- `ids.ts`: Lamport encoding/parsing/comparison and actor id validation.
- `versions.ts`: HLC/version comparators.
- `lseq.ts`: sibling ordering ids.
- `cache.ts`: cache derivation and cache validation.
- `blocks.ts`: block path validation, parent derivation, cycle handling, outline traversal.
- `chars.ts`: char traversal, selection positions, tail finding, char move planning.
- `joins.ts`: active join selection, hidden joined block semantics, join sentinels.
- `marks.ts`: mark op creation, split-aware mark coverage, mark resolution.
- `changes.ts`: public change creation functions returning `Op[]`.
- `apply.ts`: apply dispatch and apply result helpers.
- `materialize.ts`: visible text, formatted blocks, string/debug materializers.
- `initialState.ts`: generic initial state creation.
- `index.ts`: public barrel exports.

Refactor order:

1. Move pure utilities first: ids, versions, lseq.
2. Move cache and traversal helpers without behavior changes.
3. Move apply handlers into `apply.ts`.
4. Move split/join/mark creation into `changes.ts` and `marks.ts`.
5. Update imports and keep `index.ts` as a compatibility barrel.

Exit criteria:

- Existing tests pass after each extraction step.
- `index.ts` is no longer a large implementation file.
- Public exports remain intentional and documented.

## Phase 6: Public Change Creation API

Purpose: expose ergonomic functions without introducing a transaction object.

Tasks:

- Define public functions that return related `Op[]`:

```ts
insertTextOps(state, {actor, blockId, offset, text, ts}): Op[]
deleteRangeOps(state, {blockId, startOffset, endOffset}): Op[]
splitBlockOps(state, {actor, blockId, offset, ts, lseqOptions?}): Op[]
joinBlocksOps(state, {actor, leftBlockId, rightBlockId, ts}): Op[]
moveBlockOps(state, {actor, blockId, parentId, index, ts}): Op[]
setBlockMetaOps(state, {blockId, meta}): Op[]
markRangeOp(state, {id, blockId, startOffset, endOffset, type, data, remove}): Op
```

- Consider paired convenience helpers that apply the ops:

```ts
splitBlock(state, args): {ops: Op[]; state: CachedState}
```

- Keep raw op constructors available only where they are genuinely useful for advanced users/tests, or clearly mark them internal.
- Ensure change creation functions validate user-level preconditions and fail with clear errors.
- Update examples to use change creation functions instead of manually assembling raw ops.

Exit criteria:

- A normal editor integration does not need to construct low-level `char:move`, `split-record`, `join-record`, or `block:move` ops directly.
- The replication layer still sends and stores plain `Op[]`.

## Phase 7: Generic Block Metadata

Purpose: allow application-specific block metadata while preserving CRDT timestamp semantics.

Tasks:

- Change core types to be generic:

```ts
type TimestampedMeta = {ts: HLC};
type Block<M extends TimestampedMeta = DefaultBlockMeta> = {meta: M; ...};
type State<M extends TimestampedMeta = DefaultBlockMeta> = {...};
type CachedState<M extends TimestampedMeta = DefaultBlockMeta> = {...};
type Op<M extends TimestampedMeta = DefaultBlockMeta> = ...;
```

- Preserve a default metadata union for existing examples.
- Update `applyBlockMeta` and block insert/merge logic to require only `meta.ts`.
- Move checkbox-specific assumptions out of core if they are not generally valid.
- Update tests to include custom metadata.

Exit criteria:

- Core CRDT no longer hard-codes paragraph/bullets/checkboxes as the only metadata model.
- Existing examples still compile via the default metadata type.

## Phase 8: Formatting And Hidden Join Semantics

Purpose: make formatting a first-class core feature with clear hidden joined-block behavior.

Tasks:

- Keep formatting in core.
- Rename/organize join APIs so joined blocks are explicitly semantically hidden.
- Document that joined blocks remain in state but are omitted from visible materialization.
- Extract mark traversal into testable helpers.
- Replace heuristic traversal safety limits where possible with explicit seen-set cycle protection.
- Add performance notes for mark materialization cost.
- Add tests where marks cross:
  - multiple existing splits,
  - subsequent splits,
  - joins,
  - deleted chars,
  - hidden joined blocks,
  - empty blocks.

Exit criteria:

- Formatting semantics are documented enough for users to predict split/join behavior.
- Hidden joined blocks are represented consistently across block traversal, formatting, and materialization.

## Phase 9: Undo/Redo As Normal Ops

Purpose: support history without adding a separate mutation model.

Tasks:

- Define an undo planner that consumes prior applied ops/change batches and emits new ops.
- Decide undo semantics per op:
  - inserted chars become `char:delete`.
  - deleted chars likely need a new operation if resurrection is supported; otherwise text deletion is not directly undoable without original inverse move/state semantics.
  - block metadata uses a newer `block:meta` with previous metadata.
  - block moves use a newer `block:move` to previous materialized order/path.
  - marks use opposite/remove marks or newer overriding marks.
  - joins/splits may need higher-level inverse planning instead of literal inverse records.
- Prefer undoing user-level change batches rather than arbitrary individual remote ops.
- Add tests for undo under concurrent remote edits.

Exit criteria:

- Undo/redo is expressed as ordinary CRDT ops.
- Undo does not rely on deleting or mutating historical ops.

## Phase 10: Documentation And Release Readiness

Purpose: make the package usable without reading implementation notes.

Tasks:

- Write a public data model spec.
- Write a public op/apply contract, including `pending`, `ignored`, and `invalid`.
- Write a change creation API guide with examples.
- Write split/join semantics documentation.
- Write formatting semantics documentation.
- Write metadata generic documentation.
- Write performance expectations for target document scale.
- Add migration notes if op wire shape changes before release.
- Add a release checklist covering tests, typecheck, docs, and examples.

Exit criteria:

- A user can integrate the CRDT from docs and examples without constructing internal ops manually.
- Public semantics are stable enough for first release.

## Suggested Execution Order

1. Phase 1: tests around current and decided behavior.
2. Phase 2: apply results and pending semantics.
3. Phase 3: id/order utility hardening.
4. Phase 4: named version semantics.
5. Phase 5: module extraction.
6. Phase 6: public change creation API.
7. Phase 7: generic block metadata.
8. Phase 8: formatting/join docs and hardening.
9. Phase 9: undo/redo planning and implementation.
10. Phase 10: release docs.

Phases 7 and 8 can happen before or during module extraction if they become easier while touching the relevant types. Undo/redo can also be postponed until after first release if it is not part of the release promise, but the public API should avoid choices that make op-based undo impossible.
