# Plan: Concurrent Block Reparent Cycle Tests

## Decisions From Research

- This task is test-only. Do not change block CRDT implementation behavior.
- Scope the guarantee to cycles constructable by current editor commands, not arbitrary hand-written `block:move` payloads.
- Direct `applyBlockMove` should reject local descendant-parent moves eventually, but that implementation work is out of scope for this task.
- Focus on editor-command-shaped reparenting: reorder-to-root, indent, and unindent with incidental following-sibling moves.
- Use CRDT-level tests in `src/block-crdt/index.test.ts`; avoid UI tests and avoid importing example app command code into `src/block-crdt`.

## Phase 1: Add Test Helpers

File: `src/block-crdt/index.test.ts`

Add small local helpers near the existing block test helpers:

- `blockParentIds(state)` returns a stable id-to-parent-id map from `state.state.blocks`.
- `expectVisibleTraversalSafe(state)` asserts:
  - `rootBlockIds(state)` does not throw,
  - `visibleBlockOutline(state)` does not throw,
  - `expectCache(state)` passes,
  - visible outline ids are unique.
- `expectConvergentBlockParents(base, leftOps, rightOps)` or equivalent helper applies concurrent op batches in both orders and compares:
  - raw parent maps,
  - visible outlines,
  - traversal/cache safety.

Keep any raw-cycle helper out of the main assertion path unless it is used only to document an out-of-scope boundary.

## Phase 2: Build Editor-Command-Shaped Move Helpers

File: `src/block-crdt/index.test.ts`

Add helper functions that generate `block:move` ops with the same timestamp shapes used by current editor commands:

- Root reorder / move-to-root:
  - `order.parent = [0, 'root']`
  - `order.ts` is a string HLC.
- Indent:
  - `order.parent` is the previous visible sibling id.
  - `order.ts` is a string HLC.
- Unindent:
  - selected block moves to its grandparent with a string HLC.
  - following siblings move under the selected block with incidental tuple timestamp:

```ts
[lastBlockOrderTs(sibling.order.ts), current.order.index, nextTs()]
```

Do not import `examples/block-rich-text/src/blockCommands.ts`. Recreate only the minimal command semantics needed for these tests so the CRDT test remains dependency-clean.

## Phase 3: Deterministic Scenario Tests

File: `src/block-crdt/index.test.ts`

Add focused tests near the existing block move / visible outline tests.

### Concurrent adjacent indents

Initial outline:

```text
A
B
C
```

Concurrent operations:

- actor 1 indents `B` under `A`,
- actor 2 indents `C` under `B`.

Assert both delivery orders converge, traversal is safe, cache is consistent, visible ids are unique, and the final parent map matches the current deterministic behavior.

### Concurrent unindents with incidental reparenting

Initial outline:

```text
A
  B
  C
  D
```

Concurrent operations:

- actor 1 unindents `B`, incidentally moving `C` and `D` under `B`,
- actor 2 unindents `C`, incidentally moving `D` under `C`.

Assert both delivery orders converge, traversal is safe, and the expected winner for `D` follows `laterBlockOrderTs` incidental timestamp ordering.

### Concurrent indent versus unindent

Create a tree where one actor indents a block while another unindents either that block or a nearby sibling. This should cover mixed string and incidental timestamp shapes without relying on arbitrary raw moves.

Assert convergence and no traversal cycle.

### Concurrent move-to-root versus nested move

Create a nested block and concurrently:

- move it or a nearby block back to root with a normal string timestamp,
- apply an indent/unindent-shaped nested move involving the same local region.

Assert convergence, traversal safety, cache consistency, and the final parent map.

## Phase 4: Boundary Documentation Test

Add one clearly named test only if useful:

- `direct raw block moves can encode an out-of-scope detached cycle`, or similar.

This test should not be framed as a supported editor-command invariant. It can assert the observed current boundary, such as:

- direct hand-authored moves can produce a raw parent cycle,
- root traversal may omit the detached cycle rather than throw.

Skip this phase if it distracts from the editor-command guarantee.

## Phase 5: Property Coverage For Editor Commands

Extend the existing `preserves cache and serialization invariants across generated editing scripts` property test, or add a new targeted property test, so generated scripts include block reparent commands:

- root reorder / move-to-root,
- indent,
- unindent.

Keep generation user-level:

- derive valid commands from the current visible outline,
- skip commands that current editor behavior would no-op,
- never generate arbitrary parent ids.

Per step, assert:

- `expectVisibleTraversalSafe(editor.state)`,
- `stateToString(editor.state) === stateToString(cachedState(editor.state.state))`.

For concurrent behavior, add a smaller property or table-driven loop that generates two valid editor-command batches from the same base state and applies them in both orders, then asserts parent-map and outline convergence.

## Phase 6: Validation

Run focused tests:

```sh
npm exec vitest src/block-crdt/index.test.ts
```

If focused tests pass, run the broader block CRDT suite:

```sh
npm exec vitest src/block-crdt
```

If the boundary test exposes a stronger raw-cycle gap, leave it documented in the test name and comments rather than changing implementation in this task.
