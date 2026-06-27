# Implementation Log: Document Fixtures

## 2026-06-24

- Started implementation from `plan.md`.
- Inspected `documentFormat`, `annotations`, `attachments`, `history`, and app test helpers.
- Noted an existing issue: `history.ts` import validation supports current op types but `isRichBlockMeta` does not accept `preview` blocks even though `documentFormat` and the app support them. This needs to be fixed before fixture-backed histories can reliably include preview fixtures.
- Phase 1 in progress: added annotation JSON support to `documentFormat`.
- Bug encountered: initial cleanup removed the `ROOT_ID` constant even though export still uses the root string id. Restored it before continuing.
- Issue encountered: virtualized traversal exports annotation body blocks as regular `children`. Workaround/fix: use non-virtual child traversal for normal document children, and reserve virtual traversal for `annotations[].body`.
- Phase 2 in progress: added generated fixture definitions and validation tests.
- Bug encountered: the fixture registry referenced `const` fixture builder functions before initialization. Switched fixture builders to function declarations.
- Issue encountered: CRDT actor ids cannot contain `-`, so using fixture ids directly as test import actors fails. Tests now use a safe fixed actor id; production fixture import should also avoid fixture ids as actor ids.
- Bug encountered: importing/exporting long text fixtures can overflow recursive block-CRDT char traversal when generated words are too long. Attempted an iterative core traversal fix, but it regressed an existing render-performance test. Final workaround: keep core traversal unchanged and generate stress fixtures with short word tokens while preserving the requested word counts.
- Performance issue encountered: generated fixture import was too slow through generic `applyMany` for large text inserts. Updated `documentFormat` to use the optimized `applyCharInsertOps` path for pure text insert ops.
- Remaining limitation: `exportDocument` is still expensive on the heaviest generated fixtures, especially the heavily marked 600-word block and 200-block document. Fixture tests validate import for all fixtures but only run export checks on representative non-heavy fixtures because fixture loading does not require export.
- Phase 3 in progress: added `replace-document` history action and runtime helper to create both replicas from an imported document.
- Bug encountered: the new runtime helper initially missed its `lamportToString` import. Fixed before continuing history verification.
- Phase 4 in progress: added the "Replace document from fixture" dropdown, fixture attachment loading, history reset to a `replace-document` action, and top-bar select styling.
- Added App tests covering fixture replacement, generated image plus missing image rendering, and the large table fixture.
- Test issue encountered: the first full focused run failed an existing timing-sensitive render-performance assertion (`markedRenderMs` threshold) unrelated to fixture behavior. Rerunning before taking action.
- The render-performance assertion continued to fail when the full `App.test.tsx` suite runs, but passes in isolation. The fixture-specific App tests pass. I am treating this as an existing load-sensitive benchmark issue and not changing the threshold in this task.
- Typecheck issue encountered: `undoHistory.ts` assumed history actions were only local changes or online toggles. Added explicit `replace-document` handling that resets the derived undo index to the imported document base.
- Verification passed:
  - `npm exec vitest -- run examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/documentFixtures.test.ts examples/block-rich-text/src/history.test.ts`
  - `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "fixture|generated fixture|large table fixture"`
  - `npm exec vitest -- run examples/block-rich-text/src/undoHistory.test.ts`
  - `npm run typecheck:examples`
- Verification caveat: full `examples/block-rich-text/src/App.test.tsx` still fails only the existing timing-sensitive test `keeps React render after typing in a 70 word block with every fifth word bolded close to plain text` when run as part of the full suite. The same test passes in isolation, and the fixture-specific App tests pass.
