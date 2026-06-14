# Implementation Log: Block Rich Text Multi-Select

## Phase 1: Selection Set Model

- Started from the retained-selection baseline where `Replica.selection` stores one `RetainedSelection`.
- Adding a separate `selectionSet.ts` module so the existing single-selection helpers remain available for command primitives and existing tests.
- Added `RetainedSelectionSet` / `EditorSelectionSet`, primary-selection helpers, caret dedupe, range merging, and per-block decoration models.
- Converted `blockEditorRuntime` to store `RetainedSelectionSet`.
- Verification: `npm exec vitest examples/block-rich-text/src/selectionSet.test.ts --run` passed. npm printed a warning about `--run` as an unknown npm config, but Vitest still ran the file successfully.

## Phase 2: Multi-Command Wrappers

- Adding command wrappers in a new module so `blockCommands.ts` can remain the single-selection primitive layer.
- Added wrappers for typing, paste, Backspace, Enter/split, and formatting across selection sets.
- Verification: `selectionSet.test.ts`, `multiSelectionCommands.test.ts`, and `blockCommands.test.ts` passed.

## Phase 3: App Integration

- Converted `App.tsx` to use retained selection sets at the runtime boundary.
- Active editors render native DOM selection for the primary entry and manual decorations for non-primary entries; inactive editors render all entries manually.
- Issue encountered: focusing an inactive editor with retained decorations left marker/highlight DOM in place before browser/test selection was set, causing range capture to collapse around the decorated text. Restored focus-time cleanup of manual decorations before native selection interaction.
- Workaround retained: decorations are removed immediately on focus, then React renders the active non-primary decorations after focus state updates.
- Verification: existing `App.test.tsx` passed after the focus cleanup.

## Phase 4: Triple-Click Occurrence Selection

- Adding exact, case-sensitive word occurrence helpers using `Intl.Segmenter` word segmentation.
- Added `wordOccurrences.ts` with `wordAtPoint` and `findWordOccurrences`.
- Integrated triple-click handling through the editor `mouseUp` path. The clicked occurrence becomes the primary selection, and all exact visible-block occurrences are retained as ranges.
- Added UI coverage for `Cmd`/`Ctrl` add-caret, `Cmd`/`Ctrl` add-range, multi-cursor typing, formatting all ranges, and triple-click exact occurrence selection.

## Issues And Fixes

- Initial `npm exec vitest ... --run` and `npm exec tsc ... --noEmit` invocations produced npm argument-forwarding warnings or mis-parsed flags. Fixed by using `npm exec -- ...` for final verification.
- Focusing inactive editors with manual decorations caused stale decoration DOM to interfere with native range creation. Fixed by stripping decorations on focus before browser selection is read.
- After adding a secondary cursor/range, React rerendered manual decorations but did not restore the newly-added primary native selection. The next edit could read a fallback caret at offset `0`. Fixed by scheduling native selection restore after selection-capture updates, not only after edit commands.

## Final Verification

- `npm exec -- vitest examples/block-rich-text/src/retainedSelection.test.ts examples/block-rich-text/src/selectionSet.test.ts examples/block-rich-text/src/multiSelectionCommands.test.ts examples/block-rich-text/src/wordOccurrences.test.ts examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx --run`
    - Passed: 6 files, 53 tests.
- `npm exec -- tsc -p examples/block-rich-text/tsconfig.json --noEmit`
    - Passed.
