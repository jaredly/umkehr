# Rich text editor implementation log

## Phase 1: Module Extraction And Public API

- Added `src/react-rich-text` with `RichTextEditor`, span rendering, and an index export.
- Added the public `./react-rich-text` package export.
- Updated `src/react-crdt/index.ts` to re-export `RichTextEditor` from the new module while keeping `useRichText` and `RichTextBinding` in `react-crdt`.
- Updated package smoke tests for the new export.
- Issue noted: the extracted editor still has the old full-snapshot `onInput` behavior. This is intentional during Phase 1 and will be replaced in Phase 3.

## Phase 2: Selection And Mark Helpers

- Added `selection.ts` for editor-root-relative selection offsets and offset-based selection restoration.
- Added `marks.ts` for "entire selected range has mark" checks and link value lookup.
- Added focused tests for nested DOM selection mapping, restoring selections, mark coverage, and consistent link detection.
- Verification: `npx vitest run src/react-rich-text/selection.test.ts src/react-rich-text/marks.test.ts` passed.

## Phase 3: Real Text Mutation Commands

- Replaced ordinary editor input handling with `insert`/`delete` command translation.
- Added `diff.ts` for the fallback `input` path, using a single contiguous edit diff.
- Added paste handling that converts compatible inline HTML (`strong`, `em`, `code`, `a[href]`) into inserts plus mark commands.
- Kept `replace` out of normal typing/deleting/paste paths.
- Issue encountered: React/JSDOM did not reliably dispatch `onBeforeInput` in tests, so component tests assert the fallback input path while the browser `beforeinput` handler remains implemented.

## Phase 4: Keyboard Formatting

- Added `Cmd/Ctrl+B` for `strong`.
- Added `Cmd/Ctrl+I` for `em`.
- Implemented mark toggling with the resolved rule: unmark only when the full selected range already has the mark.
- Collapsed selections are ignored; no pending mark state was added.

## Phase 5: Floating Toolbar

- Added an inline-styled floating toolbar for selected text.
- Added bold, italic, code, and link controls.
- Added optional `promptForLink` for testable/custom link entry, falling back to `window.prompt`.
- Toolbar mouse handling prevents focus loss before commands run.

## Phase 6: Selection Preservation And Rerender Behavior

- Removed the editor-level content key that forced contenteditable remounts.
- Added offset-based selection restoration after local commands.
- Issue encountered: fallback `input` tests initially duplicated text because the browser-mutated contenteditable DOM remained in place before React rerendered. The fallback handler now resets the DOM text to the current view before dispatching commands, then lets React render the updated view.
- Verification: `npx vitest run src/react-crdt/react-crdt.test.tsx src/react-rich-text/RichTextEditor.test.tsx src/react-rich-text/selection.test.ts src/react-rich-text/marks.test.ts` passed.

## Phase 7: Integration Tests And Cleanup

- Added `src/react-rich-text/RichTextEditor.test.tsx` for fallback input, diffing, keyboard formatting, HTML paste mark preservation, toolbar code formatting, and toolbar link formatting.
- Kept `RichTextEditor` re-exported from `src/react-crdt/react-crdt.tsx` and `src/react-crdt/index.ts` so existing direct imports continue to work while `umkehr/react-rich-text` is the new public surface.
- Added the `umkehr/react-rich-text` alias to `vitest.config.ts`.
- Issue encountered: the first full `npm test` run failed because Vitest had explicit aliases for existing package subpaths and did not know about `umkehr/react-rich-text`. Adding the alias fixed the package-smoke import.
- Verification:
  - `npm run typecheck` passed.
  - `npm run build` passed.
  - `npm test` passed: 50 files, 389 tests.
