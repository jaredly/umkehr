# CRDT Proof-Confidence Tests

The CRDT invariant suite lives mainly in `proof.test.ts`, with shared helpers in
`proofTestHelpers.ts`.

The tested claim is intentionally precise:

> For valid CRDT updates produced by honest replicas from the same initial document and schema,
> replicas converge in materialized state and canonical metadata under arbitrary duplicate and
> reordered eventual delivery, except that permanently missing causal parents may leave non-ready
> updates pending.

The suite covers:

- targeted regression cases for LWW fields, records, arrays, tagged unions, pending updates,
  duplicate delivery, and HLC suffix ordering;
- array `insert`, `setOrder`, child edit, delete, and order-free tombstone behavior across
  reordered delivery;
- generated histories with `fast-check`;
- bounded exhaustive permutations for the highest-risk record, array, and tagged-union cases;
- a test-only reference model that is independent of production `apply`, `path`, `metadata`, and
  `materialize` helpers;
- migration replay/convergence checks in `src/migration/migration.test.ts`.

The suite does not claim Byzantine tolerance, root tombstone support, tombstone garbage collection,
or fractional-order rebalancing. Update validation is tested at network/storage boundaries and is
not part of `applyCrdtUpdate` itself.

Array inserts are modeled as their own CRDT update kind. Array item paths carry stable item ids and
parent incarnation timestamps, but not order values. Deleted array item metadata stores only the
deletion timestamp.
