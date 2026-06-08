# Literature Review: Tree CRDT Cycle Mitigation

## Summary

The `04vvl-block-path` design is not a direct copy of a canonical tree-CRDT move algorithm. It is closest to a family of approaches that store more parent provenance than a bare parent pointer, then derive a valid tree at materialization time.

The nearest conceptual match is Evan Wallace's mutable tree hierarchy CRDT: Wallace stores historical parent edges per node and materializes a valid tree by deterministically ignoring cycle-causing or non-rooted edges. `04vvl` has a similar repair-at-materialization shape, but keeps only one winning order per block and augments that order with the block's target ancestry path.

Compared with move-history approaches such as Kleppmann et al.'s highly-available move operation, `04vvl` trades away some fallback quality and formal operation-preservation semantics in exchange for a smaller, simpler long-term state shape.

## The 04vvl Approach

The proposed model replaces each block's immediate parent field with a path-shaped order:

```ts
type BlockOrder = {
    id: Lamport;
    path: Lamport[];
    index: LseqId;
    ts: BlockOrderTs;
};
```

The path omits the root sentinel and includes the block itself as its final element:

- root block `A`: `[A]`
- `B` under `A`: `[A, B]`
- `C` under `B`: `[A, B, C]`

Each block still has one winning order value, selected using the existing timestamp priority, with `order.id` as a deterministic tie-breaker. The materialized parent is derived from normalized paths rather than directly from raw parent pointers.

The important extra information is the target ancestry context. For example, if two users concurrently perform adjacent indents:

```text
B: [A, B]
C: [B, C]
```

then materialization can normalize `C` to `[A, B, C]`, preserving the likely intent even though `C`'s raw path was produced from a stale local view.

For true cycles:

```text
A: [B, A]
B: [A, B]
```

the materializer detects the cycle and breaks it deterministically, for example by selecting the lowest `order.id` as the participant whose parent edge is rejected:

```text
A: [A]
B: [A, B]
```

The resulting raw replicated state may temporarily describe an invalid graph, but the materialized view must be convergent, root-reachable, and cycle-free.

## Prior Work

### Evan Wallace: Mutable Tree Hierarchy CRDT

Wallace's algorithm is the closest prior design. It starts from the observation that naive last-writer-wins parent pointers can create cycles under concurrent moves. Instead of storing only the latest parent, each node stores a history of parent assignments. Materialization chooses each node's latest parent where possible, then repairs invalid structure by falling back to older parent edges.

Similarities:

- Both defer cycle handling to deterministic materialization.
- Both allow the raw replicated data to contain parent information that cannot all be accepted in the final tree.
- Both preserve convergence by making the repair rule deterministic.
- Both treat cycle prevention as a derived-view problem rather than rejecting local moves through coordination.

Differences:

- Wallace stores all historical parent candidates for a node.
- `04vvl` stores only one winning order per block.
- Wallace can fall back to an older valid parent for the same node.
- `04vvl` cannot fall back to an older order for the same block, but can reparent the cycle-break winner to a deterministic valid non-cycle prefix that appears in at least one current path of the cycle participants.

This makes `04vvl` more compact but less expressive during repair.

Reference:

- Evan Wallace, "CRDT: Mutable Tree Hierarchy": https://madebyevan.com/algos/crdt-mutable-tree-hierarchy/

### Kleppmann et al.: A Highly-Available Move Operation for Replicated Trees

Kleppmann et al. present a formally verified algorithm for highly-available tree moves. The algorithm orders move operations and applies them in a way that skips or neutralizes moves that would create cycles. Later work adapts this style to JSON CRDTs using restore-apply-reapply behavior.

Similarities:

- The target problem is the same: replicated tree moves without coordination.
- Both approaches require deterministic cycle prevention.
- Both preserve a convergent materialized tree.

Differences:

- Kleppmann et al. treat move operations as semantically important historical records.
- `04vvl` keeps only the current winning order per block.
- Kleppmann's approach can reason about the state before and after each move.
- `04vvl` reasons from the current set of winning ancestry paths.
- Kleppmann's algorithm gives stronger formal operation-preservation semantics, but has a more complex state/application model.

`04vvl` is therefore more compact and easier to integrate into the existing block CRDT, but it does not attempt to preserve the maximal valid subset of historical moves.

References:

- Martin Kleppmann et al., "A highly-available move operation for replicated trees": https://martin.kleppmann.com/papers/move-op.pdf
- Martin Kleppmann, "Moving Elements in List CRDTs": https://martin.kleppmann.com/2020/04/27/papoc-list-move.html

### Da and Kleppmann: Extending JSON CRDTs with Move Operations

Da and Kleppmann extend move semantics to JSON-like CRDTs, where objects may be nested under maps and lists. This work is relevant because JSON documents have tree structure plus ordered list positions, similar to block outlines with sibling order.

The design remains operation-history based. It is therefore closer to Kleppmann et al.'s move algorithm than to `04vvl`.

Relevance to `04vvl`:

- Useful comparison for ordered tree/list interaction.
- Useful warning that move semantics become harder when hierarchy and order are intertwined.
- Less directly similar because `04vvl` avoids operation replay as the main materialization mechanism.

Reference:

- PaPoC 2024 / Automerge JSON CRDT move work: https://martin.kleppmann.com/2024/04/22/json-crdt-move.html

### Nair et al.: Maram / Safe Replicated Trees

Nair et al. study coordination-free replicated trees and classify concurrent moves into safe and unsafe cases. Their Maram algorithm computes a convergent safe result without requiring rollbacks in the same way as earlier algorithms.

Similarities:

- Both seek coordination-free, convergent tree materialization.
- Both distinguish benign concurrent moves from cycle-forming conflicts.
- Both try to avoid rejecting all concurrent structure changes unnecessarily.

Differences:

- Maram is still fundamentally move-operation based.
- Its repair behavior is based on formal dependency and safety analysis.
- `04vvl` uses current path records and deterministic graph normalization.

Maram is more ambitious about preserving a safe subset of concurrent moves. `04vvl` is more compact and implementation-local, but provides weaker semantic guarantees about preserving the best valid history.

Reference:

- Nair et al., "A coordination-free, convergent, and safe replicated tree": https://arxiv.org/abs/2103.04828

### Martin, Ahmed-Nacer, and Urso: Abstract Tree CRDTs

Earlier work on abstract unordered and ordered tree CRDTs studies how to derive valid tree structures from CRDT components, including policies for repairing tree-specific anomalies such as cycles.

This line of work supports the general idea that a replicated structure can store raw facts and use a deterministic correction policy to expose a valid tree. It is less directly comparable to `04vvl` because it predates the more specific move-operation algorithms and does not match the one-winning-path-per-block design.

Reference:

- Martin, Ahmed-Nacer, and Urso, "Abstract unordered and ordered trees CRDT": https://arxiv.org/abs/1201.1784

## Advantages of 04vvl Over History-Based Designs

### Bounded Per-Block Move Metadata

The clearest advantage is long-term metadata size.

In `04vvl`, each block stores one winning order:

```ts
{ id, path, index, ts }
```

Older moves for the same block are not required for materialization once they lose the order comparison. Long-term hierarchy metadata grows with roughly:

```text
number of blocks * average stored path length
```

instead of:

```text
number of moves ever performed
```

This is important for long-lived block editors. A user may move the same block many times over weeks or months. A history-retaining tree CRDT can accumulate unbounded move metadata even if the visible document remains small. `04vvl` avoids that class of growth.

The caveat is that full ancestry paths can themselves become large in deep outlines. In the worst case, storing full paths gives `O(depth)` metadata per block order. That is still usually better than retaining every historical move, but deep-chain behavior needs performance testing and possibly path compression or capped ancestry certificates.

### Simpler Replicated State Shape

`04vvl` preserves the current "one active order per block" model. That makes the state easier to:

- serialize,
- inspect,
- diff,
- compact,
- migrate,
- and reason about in tests.

Move-history algorithms require either a retained operation log, a set of historical parent edges, or replay metadata. Those designs are more expressive but more complex.

### Straightforward Compaction

Because obsolete order values are not needed for correctness, compaction is conceptually simpler. Once replicas have converged on a newer winning order for a block, older move records do not need to be kept as fallback candidates.

In Wallace-style designs, older edges may still matter because they can become the fallback when a newer edge participates in a cycle. In Kleppmann-style designs, historical move ordering is part of the semantics. That makes compaction more subtle.

### Better Context Than Bare Parent Pointers

`04vvl` is more expressive than a naive parent register. A bare parent pointer says only:

```text
C.parent = B
```

A path says:

```text
C.path = [A, B, C]
```

or, under a stale concurrent edit:

```text
C.path = [B, C]
```

This target ancestry context lets materialization reconcile adjacent concurrent indents in a way that a simple parent pointer cannot.

### Good Fit for Ordered Block Outlines

The design separates the three concerns needed by the block CRDT:

- `order.path`: hierarchy
- `order.index`: sibling order
- `order.ts` / `order.id`: conflict priority

That maps cleanly onto the existing ordered block model. The hierarchy repair pass does not need to own sibling ordering; it only decides each block's materialized parent.

### No Operation Replay for the Normal View

The materialized outline can be derived from the current block records. It does not need an undo-do-redo or restore-apply-reapply pass over a move log.

That is a practical implementation advantage. It reduces the number of moving parts in the cache builder and makes the normal read path easier to test with direct state fixtures.

### Inspectable Conflict Outcomes

When a cycle is found, the planned rule is local and inspectable:

- identify the cycle participants,
- choose a deterministic cycle-break winner,
- reject that winner's cycle-forming parent edge,
- reparent the winner to a deterministic valid non-cycle prefix that appears in at least one current path of the cycle participants,
- normalize the remaining paths through that repaired prefix.

This can produce outcomes that are easy to explain in tests and debugging tools. The fallback parent is not invented: it is ancestry context witnessed by one of the conflicting current paths. It may not always preserve the best historical user intent, but the reason for the result is local and inspectable.

## Tradeoffs and Risks

### Weaker Fallback Semantics

The main cost of compactness is losing older candidate parents.

If a block's current winning path participates in a cycle, `04vvl` cannot recover that same block's previous valid parent unless it is still represented elsewhere in the current path graph. A history-based algorithm may be able to choose the latest older valid parent for that exact block. `04vvl` instead reparents the cycle-break winner to a deterministic valid non-cycle prefix that appears in at least one current path of the cycle participants.

That is weaker than full move history, but it is still semantically meaningful: the repaired parent is based on ancestry context that some replica observed while constructing one of the conflicting paths. The prefix may be root, but root is just one possible valid prefix rather than a separate fallback category.

This is acceptable if the product requirement is:

```text
convergent, cycle-free, compact, preserves common intent
```

It is weaker if the requirement is:

```text
preserve the maximal valid subset of all historical move intent
```

### Path Size in Deep Trees

Full ancestry paths introduce `O(depth)` metadata per move order. In broad or shallow outlines this is likely modest. In pathological deep chains, path storage and normalization cost can become significant.

The implementation log already shows deep-chain stress cases crossing performance thresholds sooner than flat or balanced trees. That does not invalidate the model, but it means production use may need:

- path-depth caps,
- path compression,
- cached normalized paths,
- incremental dependency tracking,
- or a switch from full ancestry paths to shorter ancestry certificates.

### Materialization Complexity Moves Into Cache Construction

`04vvl` avoids operation replay but makes cache construction more complex. The cache builder must:

- validate paths,
- normalize parent dependencies,
- detect cycles,
- break cycles deterministically,
- preserve suffixes,
- and produce a root-reachable tree for every visible block.

This is simpler than a full move-log replay algorithm in some ways, but it is still a correctness-critical piece of code.

### Less Formal Coverage Than Prior Algorithms

Kleppmann et al. and Nair et al. provide formally studied algorithms with stronger proofs around convergence and safety. `04vvl` should converge if its order selection, path validation, and cycle breaking are deterministic functions of the delivered operation set, but the exact one-winning-path model is not a well-known published algorithm.

That means the implementation should lean heavily on property tests and adversarial concurrent-move tests.

## Overall Assessment

`04vvl-block-path` is best understood as:

```text
a single-register parent-move CRDT augmented with ancestry-path certificates,
plus deterministic materialization-time graph repair
```

Its main advantage over prior move-history work is compactness. It avoids keeping every historical move or every historical parent edge, while retaining enough ancestry context to repair common stale-path cases better than a bare parent pointer.

The tradeoff is semantic strength. History-based algorithms can often preserve a better older parent or a more maximal safe subset of moves. `04vvl` instead optimizes for bounded state, local integration with the existing block CRDT, and a predictable cycle-free materialized outline.

For a block editor, that tradeoff looks reasonable if the intended invariant is:

```text
all replicas converge to a valid, cycle-free outline with compact long-term metadata
```

rather than:

```text
all replicas preserve the best possible interpretation of every historical move
```
