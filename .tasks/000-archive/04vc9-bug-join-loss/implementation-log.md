# Implementation Log

## Phase 1: Irreversible Block Deletion

- Started by replacing reversible `Block.status.archived` with an irreversible `Block.deleted` boolean.
- Planned to remove `block:status` and replace it with idempotent `block:delete`.
- Updated the core type, initial state, apply dispatcher, block insertion merge behavior, root block filtering, and tests away from status timestamps.
- Replaced the archive/restore test with an irreversible delete test.

## Phase 2: Join Sentinel Char

- Updated `join` to emit a deleted `char` with `id = rightBlock.id` and parent it under the left block tail, then emit `block:delete`.
- Removed join-time reparenting of the right block's existing character children; they stay under the right block id, which is now the sentinel char id.
- Added a guard that rejects joins involving already-deleted blocks.
- Issue noticed: `applyBlockDelete` should update `maxSeenCount` with the referenced block id, like `char:delete`; fixed while changing the delete op.

## Phase 3: Join Coverage

- Added tests for the sentinel representation, explicit join/insert op orders, multi-character insertion at the start of the joined block, empty right block joins, empty left block joins, and chained joins.
- Issue encountered: the sentinel representation test initially expected the wrong parent timestamp (`00006`); corrected it to the actual join timestamp (`00005`).
- Verification: `npm exec vitest -- src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts` passed with 53 tests.

## Phase 4: Formatting and Selection Audit

- Starting with the block-rich-text suite to find stale assumptions outside the core block CRDT tests.
- Verification: `npm exec vitest -- examples/block-rich-text/src` passed with 60 tests.
- Issue noticed during final audit: `allCharIds` still traversed deleted root blocks. With sentinel joins, joined children are already reachable through visible roots, so deleted roots could duplicate characters for mark traversal. Updated `allCharIds` to traverse visible root blocks only.

## Phase 5: Cleanup and Verification

- Grep confirmed no remaining `block:status`, `status.archived`, or `archived` references in block CRDT TypeScript or block-rich-text TypeScript.
- Note: `src/block-crdt/Demos.md` still contains historical archive wording in old design notes. Left it untouched because it is not runtime/test code and already includes a newer note about tombstoned block sentinel chars.
- Verification: `npm run typecheck` passed.
- Verification: `npm exec vitest -- src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts examples/block-rich-text/src` passed with 113 tests.
- Verification issue: full `npm exec vitest` failed in unrelated React example tests with invalid hook call / `Cannot read properties of null (reading 'useState')`.
  - Failing files: `examples/react-crdt/src/apps/todos/TodoItem.test.tsx`, `examples/react-crdt/src/apps/todos/TodoVersionApps.test.tsx`, and `examples/react-crdt/src/lib/solo/solo-render.test.tsx`.
  - Summary from run: 3 failed files, 56 passed files; 9 failed tests, 512 passed tests.
  - These failures are outside the block CRDT and block-rich-text areas touched here.
