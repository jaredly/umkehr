# CRDT proof and confidence research

## Question

We want to demonstrate, or at least build strong confidence, that the current `umkehr/crdt` layer is actually a CRDT: replicas that receive the same logical updates should converge, while preserving the intended semantics around LWW fields, container incarnations, tombstones, stable array IDs, array order, tagged union branches, pending updates, and local undo/redo metadata.

The short version: start with executable invariants and generative testing against the real TypeScript implementation. Add a small independent model for bounded exhaustive/model-checking tests. Treat Rocq/Lean-style proof as useful only after we have a smaller formal spec, because proving the current implementation directly would be expensive and brittle.

## Current implementation shape

The implementation is operation-based:

- `createCrdtUpdates` translates realized `Patch` values into stable CRDT updates.
- `applyCrdtUpdate` applies one remote/local CRDT update to `CrdtDocument`.
- User state is materialized from metadata; CRDT metadata is the source of truth.
- Primitive values use LWW timestamps.
- Containers have creation timestamps.
- Deletes write tombstones.
- Record/object/tagged/array path segments carry parent incarnation timestamps.
- Arrays are stored by item ID, sorted by fractional order keys, and materialized back to ordinary arrays.
- Out-of-order child updates can enter `pending` until the referenced parent incarnation arrives.
- Tagged union field updates include the tag branch and tag timestamp so delayed updates for old branches are discarded.
- Undo/redo is implemented by fresh CRDT updates plus metadata, with guards to prevent undoing superseded effects.

Existing focused tests cover important examples, but they are scenario tests. They do not yet systematically explore update permutations, interleavings, duplicated delivery, causally missing parents, concurrent array operations, or long random histories.

## What we should prove or test

The minimum CRDT invariants should be stated independently from the implementation.

1. **Convergence**

   Given the same initial document and the same set of valid CRDT updates, any delivery order that eventually delivers those updates should materialize the same final state and equivalent metadata, except for allowed differences such as pending queue ordering if all deliverable updates have settled.

2. **Idempotence**

   Applying the same update more than once should not change the materialized result after the first effective application.

3. **Commutativity for concurrent updates**

   For updates that do not have causal parent dependencies, applying `a` then `b` should converge with applying `b` then `a`.

4. **Associativity / replay stability**

   Batching should not matter. Applying a sequence directly, in chunks, or through retained history replay should produce the same document.

5. **Causal delivery tolerance**

   A child update delivered before its parent should either be pending and later apply to the exact parent incarnation it named, or be discarded if a newer/wrong incarnation makes it invalid.

6. **Tombstone and incarnation safety**

   Delayed child writes for deleted or superseded record entries, array items, object containers, or tagged branches must not attach to a later incarnation with the same user-visible key/index.

7. **Array order convergence**

   Concurrent inserts, deletes, reorders, and moves must converge to the same ordered visible array. Ties must be deterministic by item ID.

8. **Schema/materialization validity**

   Applying valid CRDT updates should keep materialized state within the configured schema, except for a root tombstone case if that is intended to be representable.

9. **Pending queue liveness**

   After all causally required parent creation updates have been delivered, retrying pending updates should reach a fixed point with no still-ready update left pending.

10. **Clock ordering sanity**

    HLC packing/comparison must be a total deterministic order. If `hlc.cmp(a, b) > 0`, then `hlc.pack(a) > hlc.pack(b)` must hold for every timestamp shape the CRDT layer accepts.

11. **Undo/redo safety**

    Undo and redo should only generate updates when their target effects are still present and unsuperseded. Generated updates must obey the same convergence/idempotence rules as ordinary edits.

## Option 1: stronger example/unit tests

This is the cheapest layer and should remain in place even if we add heavier methods.

Add table-driven tests for known edge cases:

- every pair/permutation of set/delete/recreate/child-set for records;
- array insert before parent, child edit before item creation, reorder before item creation;
- delete versus child update at older/equal/newer timestamps;
- root replacement/delete interactions;
- tagged union branch replacement versus old/new branch field updates;
- duplicate update delivery;
- equal order values and equal timestamps where validation permits them;
- HLC suffix ordering against plain timestamps.

Pros:

- low setup cost;
- easy to debug;
- documents intended behavior well.

Cons:

- easy to miss interleavings;
- can prove only the cases we remember to write.

Recommended use: keep adding these for every bug or invariant we discover, but do not stop here.

## Option 2: property-based/generative testing against real code

This is likely the best next step.

Use a property-testing library such as `fast-check` for Vitest. Generate small schemas/states or begin with one fixed schema that covers primitives, records, arrays, and tagged unions. Generate random edit histories across multiple actors, translate patches to CRDT updates, then test many delivery schedules.

Useful generators:

- small initial states;
- valid local patches from the current materialized state;
- actor clocks and HLC timestamps;
- delivery schedules with shuffled order, duplicates, drops followed by eventual delivery, and chunked replay;
- operation mixes weighted toward tricky cases: delete/recreate, array move/reorder, nested child writes, tagged union replacement.

Core properties:

```ts
fc.assert(
  fc.property(historyArb, scheduleArb, ({initial, updates}, schedule) => {
    const replicas = schedule.map((order) => applyAll(createDoc(initial), order));
    expect(allMaterializedStatesEqual(replicas)).toBe(true);
    expect(noReadyPendingUpdateRemains(replicas)).toBe(true);
  }),
);
```

Start with materialized state equality. Then add metadata canonicalization once we know which metadata differences are meaningful.

Pros:

- tests the actual implementation;
- quickly explores interleavings humans will not enumerate;
- fits the existing TypeScript/Vitest stack;
- failures can shrink to minimal cases if generators are designed carefully.

Cons:

- requires careful valid-operation generation;
- random tests can be flaky if clocks or schedules are not deterministic;
- does not prove absence of bugs, but gives strong practical evidence.

Recommended use: first priority.

## Option 3: differential testing with a small reference model

Build an independent, intentionally simple model of the CRDT semantics. It should not share code with `src/crdt/apply.ts`; otherwise we only test the implementation against itself.

Possible reference model:

- represent every logical register as a map from stable address to `{timestamp, value/tombstone}`;
- represent arrays as an observed-remove map of item IDs plus LWW order registers;
- represent parent incarnations explicitly;
- materialize by filtering tombstones and sorting arrays.

Then generate operations and assert that the production implementation and model materialize the same state after every replay schedule.

Pros:

- catches implementation bugs even when high-level convergence still happens accidentally;
- forces us to clarify ambiguous semantics;
- serves as a bridge toward formalization.

Cons:

- the model can be wrong too;
- maintaining two semantics costs time;
- some details, especially schema/tagged-union traversal, may be tedious.

Recommended use: second priority after basic property testing is working.

## Option 4: bounded exhaustive testing / model checking

For small domains, exhaustive checks can be more convincing than random fuzzing.

Examples:

- one record key, one nested child field, timestamps `1..4`;
- one array with two item IDs and two order values;
- one tagged union with two branches and one field each.

Enumerate all valid update sets up to size `N`, all permutations, and all duplicate-injection cases up to a bound. Assert convergence and pending fixed-point invariants.

This can be implemented directly in Vitest, or in a model checker such as TLA+, Alloy, Apalache, or a custom exhaustive TypeScript runner.

Pros:

- excellent for tricky causal/delete/recreate cases;
- deterministic and reproducible;
- gives stronger confidence than random testing within the chosen bounds.

Cons:

- state space grows fast;
- bounded results are not full proofs;
- a separate TLA+/Alloy model would need translation back to TypeScript behavior.

Recommended use: targeted at the dangerous semantics: tombstones, parent incarnations, tagged branches, array order.

## Option 5: mutation testing

Use mutation testing to make sure invariant tests actually fail when CRDT logic is broken.

Examples of mutations that should be caught:

- change `newer(order.ts, item.order.ts)` to `>=` or `<`;
- remove the parent incarnation check;
- treat `pending` as `discard`;
- drop array item ID tie-break sorting;
- omit `tagTs` checks;
- stop retrying pending updates after successful apply.

Pros:

- evaluates test quality, not just implementation behavior;
- particularly useful once property tests exist.

Cons:

- slow;
- TypeScript mutation tooling can be noisy;
- not itself a proof.

Recommended use: occasional confidence pass, not required on every normal test run.

## Option 6: theorem proving in Rocq/Lean

A theorem prover can provide the strongest result, but only for a formal model we are willing to maintain. Proving the current TypeScript implementation directly is not realistic.

A reasonable theorem-prover target would be a small abstract CRDT:

- timestamps are assumed to be a total order;
- paths contain parent incarnation IDs;
- each field is an LWW register;
- arrays are maps from item ID to item value register plus LWW order register;
- materialization filters tombstones and sorts by `(order, itemId)`;
- pending is modeled as delivery precondition failure rather than as an implementation queue.

Theorems to prove:

- applying a set of updates is permutation independent;
- duplicate updates are idempotent;
- child updates cannot affect the wrong parent incarnation;
- materialized arrays have deterministic order;
- old tagged-branch field updates cannot affect a newer branch.

Pros:

- strongest possible evidence for the abstract design;
- forces precise definitions;
- useful as long-lived documentation for CRDT semantics.

Cons:

- high learning and maintenance cost;
- proof will cover the model, not automatically the TypeScript implementation;
- arrays/fractional indexing and schema traversal may be awkward;
- premature if semantics are still changing.

Rocq versus Lean:

- Rocq has a long history for mechanized programming language and distributed-system proofs.
- Lean has strong modern ergonomics and active math/library tooling.
- For this project, ecosystem differences matter less than scoping the model small enough. Either is viable if someone on the team is willing to own it.

Recommended use: later, after generative tests and a reference model expose and stabilize the semantics.

## Option 7: executable spec plus literate proof notes

A pragmatic middle ground is to write a small executable spec and a proof sketch in Markdown:

- define update semantics as pure functions over maps/registers;
- state lemmas informally but precisely;
- link each lemma to property tests and bounded exhaustive tests;
- keep implementation-specific caveats separate.

This gives most of the communication benefit of a proof without the theorem-prover overhead.

Recommended use: high value. It can evolve into TLA+/Lean/Rocq later.

## Recommended plan

1. **Write the invariant list as executable helpers**

   Add helpers for `applyAll`, update shuffling, duplicate injection, pending fixed-point checks, metadata canonicalization, and schema validation.

2. **Add property tests for one representative schema**

   Use the existing CRDT test schema or a new schema containing:

   - primitive field;
   - record of nested objects;
   - array of objects;
   - tagged union.

   Keep generated histories short at first, for example 1-8 edits and 2-3 replicas.

3. **Add targeted bounded exhaustive tests**

   Focus on the highest-risk cases:

   - record entry create/delete/recreate plus delayed child write;
   - array item create/delete/reorder plus delayed child write;
   - tagged union branch replacement plus delayed branch field write.

4. **Build a reference model only after properties are stable**

   Once property tests uncover the awkward cases, encode the simplified model and run differential tests.

5. **Decide on formal proof only after the spec stops moving**

   If we still want a theorem prover, prove the simplified model first. Do not attempt to prove the full TypeScript implementation.

## Open questions

- What is the exact equality target for convergence: materialized state only, or canonicalized metadata as well?
  - metadata must also converge
- Should pending queues be required to converge exactly, or only to contain no update that is currently ready to apply?
  - contain no update that is ready
- Are root deletes/replacements part of supported CRDT behavior, and what should materialization return for a root tombstone?
  - no root tombstone support required
- Are equal timestamps considered invalid at the protocol layer, or should every operation have deterministic behavior even with equal timestamps?
  - we should never have ops that are not identical which have equal timestamps
- Array item IDs currently use the update timestamp for adds. Is the system assuming one array insert per timestamp globally? If not, do we need command sequence or path-derived suffixes?
  - yeah one insert per timestamp
- Can fractional order keys grow without bound under repeated moves, and do we need rebalancing? If yes, how does rebalancing remain convergent?
  - grow without bound, no rebalancing required
- Should `setOrder` for unknown item IDs remain pending forever, or can it be garbage-collected after a known causal frontier?
  - remain pending
- What is the retention/garbage-collection story for tombstones and pending updates?
  - we don't have one currently, which is fine
- Should schema validation be part of `applyCrdtUpdate`, or only part of network/storage boundaries?
  - network & storage owns data validation. some of our test code should do validations after doing applyCrdtUpdate to assert that things still conform, but validation should not be done inside of applyCrdtUpdate. it shoudl be as fast as is reasonable.
- Do migrations preserve CRDT invariants for retained histories, especially when one source update expands into many target updates?
  - yes we want migrations to preserve CRDT invariants. obviously users are free to write their own migrations which might be broken, but the 'migration helper functions' that we supply should be impossible to misuse
- Which behaviors are CRDT core semantics versus local-history UX semantics? Undo/redo uses CRDT updates, but its blocking policy is not necessarily a CRDT invariant.
  - yeah we don't need to worry about undo/redo for the proof
- Do we want to claim operation-based CRDT convergence under arbitrary network duplication/reordering, or only under validated updates from honest replicas?
  - we do want to be robust under duplication/reordering, if at all possible

## Bottom line

The best confidence-per-effort path is:

1. property-based tests against the real implementation;
2. bounded exhaustive tests for the known hard cases;
3. an independent executable model for differential testing;
4. optional theorem proving over the simplified model once the semantics are stable.

Rocq or Lean can be valuable, but they should not be the first move. The immediate gap is broader executable evidence around convergence, idempotence, out-of-order delivery, and incarnation safety.
