# Plan: Side-by-Side `organizeState` Optimization Candidates

## Decisions From Research

- Keep `organizeState` non-incremental and cache-independent.
- Continue full validation in `organizeState`.
- Continue duplicate path detection in `organizeState`.
- Current public full-path callers are limited:
  - `materializedBlockPath` / `materializedBlockParent` are used by block command helpers and tests.
  - `materializedBlockPaths` has no current direct callers outside its own implementation path.
- The common expected document shape is shallow, mostly balanced outline trees. Partial ancestry path mismatches should be rare, and typical depth is expected to be around 5 levels.
- The stress harness should compare multiple implementations side-by-side before replacing the production implementation.

## Candidate Implementations

Build several internal block-parent derivation implementations with the same output contract.

Shared contract:

```ts
type BlockParentDerivation = {
    parents: Record<string, string>; // root id for materialized root blocks
    rawParents: Record<string, string | null>;
    rejectedRoots: Set<string>;
};

type OrganizeBlockStrategy = {
    name: string;
    derive(blocks: Record<string, Block>): BlockParentDerivation;
};
```

All variants must:

- validate non-empty paths,
- validate final path id equals the block id,
- validate root sentinel is omitted,
- validate duplicate ids are absent,
- validate every path id exists,
- break cycles by making the lowest `order.id` member of each cycle a materialized root,
- produce the same `blockChildren` result as the current implementation.

### Variant 0: Baseline

Keep the current algorithm as a reference/oracle:

- full path validation,
- repeated parent-walk cycle detection,
- full materialized path allocation,
- `blockChildren` built from full materialized paths.

Purpose:

- correctness oracle during optimization,
- performance baseline in the stress matrix.

This can live as an internal test-only strategy if we do not want to keep it in production code.

### Variant 1: Linear Cycle Detection + Parent Map Foundation

Use full validation but avoid full materialized path allocation in `organizeState`.

Algorithm:

1. Validate every raw `order.path`.
2. Build `rawParents[block]` from the penultimate path item or `null`.
3. Run linear functional-graph cycle detection with visitation states:
   - `unvisited`,
   - `visiting`,
   - `done`.
4. When a cycle is found, select the cycle member with lowest `order.id` and add it to `rejectedRoots`.
5. Materialized parent is:
   - root if block is in `rejectedRoots`,
   - root if `rawParents[block] === null`,
   - otherwise `rawParents[block]`.
6. Build `blockChildren` directly from materialized parent ids.

Expected result:

- compressed/capped deep chain should improve significantly,
- full ancestry chain still pays full path validation cost,
- balanced shallow trees should improve only modestly.

This is not expected to be the primary production candidate by itself. In the likely common case, most blocks already store full materialized paths and document depth is shallow, so the main remaining cost is scanning/converting those stored paths during validation. Treat this variant as a correctness-preserving foundation that removes obviously wasteful materialized-path allocation and repeated deep parent walks, then compare the more path-validation-oriented variants against it.

### Variant 2: Linear Parent Map + Cached String Paths

Same as Variant 1, but builds path string ids once during validation:

```ts
type BlockOrderStrings = {
    pathIds: string[];
    rawParent: string | null;
};
```

Then cycle detection and blockChildren construction reuse string ids.

Expected result:

- should reduce constants in flat, balanced, capped, and full ancestry cases,
- should be more relevant than Variant 1 for the common full-materialized-path case,
- may be the best production version if string conversion is a meaningful share of time after removing full materialized-path allocation.

Risk:

- more allocation up front for `pathIds`.
- On compressed chains, path arrays are small, so the extra structure may not beat Variant 1.

### Variant 2b: Linear Parent Map + Interned Path Ids

Same as Variant 2, but avoids allocating a `pathIds` array for every block.

Instead, validate each path in one pass and store only:

```ts
type BlockOrderSummary = {
    rawParent: string | null;
    finalId: string;
};
```

Implementation sketch:

- keep a per-rebuild `Map<Lamport, string>`-style helper if practical, or a small local function for tuple-to-string conversion,
- scan each `order.path`,
- use a temporary `Set<string>` for duplicate detection,
- validate missing dependencies immediately,
- retain only the raw parent id and final id after validation.

Expected result:

- targets the common shallow full-path case without retaining per-block `pathIds` arrays,
- should reduce retained allocation compared with Variant 2,
- keeps full validation semantics.

Risk:

- still converts every path entry to a string during validation,
- may not beat Variant 2 if repeated path id reuse is high enough that retained arrays improve locality.

### Variant 3: Parent Map + On-Demand Public Full Paths

This is not a separate `organizeState` blockChildren algorithm; it is a public-helper strategy.

Use Variant 1 or 2 for `organizeState`, then implement:

```ts
materializedBlockParent(state, id)
materializedBlockPath(state, id)
materializedBlockPaths(state)
```

from the derived parent map instead of making `organizeState` compute full paths.

For single path:

```ts
walk id -> parent -> parent ... -> root
reverse Lamports
```

For all paths:

- memoize per block,
- avoid recursive spread in a loop where possible,
- accept that all full paths for a deep chain are inherently `O(N^2)` output size.

Expected result:

- `organizeState` stays fast,
- command helpers that ask for one or two paths remain acceptable,
- tests/debug APIs still work.

### Variant 4: Sorting Fast Path

Layer this on top of the best parent derivation variant.

When filling `blockChildren`, track whether each sibling array is already sorted by `order.index`.

Options:

- skip sort for arrays with length `0` or `1`,
- compare each appended child with the previous child's index,
- only call `.sort(...)` for arrays observed out of order.

Expected result:

- helps root-heavy/flat documents,
- little effect on deep chain cases.

This should be tested separately because the bookkeeping may not beat native sort for small arrays.

## Phase 1: Benchmark Harness Refactor

Update `src/block-crdt/organizeState.stress.test.ts` so stress cases can run multiple strategies side-by-side.

Add a strategy list:

```ts
const strategies: OrganizeBlockStrategy[] = [
    baselineStrategy,
    linearParentStrategy,
    stringCachedLinearStrategy,
    internedSummaryLinearStrategy,
    // later: sortFastPathStrategy
];
```

Change result shape:

```ts
type CaseResult = {
    strategy: string;
    name: string;
    blocks: number;
    medianMs: string;
    p95Ms: string;
    maxMs: string;
    over10ms: boolean;
};
```

For each graph fixture:

1. Run baseline strategy once to get oracle `blockChildren`.
2. Run each candidate.
3. Assert candidate `blockChildren` equals baseline `blockChildren`.
4. Time each strategy.
5. Print a table sorted by case then strategy.

Keep the test opt-in:

```sh
BLOCK_CRDT_STRESS=1 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose
```

Add a comparison-oriented command to the plan/log:

```sh
BLOCK_CRDT_STRESS=1 BLOCK_CRDT_STRESS_ITERATIONS=21 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose
```

## Phase 2: Extract Current Baseline

Move current block materialization into a named internal function.

Suggested structure:

```ts
const deriveBlockParentsBaseline = (
    blocks: Record<string, Block>,
): BlockParentDerivationWithPaths => ...
```

The baseline can return full paths if convenient:

```ts
type BlockParentDerivationWithPaths = BlockParentDerivation & {
    paths: Record<string, Lamport[]>;
};
```

Production `organizeState` can initially keep using this baseline function.

Tests:

- existing block CRDT tests should pass unchanged,
- stress test should show one strategy, `baseline`, with current numbers.

## Phase 3: Implement Variant 1

Implement `deriveBlockParentsLinear`.

Important details:

- Keep full validation.
- Avoid building full materialized paths.
- Use iterative DFS rather than recursive DFS to avoid call-stack risk on deep outlines.
- Treat root as terminal.
- Treat already rejected roots as terminal.
- Multiple independent cycles must all be detected.
- Tails into cycles must end up root-reachable after the winner edge is rejected.

Suggested iterative functional-graph algorithm:

```ts
const state: Record<string, 0 | 1 | 2> = {}; // unvisited, visiting, done
const rejectedRoots = new Set<string>();

for (const start of blockIds) {
    const stack: string[] = [];
    const stackIndex = new Map<string, number>();
    let current: string | null | undefined = start;

    while (current && !rejectedRoots.has(current)) {
        if (state[current] === 2) break;

        const index = stackIndex.get(current);
        if (index !== undefined) {
            const cycle = stack.slice(index);
            const winner = lowestOrderId(cycle);
            rejectedRoots.add(winner);
            break;
        }

        if (state[current] === 1) {
            // Reached another traversal's active stack. Either avoid this by
            // keeping traversal-local state only, or handle with a global
            // activeStack owner map.
        }

        state[current] = 1;
        stackIndex.set(current, stack.length);
        stack.push(current);
        current = rawParents[current];
    }

    for (const item of stack) state[item] = 2;
}
```

Prefer traversal-local detection if it keeps the implementation simpler and deterministic. The goal is still to avoid starting a full parent walk for every node after a path has already been marked done.

Tests:

- all existing path/cycle tests pass,
- add explicit multiple-independent-cycle test if not already covered,
- stress candidate output matches baseline.

## Phase 4: Implement Variant 2

Implement `deriveBlockParentsLinearStringCached`.

This may be either:

- a separate function for side-by-side timing, or
- a configuration option used by the linear derivation.

Keep it separate initially so stress can compare it directly against Variant 1.

Validation should produce:

```ts
const blockData: Record<string, {
    block: Block;
    pathIds: string[];
    rawParent: string | null;
}>;
```

Use `pathIds` for:

- duplicate detection,
- missing dependency detection,
- final-id validation,
- raw parent extraction.

Stress questions:

- Does this beat Variant 1 on balanced trees?
- Does this beat Variant 1 on full ancestry paths?
- Does it regress compressed paths due to extra `pathIds` allocation?

## Phase 5: Implement Variant 2b

Implement `deriveBlockParentsLinearSummary`.

This variant should keep full validation but avoid retaining full string path arrays after validation.

Validation should produce:

```ts
const blockData: Record<string, {
    block: Block;
    rawParent: string | null;
}>;
```

Stress questions:

- Is retaining `pathIds` in Variant 2 useful, or is a per-block summary faster?
- Does Variant 2b improve the common shallow full-path case?
- Does Variant 2b preserve the compressed-chain improvement from Variant 1?

## Phase 6: Public Helper Rework

Once the best parent derivation strategy is chosen, update public helpers.

Keep these APIs:

```ts
materializedBlockParent(state, blockId)
materializedBlockPath(state, blockId)
materializedBlockPaths(state)
```

Implementation:

- `materializedBlockParent` uses parent-map derivation and returns root or parent Lamport.
- `materializedBlockPath` derives one path from the parent map.
- `materializedBlockPaths` derives all full paths from the parent map with memoization.

Important:

- `organizeState` should not call `materializedBlockPaths`.
- Command helpers should continue using `materializedBlockPath` only for a small number of blocks per command.

If command helpers become too costly, add a helper that derives multiple paths from one parent map in a single call, but do not make `Cache` store those paths.

## Phase 7: Sorting Fast Path Experiment

Add a sorting strategy flag or separate blockChildren builder:

```ts
buildBlockChildrenAlwaysSort(...)
buildBlockChildrenSortIfNeeded(...)
```

Stress-test side-by-side on:

- flat root graphs,
- balanced fanout-4,
- reciprocal cycle fixtures,
- realistic shallow-depth fixtures if added later.

Adopt only if it improves p95 or median without complicating correctness.

## Phase 8: Strategy Selection

After running the side-by-side stress suite, choose the production implementation.

Selection criteria:

- Must match baseline `blockChildren` exactly for all stress fixtures.
- Must pass existing block CRDT and block-rich-text command tests.
- Should keep shallow balanced documents under 10ms at materially larger sizes than baseline.
- Should move compressed/capped chain thresholds above the current `500-1k` range.
- Should not make flat/root-heavy documents worse.

Likely outcomes:

- Do not pick Variant 1 solely because it improves pathological compressed chains; it is a foundation, not the expected best common-case implementation.
- If Variant 2 materially improves full ancestry and shallow balanced fixtures without hurting compressed chains, prefer Variant 2.
- If Variant 2b is close to or faster than Variant 2, prefer Variant 2b for lower retained allocation.
- Add Variant 4 only if flat/root-heavy cases remain noisy or close to 10ms.

## Phase 9: Verification

Run focused tests:

```sh
npm exec vitest -- src/block-crdt/index.test.ts examples/block-rich-text/src/blockCommands.test.ts
```

Run type checks:

```sh
npm run typecheck
npm exec tsc -- -p examples/block-rich-text/tsconfig.json --noEmit
npm run typecheck:tests
```

Run stress comparisons:

```sh
BLOCK_CRDT_STRESS=1 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose
BLOCK_CRDT_STRESS=1 BLOCK_CRDT_STRESS_LEVEL=deep BLOCK_CRDT_STRESS_ITERATIONS=7 npm exec vitest -- run src/block-crdt/organizeState.stress.test.ts --reporter verbose
```

Update `.tasks/04w33-optimize-block-crdt-organize/implementation-log.md` with:

- strategy timings,
- selected production strategy,
- any regressions,
- any tests that could not run due to known unrelated repo issues.

## Non-Goals

- Do not implement the incremental cache algorithm in this task.
- Do not relax full validation unless a later decision explicitly changes that.
- Do not store materialized parent ids or paths in `Cache`; `organizeState` remains cache-independent.
- Do not remove public materialized path helpers.
