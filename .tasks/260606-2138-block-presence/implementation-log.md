# Implementation Log

## Phase 1: Retained Selection Model

- Started with the existing example storing `EditorSelection` as `{blockId, offset}` on each replica.
- Key implementation choice: stored replica selection will become retained/anchored state only; offset selections remain transient at DOM and command boundaries.
- The retained selection resolver will scan block CRDT traversal order, including tombstoned characters, so a caret can stay anchored to a deleted character's logical position.
- Test setup issue encountered: using a fresh timestamp generator for follow-up block moves/joins caused those ops to be ignored by last-writer-wins timestamp checks. Fixed the tests to reuse one command context per scenario.
- Added `retainedSelection.ts` with retained point/selection types and conversion helpers.
- Added pure retained-selection tests for boundary carets, concurrent insert shifting, tombstone anchoring, ranges, block move, split, and join.
- Refactored `Replica.selection` to store only `RetainedSelection`; offset selections are now converted at command/DOM boundaries in `App.tsx`.
- Verification so far: `npm exec vitest examples/block-rich-text/src/retainedSelection.test.ts examples/block-rich-text/src/blockCommands.test.ts` passes.
- UI rendering issue encountered: splitting every formatted run into one span per grapheme broke existing DOM selection tests because helper offsets target the first text node. Workaround: preserve original run spans unless inactive selection decorations are actually needed for that block.
- Follow-up improvement: replaced per-grapheme decoration rendering with boundary-only splitting. Decorated blocks now split only at caret/range boundaries and existing formatting run boundaries, e.g. `abcd` with range `1..3` renders as `a`, highlighted `bc`, `d`.
- Interaction issue encountered: focusing an inactive editor left decoration spans in the DOM until React rerendered, so immediate selection operations could target the wrong text node. Added synchronous decoration cleanup on editable focus.
- Added inactive selection rendering with inline highlight spans and zero-width caret spans. Decorations are shown only while the editor is inactive.
- Added UI tests for inactive caret display, inactive range display, and retained caret shifting after a remote insert.
- Verification so far: `npm exec vitest examples/block-rich-text/src/App.test.tsx examples/block-rich-text/src/retainedSelection.test.ts examples/block-rich-text/src/blockCommands.test.ts` passes.
- Verification: `./node_modules/.bin/tsc -p examples/block-rich-text/tsconfig.json --noEmit` passes.
- Broader verification issue: `npm run typecheck:examples` failed in `examples/react/src/persistence.ts` with `TS2307: Cannot find module 'umkehr/migration' or its corresponding type declarations.` The command reached the example typecheck after the root build; this appears outside the block-rich-text changes.
- Bug fix: when an inactive retained range was fully deleted by another editor, both retained endpoints resolved to the same visible point, producing a zero-width range and no decoration. `resolveSelection` now collapses same-point ranges to a caret, and tests cover both the pure resolver and UI behavior.
