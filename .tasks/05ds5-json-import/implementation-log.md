# Implementation Log: Block Rich Text JSON Import/Export

## 2026-06-24

- Started implementation from `plan.md`.
- Confirmed local conventions:
  - Example tests use Vitest with small local `ctx()` helpers.
  - Clipboard parsing uses hand-written validation rather than generated validators.
  - `typia` exists at the repo root but is not an `examples/block-rich-text` dependency, so this implementation will use manual path-aware validation.
- Implementation choice: export will use `materializeFormattedBlocks` so exported marks represent visible resolved formatting, not raw CRDT mark history.
- Issue encountered: I expected `TypeScript` to normalize to `ts`, but the existing `normalizeStoredCodeLanguage` behavior stores it as `typescript`. Kept the existing behavior and updated tests accordingly.
- Added `examples/block-rich-text/src/documentFormat.ts`.
  - Defines the document JSON block/mark types.
  - Implements path-aware validation via `DocumentFormatError`.
  - Imports into a fresh empty block-CRDT state, dropping the starter paragraph by construction.
  - Supports exact block type names, nested children, image metadata, preview metadata, and normal nested table blocks.
  - Applies bold, italic, strikethrough, code, and link marks from grapheme offsets.
  - Exports visible block content/metadata/marks back to the same JSON format without timestamps.
- Added `examples/block-rich-text/src/documentFormat.test.ts`.
  - Covers empty import, default paragraph type, root ordering, child ordering, metadata-bearing blocks, image/preview metadata, nested tables, grapheme-offset marks, path-aware validation errors, and export round-trips.
- Verification:
  - `npm exec vitest -- run examples/block-rich-text/src/documentFormat.test.ts` passed: 9 tests.
  - `npm run typecheck:examples` passed.
  - `npm test` failed twice on the existing perf-sensitive UI benchmark `examples/block-rich-text/src/App.test.tsx > keeps React render after typing in a 70 word block with every fifth word bolded close to plain text`.
    - First full-suite failure: expected `10.5` to be less than `10.24`.
    - Isolated rerun of that single test passed.
    - Second full-suite failure: expected `8.83` to be less than `5.76`.
    - No document import/export tests failed in either full-suite run.
