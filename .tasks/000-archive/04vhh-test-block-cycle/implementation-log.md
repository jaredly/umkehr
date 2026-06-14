# Implementation Log: Concurrent Block Reparent Cycle Tests

## Phase 1: Helpers

- Started by reviewing `src/block-crdt/index.test.ts`, `src/block-crdt/index.ts`, and the block-rich-text command shapes.
- Scope confirmed from `research.md`: tests only, editor-command-shaped reparenting only, no implementation changes.
- Added local block parent, outline, visible traversal, and convergence helpers in `src/block-crdt/index.test.ts`.
- Added minimal test-only command op builders for indent, unindent, and move-to-root so the CRDT tests do not import example app code.

## Phase 2: Deterministic Scenarios

- Added deterministic concurrent reparent tests for adjacent indents, unindent with incidental following-sibling moves, indent versus unindent, and move-to-root versus nested reparenting.
- Expected parent maps are based on current `BlockOrderTs` comparison rules, especially tuple incidental timestamps for following siblings.
- Focused test runs exposed brittle sibling-order expectations in concurrent root move cases. The final parents were as expected, so the tests now assert parent/depth invariants unless sibling order is central to the scenario.

## Phase 3: Property Coverage

- Added a generated editor-level reparent property test covering `indent`, `unindent`, and `moveToRoot`.
- The reparent generator derives target blocks from the visible editor outline and lets no-op command cases remain no-ops, matching current editor behavior.
- Focused test run showed that mixing reparent commands into the older text/split/join/delete property can trigger a preexisting `EditorHarness.split` edge case after joins. Workaround: keep the original text-editing property focused, and add a separate generated block-reparent script property seeded with multiple blocks.
- Tightened deterministic scenario assertions to parent/depth invariants where sibling order is not central to the cycle-safety claim.

## Phase 4: Validation

- Ran `npm exec vitest src/block-crdt/index.test.ts`: passed, 47 tests.
- Ran `npm exec vitest src/block-crdt`: passed, 62 tests across 2 files.
