# Research: Concurrent Block Reparent Cycle Tests

## Goal

Add comprehensive tests that verify block parent cycles are prevented, or at least cannot surface through the public visible block traversal, when blocks are concurrently reparented.

The surprising behavior to validate is that the current block reparenting architecture appears to avoid cycles in realistic concurrent cases even though `block:move` stores only one LWW-ish parent per block.

## Current State

Relevant files:

- `src/block-crdt/index.ts`
- `src/block-crdt/types.ts`
- `src/block-crdt/index.test.ts`
- `examples/block-rich-text/src/blockCommands.ts`

Blocks store their parent in `Block.order.parent`:

```ts
type Block = {
    id: Lamport;
    order: {index: LseqId; ts: BlockOrderTs; parent: Lamport};
    deleted: boolean;
    // ...
};
```

`block:move` applies by comparing `order.ts` against the current block order timestamp. If the incoming timestamp is later, it replaces the block's `order` and updates `cache.blockChildren`.

There is no explicit "reject if new parent is a descendant" check in `applyBlockMove`. Cycle handling currently exists at traversal time:

- `visibleBlockChildren(state, parent)` tracks visited parent ids and throws `block traversal cycle at ...` if it recursively enters the same parent.
- `visibleBlockOutline(state)` uses the same style of visited-set guard.
- `rootBlockIds(state)` delegates to `visibleBlockChildren(state, root)`.

The existing test coverage includes:

- basic block moves by timestamp,
- visible outline nesting and deleted-parent splicing,
- incidental block move timestamp ordering,
- property tests for insert/split/join/delete scripts,
- join-cycle prevention through `activeJoinRecords`.

There is not currently a focused test suite for concurrent block reparent cycles.

## Key Observation

Direct `block:move` ops can still encode a cycle in the raw block graph if each block receives a later parent pointing to another block in the cycle.

For example, starting with root children `A`, `B`, and `C`, these direct concurrent ops can produce `A -> C`, `B -> A`, `C -> B` as parent links:

```ts
move A under C at ts 00010
move B under A at ts 00010
move C under B at ts 00010
```

Because each op targets a different block, LWW conflict resolution does not choose among them. The raw `state.blocks` parent graph can therefore contain a detached cycle. If no block in that cycle remains reachable from root, `rootBlockIds(state)` may not visit it and therefore may not throw. If a cycle is reachable from root through a hidden/deleted parent, traversal can throw.

So the tests should be explicit about which invariant is being claimed:

- Strong invariant: no raw parent cycle can exist anywhere in `state.blocks`.
- Public traversal invariant: visible root traversal never cycles or throws after operations produced by supported editor commands.
- Reachability invariant: every visible, non-joined, non-deleted block remains reachable from root.

The current implementation appears better suited to the public traversal/reachability invariants than the strong raw-graph invariant.

## Recommended Tests

Add focused tests in `src/block-crdt/index.test.ts`, near the existing block move and visible outline tests.

### 1. Two-block reciprocal reparenting

Build a root tree with `A` and `B`. Simulate two replicas:

1. Replica one moves `A` under `B`.
2. Replica two moves `B` under `A`.
3. Apply the ops in both orders.

Assert:

- both application orders converge to identical `state.blocks` parent links,
- `visibleBlockOutline(state)` does not throw,
- `rootBlockIds(state)` does not throw,
- `expectCache(state)` still passes,
- all visible outline ids are unique.

This is the minimal concurrent cycle shape.

Important variant: give the two moves equal base timestamps but different actor-derived/index payloads only if that reflects real command output. If direct string timestamps are used, make one op later per target block and document that the test is exercising raw `block:move`.

### 2. Three-block cycle attempt

Start with root children `A`, `B`, `C`. Generate concurrent moves:

- `A` under `B`
- `B` under `C`
- `C` under `A`

Apply all permutations or at least several explicit orders:

- `[A->B, B->C, C->A]`
- `[C->A, B->C, A->B]`
- `[B->C, A->B, C->A]`

Assert the same traversal/cache invariants as above.

This test matters because two-node cycles sometimes get broken accidentally by timestamp asymmetry, while three-node cycles exercise longer parent paths.

### 3. Concurrent indent of adjacent siblings

Use `examples/block-rich-text/src/blockCommands.ts` semantics as a model, or recreate equivalent `block:move` ops in the CRDT test:

Initial tree:

```text
A
B
C
```

Concurrent user actions:

- user 1 indents `B` under `A`,
- user 2 indents `C` under `B`.

Assert:

- both delivery orders converge,
- outline is `A`, `B` nested under `A`, `C` nested under `B` or whatever the deterministic current behavior actually produces,
- traversal does not throw.

This is a realistic editor workflow and should not create a cycle.

### 4. Concurrent unindent with incidental following-sibling reparenting

`unindentBlock` can emit multiple `block:move` ops:

- one intentional move for the selected block,
- incidental moves for following siblings, using `BlockOrderTs = [baseTs, sourceSiblingIndex, ts]`.

Create a tree such as:

```text
A
  B
  C
  D
```

Concurrent user actions:

- user 1 unindents `B`, incidentally moving `C` and `D` under `B`,
- user 2 unindents `C`, incidentally moving `D` under `C`.

Assert:

- both delivery orders converge,
- no traversal cycle occurs,
- the expected parent for `D` is selected by `laterBlockOrderTs`'s incidental timestamp ordering,
- visible outline ids are unique and reachable.

This covers the architecture that seems most likely to be "accidentally" preventing cycles.

### 5. Concurrent move-to-root versus indent/unindent

Cover conflict between a normal root reorder and nested reparenting:

- one op moves a nested block back to root with a later string timestamp,
- another op tries to move a parent/descendant relationship around it with incidental timestamp form.

Assert deterministic convergence and no traversal cycle. This is useful because `laterBlockOrderTs` compares strings and incidental tuple timestamps differently:

- string vs string: lexical timestamp wins,
- tuple vs string: tuple wins when its base timestamp equals the string,
- tuple vs tuple: base timestamp, then source sibling index, then final timestamp.

### 6. Negative boundary test for direct raw cycles

If we want to document the current boundary, add a test that directly creates a detached raw cycle with `block:move` ops and asserts the observed behavior.

Two reasonable options:

- Assert `visibleBlockOutline` does not throw but omits the detached cycle, documenting that root traversal is safe but raw reachability is not guaranteed.
- Or assert a helper like `expectNoRawBlockParentCycles(state)` fails, documenting a known gap.

This test should be named clearly so it does not imply the implementation guarantees more than it does.

## Test Helpers

Add local helpers in `src/block-crdt/index.test.ts`:

```ts
const blockParentIds = (state: CachedState) =>
    Object.fromEntries(
        Object.entries(state.state.blocks).map(([id, block]) => [
            id,
            lamportToString(block.order.parent),
        ]),
    );

const expectVisibleTraversalSafe = (state: CachedState) => {
    expect(() => rootBlockIds(state)).not.toThrow();
    expect(() => visibleBlockOutline(state)).not.toThrow();
    expectCache(state);
    const ids = visibleBlockOutline(state).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
};
```

For stronger checks, add:

```ts
const expectNoRawBlockParentCycles = (state: CachedState) => {
    for (const id of Object.keys(state.state.blocks)) {
        const seen = new Set<string>();
        let current: string | undefined = id;
        while (current && current !== '0000-root') {
            expect(seen.has(current), `raw block parent cycle from ${id}`).toBe(false);
            seen.add(current);
            const block = state.state.blocks[current];
            current = block ? lamportToString(block.order.parent) : undefined;
        }
    }
};
```

Use this stronger helper only if the desired invariant is raw graph acyclicity. Based on current code, it may expose that direct raw cycles are still possible.

## Implementation Notes

Prefer CRDT-level unit tests over UI tests for this task. The relevant behavior is in `applyBlockMove`, `laterBlockOrderTs`, cache organization, and traversal. UI tests would add noise without proving the lower-level invariant.

Use direct `Op` objects for precise adversarial cases, and use `indentBlock` / `unindentBlock` command behavior as inspiration for realistic cases. Importing example app commands into `src/block-crdt` tests would invert the dependency direction, so avoid that.

When testing convergence, compare both:

- materialized/traversed output, such as `visibleBlockOutline(state)`,
- raw parent map via `blockParentIds(state)`.

That prevents a hidden raw divergence from being masked by traversal output.

## Open Questions

1. Which invariant do we actually want to guarantee: no raw `state.blocks` parent cycles anywhere, or only no cycles reachable through public visible traversal?
    - let's say no cycles constructable by current editor commands

2. Should `applyBlockMove` reject or ignore a move whose new parentfgfdasis currently a descendant of the moved block? That would prevent obvious local cycles, but concurrent cycles can still require deterministic cycle-breaking over a set of moves.
    - yes it should reject that outright

3. If a concurrent cycle is detected, should the resolver drop the newest edge, the oldest edge, the highest/lowest block id edge, or the edge with the least intentional timestamp? Join records already resolve cycles by sorted join id; block reparenting does not currently have an equivalent active-edge filter.
    - this task is about writing tests

4. Should blocks in a detached raw cycle be considered lost/corrupt, or should traversal recover them by splicing them back to root?
    - we are writing tests right now

5. Are `block:move` ops considered a public CRDT API that must be safe under arbitrary valid payloads, or are only ops produced by editor commands expected to preserve the stronger invariants?
    - let's just do editor commands right now

6. Should `organizeState` compute active block parent edges with cycle-breaking, similar to `activeJoinRecords`, instead of storing every latest parent edge directly in `cache.blockChildren`?
    - don't change any implementations

7. Should property tests generate arbitrary concurrent `block:move` batches, or only user-level indent/unindent/reorder commands? Arbitrary batches are better for CRDT robustness, but may force a stronger invariant than the current command layer intends.
    - editor commands only
