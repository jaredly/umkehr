# CRDT proof confidence plan

## Goal

Build executable confidence that `umkehr/crdt` has the CRDT properties we intend to claim:

- replicas converge when they receive the same valid updates, regardless of delivery order;
- duplicate delivery is harmless;
- out-of-order delivery either settles correctly through `pending` or safely leaves non-ready updates pending;
- delayed child updates cannot attach to the wrong container/tagged-union/array-item incarnation;
- materialized state and canonicalized metadata converge;
- valid update histories continue to validate against the configured schema.

Formal theorem proving in Rocq/Lean is explicitly out of scope for this pass.

## Decisions

- Convergence should compare both materialized state and canonicalized metadata.
- Pending queues do not need byte-for-byte equality. The invariant is that no pending update is currently ready to apply.
- Root tombstones do not need support.
- Non-identical updates must not share the same timestamp. Equal timestamps are only acceptable for identical duplicate updates.
- Array item inserts can continue to assume one insert per timestamp.
- Fractional index growth is acceptable; no rebalancing is required.
- Unknown-item `setOrder` updates can remain pending indefinitely.
- No tombstone or pending-update garbage collection is required.
- `applyCrdtUpdate` should stay fast and should not perform schema validation internally.
- Network/storage boundaries own validation. Tests should validate generated/applied updates and materialized states.
- Migration helpers supplied by `umkehr/migration` should preserve CRDT invariants where possible.
- Local undo/redo blocking policy is not part of this CRDT proof pass.
- The CRDT layer should be robust to update duplication and reordering for valid updates from honest replicas.

## Non-goals

- Mechanized proof in Rocq, Lean, TLA+, Alloy, or another theorem system.
- Byzantine/malicious update handling beyond existing validation boundaries.
- Root tombstone semantics.
- Fractional-index compaction/rebalancing.
- Tombstone or pending queue garbage collection.
- Proving local undo/redo UX policy.

## Phase 1: Test harness and invariant helpers

Add a focused test support module, probably `src/crdt/proofTestHelpers.ts` or local helpers in a new `src/crdt/proof.test.ts`.

Helpers:

- `applyAll(doc, updates)`.
- `applySchedule(initial, updates, order)`.
- `duplicateUpdates(updates, policy)`.
- `shuffleDeterministically(updates, seed)`.
- `allPermutationsBounded(updates, max)`.
- `canonicalizeMeta(meta)`.
- `canonicalizeDocument(doc)`.
- `expectConverged(docs)`.
- `expectNoReadyPending(doc)`.
- `expectValidCrdtUpdate(update, validator)`.
- `expectValidMaterializedState(doc, validator)`.

Canonicalization requirements:

- sort object keys recursively;
- sort pending updates deterministically if pending is included in diagnostics;
- preserve all meaningful CRDT metadata: timestamps, tombstones, array item IDs, array order values, tagged branch metadata;
- omit schema objects from equality unless explicitly needed.

`expectNoReadyPending` should detect ready pending updates without changing production behavior. It can attempt to apply each pending update to a cloned doc and fail if the update applies or should have been discarded. The exact implementation can use internal helpers if needed.

Acceptance:

- A simple hand-written convergence test can compare two shuffled schedules.
- Duplicate delivery of an existing scenario update is asserted idempotent.
- Failed convergence errors print enough detail to identify the divergent path/update.

## Phase 2: Targeted invariant regression tests

Add table-driven tests for known dangerous cases before introducing random generation.

Cases:

- primitive LWW set/set with newer, older, and duplicate delivery;
- record entry create/delete/recreate plus delayed child set;
- record entry child set before parent create;
- object field replacement plus delayed nested child set;
- array item insert, child edit before insert delivery, delete, and reorder;
- duplicate array item values moved by item identity;
- concurrent or reordered `setOrder` updates for existing items;
- tagged union branch replacement plus delayed field update for the old branch;
- tagged union branch field update before branch creation;
- HLC packing/comparison, including suffix ordering if accepted by validation;
- generated updates and materialized states validate outside `applyCrdtUpdate`.

For each case, run:

- at least two opposing delivery orders;
- one order with duplicate updates;
- a canonical metadata convergence assertion;
- `expectNoReadyPending` at the end.

Acceptance:

- The new tests pass with `npm test -- src/crdt/proof.test.ts` or equivalent.
- At least one test would fail if parent incarnation checks were removed.
- At least one test would fail if array materialization stopped tie-breaking by item ID.
- At least one test would fail if tagged branch timestamp checks were removed.

## Phase 3: Add property-based testing

Add `fast-check` as a dev dependency unless a lighter existing generator approach is preferred.

Start with one representative fixed schema:

```ts
type ProofState = {
    title: string;
    count: number;
    items: Record<string, {title: string; child: Record<string, {name: string}>}>;
    todos: Array<{id: string; title: string; done: boolean}>;
    selected: {type: 'circle'; radius: number} | {type: 'text'; text: string};
};
```

Generator strategy:

- Generate a small initial state.
- Generate 1-8 local edits.
- Build edits by applying to an author document so every generated patch is valid for the author at creation time.
- Use deterministic HLC timestamps with unique actor IDs.
- Bias toward:
  - record create/delete/recreate;
  - nested child edits;
  - array insert/delete/move/reorder;
  - tagged union replacement;
  - primitive overwrite.
- Generate delivery schedules that:
  - include all updates eventually;
  - reorder updates;
  - duplicate some updates;
  - deliver child updates before parent updates where possible.

Initial properties:

- every schedule reaches the same materialized state;
- every schedule reaches the same canonical metadata;
- applying the same schedule twice does not change the result after the first pass;
- no pending update is ready at the end;
- generated updates validate at network/storage boundaries;
- final materialized state validates against the schema.

Keep run counts modest in default tests so CI remains fast. Larger run counts can be exposed through a separate script or an environment variable.

Acceptance:

- Property tests are deterministic and shrink failures.
- Default run count is fast enough for normal `npm test`.
- A failing seed is printed or reproducible through Vitest/fast-check configuration.

## Phase 4: Bounded exhaustive tests

Add deterministic exhaustive tests for small state spaces where random testing is weakest.

Record model:

- one record key;
- one child field;
- operations: create, child set, delete, recreate;
- timestamps from a small ordered set;
- all operation subsets/sequences up to a small bound;
- all delivery permutations, with optional duplicate injection.

Array model:

- one array;
- two item IDs;
- operations: insert item, set child field, delete item, set order;
- all delivery permutations within a small bound.

Tagged-union model:

- one tagged field;
- two branches;
- operations: set branch A, set branch B, set branch-specific field;
- all delivery permutations within a small bound.

Assertions:

- materialized state converges;
- canonical metadata converges;
- no ready pending updates remain;
- invalid/wrong-incarnation updates do not affect newer incarnations.

Acceptance:

- Exhaustive tests run in bounded time and are included in normal test runs if cheap.
- If runtime is too high, keep a small default bound and document a larger local-only bound.

## Phase 5: Independent executable reference model

Build a small model that does not reuse production apply logic.

Model scope:

- total ordered timestamps;
- stable path/incarnation IDs;
- LWW registers for primitive fields;
- tombstones for deletes;
- arrays as item-ID maps with item value register plus LWW order register;
- tagged union branch identity and branch timestamp;
- materialization by filtering tombstones and sorting arrays by `(order, itemId)`.

The model can initially target the same fixed proof schema rather than arbitrary JSON schema traversal.

Differential tests:

- generate valid operation histories;
- apply them to production `CrdtDocument`;
- apply equivalent abstract operations to the model;
- compare materialized states;
- optionally compare a model-derived canonical metadata projection.

Acceptance:

- The reference model lives only in tests or a clearly internal test helper.
- It does not import `src/crdt/apply.ts`, `src/crdt/path.ts`, or production metadata mutation helpers.
- Differential tests cover at least primitive, record, array, and tagged-union behavior.

## Phase 6: Migration invariant tests

Add migration-focused CRDT invariant coverage after the core convergence harness is in place.

Cases:

- migrated CRDT history replays to the same migrated realized state;
- helper-driven object field rename preserves convergence across delivery schedules;
- helper-driven field drop does not leave ready pending updates;
- helper-driven default insertion preserves schema validity;
- one source update expanding into multiple target updates preserves replay order and convergence;
- array item IDs are preserved across update migration;
- tagged-union migration helpers preserve branch incarnation safety.

Acceptance:

- Migration helper tests use the same convergence helpers as core CRDT tests.
- Broken migration helper output fails through replay mismatch, schema validation, or convergence checks.

## Phase 7: Documentation and proof notes

Update docs once the tests exist.

Add or update:

- `Readme.md` CRDT section with the supported convergence claim.
- `.tasks/proof/research.md` if decisions change during implementation.
- A short `src/crdt` test comment or Markdown note explaining the invariant suite.

The claim should be precise:

> For valid CRDT updates produced by honest replicas from the same initial document/schema, replicas converge in materialized state and canonical metadata under arbitrary duplicate/reordered eventual delivery, except that permanently missing causal parents may leave non-ready updates pending.

Acceptance:

- Documentation does not claim Byzantine tolerance.
- Documentation does not claim root tombstone support.
- Documentation names validation as a network/storage boundary responsibility.

## Implementation order

1. Add the test harness and canonicalization helpers.
2. Add targeted regression/invariant tests.
3. Add `fast-check` and property tests for the fixed proof schema.
4. Add bounded exhaustive tests for record, array, and tagged-union edge cases.
5. Add the independent reference model and differential tests.
6. Add migration invariant tests using the shared harness.
7. Update documentation with the precise CRDT confidence claim.

## Verification

Minimum verification for each implementation pass:

```sh
npm test -- src/crdt/proof.test.ts
npm test -- src/crdt
npm run typecheck
```

Before considering the proof-confidence work complete:

```sh
npm test
npm run typecheck
npm run typecheck:examples
```

If property tests support a larger local run count, run that before major releases.
