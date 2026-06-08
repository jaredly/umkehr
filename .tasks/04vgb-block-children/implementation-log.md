# Implementation Log: Block Rich Text Children

## 2026-06-08

- Started implementation from `plan.md`.
- Phase 1 in progress: adding explicit block order timestamp types and replacing the accidental shared timestamp comparison with typed char/block comparisons.
- Phase 1 complete: `Block.order.ts` now supports incidental block timestamps, and char/block timestamp comparison is separated.
- Phase 2 in progress: added `visibleBlockOutline()` and changed `materializeFormattedBlocks()` to include visible descendants with `depth` and `parentId`.
- Phase 3 complete: example selection, retained selection, selection-set ordering, and word occurrence helpers now use visible outline order instead of root-only order.
- Phase 4 complete: added `indentBlock()` and `unindentBlock()` commands. Unindent reparents following siblings under the unindented block, preserves their `order.index`, and uses `[previousTs, selectedBlock.order.index, ts]` for incidental block moves.
- Phase 5 complete: `joinWithPrevious()` and `joinWithNext()` now use visible outline adjacency.
- Phase 6 in progress: wired `Tab`/`Shift+Tab` at caret offset `0`, added depth styling, and disabled nested drag handles while leaving root drag root-only.
- Phase 6 complete after app wiring and CSS pass.
- Phase 7 complete: added focused core and command tests for visible outline depth, hidden-parent splicing, incidental block order comparison, indent, unindent, concurrent unindent convergence, and visible-adjacent join.

## Issues / Workarounds

- Testing caught one missed helper rename in `applyBlockMeta()` after splitting timestamp comparison helpers. `block:meta` uses plain string timestamps, so the fix was to compare `op.meta.ts <= current.meta.ts` directly.
- Nested drag/drop is intentionally disabled in this pass. Root drag/drop remains root-only via `rootBlockIds()`.
- `Tab` away from caret offset `0` is prevented inside the editor to avoid browser focus escape, but it does not emit indent/outdent ops.
- Final audit found mark traversal still used root-only char order internally; updated it to use `visibleBlockOutline()` so marks in nested blocks materialize correctly.
- Noted an existing unrelated change in `src/block-crdt/Readme.md`; left it untouched.

## Verification

- `npm exec vitest -- examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/selectionSet.test.ts examples/block-rich-text/src/retainedSelection.test.ts src/block-crdt/index.test.ts` passed: 4 files, 70 tests.
- `npm exec vitest -- examples/block-rich-text/src src/block-crdt` passed: 8 files, 122 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npx tsc -p examples/block-rich-text/tsconfig.json --noEmit` passed.
