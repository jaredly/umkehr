# Research: Non-Incremental `organizeState` Optimizations

## Goal

Identify candidate optimizations for block-crdt's non-incremental `organizeState` path materialization.

The target is still a full reparse/rebuild API:

```ts
organizeState(blocks, chars, joins)
```

The question is how far we can push that full rebuild before needing the incremental cache algorithm. The current rough threshold for "too costly" is `>10ms`.

## Current State

Relevant files:

- `src/block-crdt/index.ts`
- `src/block-crdt/types.ts`
- `src/block-crdt/organizeState.stress.test.ts`
- `.tasks/04vvl-block-path/implementation-log.md`

`organizeState` currently does three major jobs:

1. Materialize block parent paths:
   - validate each `Block.order.path`,
   - derive each block's raw immediate parent,
   - detect cycles and pick the lowest `order.id` cycle winner as the root,
   - recursively normalize each block's final materialized path.
2. Build `cache.blockChildren` from the materialized parent of each block.
3. Build char contents and active join caches.

The block path materialization code currently looks like this conceptually:

```ts
for each block:
    validate full order.path
    rawParent[block] = previous path item or root

while changed:
    for each block:
        walk parent -> grandparent -> ...
        if this walk finds a cycle:
            reject lowest order.id edge in that cycle

for each block:
    normalize(block) = normalize(rawParent(block)) + [block.id]
```

This is correct for current tests, but not cheap for deep or full-path graphs.

## Stress Results

The opt-in stress harness is:

```sh
BLOCK_CRDT_STRESS=1 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose
```

Optional knobs:

```sh
BLOCK_CRDT_STRESS_LEVEL=deep
BLOCK_CRDT_STRESS_ITERATIONS=<n>
```

Observed rough thresholds on this machine:

- Flat graph: crosses the 10ms p95 threshold around `4k-8k` blocks.
- Balanced fanout-4 tree: crosses around `4k` blocks.
- Compressed deep chain: crosses between `500` and `1k` blocks.
- Full ancestry deep chain: crosses between `250` and `500` blocks.
- Capped-depth deep chains:
  - max depth 10 crosses between `500` and `1k`,
  - max depth 25/50 are already around or over 10ms at `500`.
- Capped balanced fanout-4 trees cross around `2k-4k` by p95.
- Many small reciprocal cycles with short tails remained under 10ms through `2.5k` blocks.

Key conclusion: capping stored path length helps full-path validation volume, but it does not fix the deep-chain case because current cycle detection and normalization still walk the raw parent graph deeply.

## Likely Cost Centers

### 1. Repeated Cycle Walks

Current cycle detection starts a fresh parent walk from every block, and repeats the global scan until no new rejected roots are found.

For a chain:

```text
A <- B <- C <- D <- ... <- N
```

walking from every block costs roughly:

```text
1 + 2 + 3 + ... + N = O(N^2)
```

This matches the compressed-chain stress results: `500` blocks is close to the 10ms line and `1k` is far over it.

### 2. Full Path Validation

`validateBlockOrderPath` scans every Lamport in every raw path and converts each to a string.

For a full ancestry chain:

```text
A [A]
B [A, B]
C [A, B, C]
...
N [A, ..., N]
```

validation alone is quadratic in total path entries. That explains why full ancestry chains cross 10ms earlier than compressed chains.

### 3. Materialized Path Allocation

Normalization returns full `Lamport[]` paths and builds child paths with:

```ts
const path = parent ? [...normalize(parent), block.id] : [block.id];
```

For a deep chain, this allocates cumulative path data of size `O(N^2)` even if raw paths are compressed. `organizeState` only needs each block's materialized immediate parent to build `blockChildren`, so producing full materialized arrays during rebuild is probably more work than necessary.

### 4. Repeated String Conversion

The current path code repeatedly calls `lamportToString` for:

- every path item during validation,
- raw parent extraction,
- path parent lookup,
- blockChildren insertion.

The stress data suggests graph walking dominates deep cases, but string conversion is likely material for flat and balanced cases.

### 5. Sorting All Sibling Arrays

`organizeState` sorts every `blockChildren[parent]` array by `order.index`.

This is necessary for full rebuild. It is probably not the main deep-chain bottleneck because chains have one child per parent, but it matters for flat graphs and root-heavy documents.

## Candidate Optimizations

### Candidate A: Linear-Time Cycle Detection

Replace the "walk from every block until changed" cycle scan with a DFS/topological visitation pass over raw parent edges.

Each block has at most one raw parent edge:

```text
block -> rawParent | root
```

So the graph is a functional graph. Cycle detection can be `O(N)`:

- `unvisited`
- `visiting`
- `done`

Algorithm:

1. Build `rawParent` once.
2. DFS from each unvisited block.
3. If DFS reaches a `visiting` node, the stack slice is a cycle.
4. Pick the lowest `order.id` in that cycle.
5. Mark that winner as `rejectedRoot`.
6. Continue DFS treating the winner's raw parent as root.

Expected impact:

- Big win for compressed-chain and capped-chain stress cases.
- Should also reduce balanced-tree cost.
- Keeps semantics identical if cycle winner selection stays lowest `order.id`.

Risks:

- Need careful handling when a path reaches a previously rejected root.
- Need tests for multiple independent cycles and cycles with tails.

Recommended priority: high. This is the most direct fix for the current deep-chain failure mode.

### Candidate B: Derive Materialized Parents Without Full Materialized Paths

`organizeState` does not need full normalized paths. It only needs:

```ts
materializedParent[blockId] = parentId | root
```

We can compute parent ids directly:

```text
if block is rejectedRoot:
    parent = root
else if rawParent is null:
    parent = root
else:
    parent = rawParent
```

After cycle edges are rejected, the raw parent graph should be acyclic and root-reaching. In that case, the materialized immediate parent for a block is simply its raw parent unless that block is the cycle winner. Descendants automatically remain attached through the normalized parent chain; `blockChildren` does not need the full ancestor list.

Example:

```text
raw A: [B, A]
raw B: [A, B]
winner A
```

Parent map:

```text
A -> root
B -> A
```

No full path arrays are needed.

Expected impact:

- Eliminates `O(N^2)` materialized path allocation for deep chains.
- Makes compressed-chain rebuild close to linear after Candidate A.
- Reduces GC pressure.

Risks:

- Public helpers `materializedBlockPath` and `materializedBlockPaths` currently return full paths. Those can still compute paths on demand, but `organizeState` should not require them.
- Tests that assert full materialized paths need a helper that computes paths from the optimized parent map or a separate slower debug path.

Recommended priority: high. This is probably necessary for full-rebuild performance.

### Candidate C: Split Internal Parent Derivation From Public Path Helpers

Introduce an internal helper:

```ts
type MaterializedBlockParents = {
    parents: Record<string, string>; // root id for root blocks
    rawParents: Record<string, string | null>;
    rejectedRoots: Set<string>;
};

const materializedBlockParentsForBlocks = (
    blocks: Record<string, Block>,
): MaterializedBlockParents => ...
```

Then:

- `organizeState` uses `parents` directly.
- `materializedBlockParent` can use the same helper.
- `materializedBlockPath(s)` can build full paths only when explicitly requested.

Expected impact:

- Lets `organizeState` avoid full path arrays.
- Keeps external/debug APIs intact.
- Makes the optimized code easier to test.

Risks:

- If `materializedBlockPath` recomputes parent derivation per call, command helpers may get slower. Use it carefully, or expose `materializedBlockParents` if needed.

Recommended priority: high, as structure for Candidate B.

### Candidate D: Cache Lamport Strings Per Block Order During Rebuild

Build string forms once:

```ts
const blockIds = Object.keys(blocks);
const orderPathIds: Record<string, string[]> = {};
const orderIdByBlock: Record<string, Lamport> = {};
```

Then validation, raw parent extraction, and cycle detection use strings without repeated conversion.

Expected impact:

- Helps flat/balanced/full-path cases.
- Reduces repeated allocation.

Risks:

- Full-path chains still require scanning every path item. This optimization reduces constants, not complexity.

Recommended priority: medium. Good after the algorithmic fixes.

### Candidate E: Early Fast Path For Already-Valid Immediate Parent Graphs

Most local states probably have paths that already line up with materialized ancestry and contain no cycles.

Possible fast path:

1. Validate path shape and derive raw parent.
2. Use linear DFS to prove acyclic.
3. If no cycles are found, build `blockChildren` directly from raw parents.

This is mostly the same as Candidate A/B, but worth naming because the common path should not allocate rejected-root structures or full paths.

Expected impact:

- Good for normal documents and balanced stress cases.

Risks:

- Keep the code from splitting into two subtly different implementations. Prefer one linear parent derivation that naturally has a cheap no-cycle path.

Recommended priority: medium.

### Candidate F: Validate Only What `organizeState` Needs

Current validation checks every path id exists. But `organizeState` only needs:

- path non-empty,
- final id equals block id,
- no duplicate ids,
- immediate raw parent exists if present.

Full ancestry path entries before the immediate parent are not required to build the materialized parent graph. They are provenance/context, and stale ancestry gets reconciled through the immediate parent.

Potential optimization:

- In apply-time validation, keep full path validation because incoming ops should be well-formed and dependencies should exist.
- In `organizeState`, trust stored state more and validate only final id, duplicate ids if required, and immediate parent existence.

However, duplicate detection still needs scanning the full path. If duplicate detection is only an apply-time invariant, `organizeState` can skip it or make it development-only.

Expected impact:

- Large win for full ancestry and capped-path cases.
- Less effect for compressed-chain cases.

Risks:

- `cachedState(state.state)` may be called on externally constructed states, not only states produced by `apply`.
- Skipping validation can turn malformed states into strange materialization instead of clear invariant errors.

Recommended priority: medium/high, but only after deciding whether `organizeState` is an invariant-checking boundary or a hot rebuild function.

### Candidate G: Optimize Sorting For Common Cases

Current code sorts every sibling array:

```ts
items.sort((a, b) => compareLseqIds(blocks[a].order.index, blocks[b].order.index));
```

Possible improvements:

- skip sort for arrays of length 0 or 1,
- while filling arrays, track whether appended order is already sorted,
- only sort arrays that need it.

Expected impact:

- Helps flat/root-heavy graphs.
- Little effect on deep chains.

Risks:

- More bookkeeping for modest gains.

Recommended priority: low/medium.

### Candidate H: Iterative Path Construction For Public Helpers

If public `materializedBlockPath` remains necessary, compute it iteratively from the optimized parent map:

```ts
const path = [];
let current = blockId;
while (current !== root) {
    path.push(blocks[current].id);
    current = parents[current];
}
path.reverse();
```

For `materializedBlockPaths`, avoid recursively spreading parent arrays. If full paths for all blocks are requested, use an iterative/memoized approach that reuses string parent ids and only converts to Lamports at the end.

Expected impact:

- Helps tests/debug APIs.
- Keeps `organizeState` independent from path allocation.

Risks:

- Full paths for all nodes in a deep chain are inherently `O(N^2)` output size. No implementation can make that cheap if callers really ask for all full paths.

Recommended priority: medium.

## Recommended Optimization Order

1. Add a benchmark baseline check-in from the current stress suite output.
2. Implement `materializedBlockParentsForBlocks` with linear cycle detection.
3. Update `organizeState` to build `blockChildren` from parent ids, not full paths.
4. Keep `materializedBlockPath(s)` working by deriving full paths from the optimized parent map.
5. Rerun stress suite and compare:
   - compressed-chain,
   - capped-chain,
   - balanced4,
   - full-path-chain.
6. If full-path-chain remains costly, decide whether `organizeState` can reduce validation of non-immediate ancestry.
7. Add sorting fast paths only if flat/root-heavy graphs remain close to 10ms.

## Expected Results If A/B/C Land

The biggest expected improvements are:

- compressed-chain should move from quadratic-ish to near-linear,
- capped-chain should improve similarly,
- balanced trees should improve modestly,
- full-path-chain will still be limited by full path validation unless Candidate F is also adopted.

If these do not move compressed-chain `1k` below 10ms, that suggests another hidden cost center, likely repeated string conversion or full path allocation still happening in a helper called by `organizeState`.

## Open Questions

- Is `organizeState` allowed to assume states were produced by `apply`, or must it fully validate arbitrary externally constructed states?
    - let's do full validation
- Should duplicate-path detection remain in `organizeState`, or is apply-time enforcement enough?
    - let's continue to validate
- Do public `materializedBlockPaths` callers need all full paths often, or only tests/debug code?
    - you can figure that out from the current callers
- Should `Cache` store materialized parent ids or materialized paths, or should those remain derived outside the cache?
    - organizeState needs to be cache-independent
- What target document shape matters most: balanced outline documents, pathological deep outlines, or imported documents with full ancestry paths?
    - honestly the "partial ancenstry path" case will be quite rare, and depth is unlikely to get more than like 5 levels deep in the majority case
