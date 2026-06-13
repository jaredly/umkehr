# Plim Integration Implementation Log

## 2026-06-12

- Started implementation from `.tasks/050xn-plim-integration/plan.md`.
- Confirmed Plim was not installed locally; sandboxed `npm view` failed with DNS as expected under restricted network.
- Used approved network access to inspect `@plim/core`, `@plim/editor`, and `@plim/react` 0.0.4 package metadata/tarballs.
- API notes: `@plim/react` exports `<PlimEditor>`, `useEditorHandle`, and a React handle whose `current` is an `AgnosticEditor`; `@plim/core` exposes `DocumentNode`, `EditorState`, `TransactionOp`, `Transaction`, built-in blocks/marks, and path helpers.
- Added `examples/plim-block-crdt` with package wiring, Vite config, React app shell, adapter README, fixture state, pure adapter module, and adapter tests.
- Implemented CRDT-to-Plim materialization, metadata/mark conversion, path/offset conversion, local retained selection conversion, transaction translation, local apply, and remote apply helpers.
- Issue encountered: Plim's own `applyOp` creates random temporary block ids for split/insert. Workaround: the translator keeps a planned Plim document and remaps newly-created split/insert blocks to the CRDT Lamport ids immediately after applying the Plim op.
- Issue encountered: building the example from the repo install could not resolve `vite` because Vite was only transitive through Vitest. Workaround: added Vite as a direct root dev dependency.
- Verification passed: focused adapter tests, example TypeScript check, `pnpm --dir examples/plim-block-crdt build`, `npm run typecheck`, `npm run typecheck:examples`, and full `pnpm exec vitest run`.
- Started the example dev server with `pnpm --dir examples/plim-block-crdt exec vite --host 127.0.0.1 --port 5175`; `curl -I http://127.0.0.1:5175/` returned HTTP 200.
- Added Testing Library React tests for the Plim example app covering initial render, scripted remote insert, scripted remote split, and a basic Plim `beforeinput` text insertion.
- Bugs caught by the React tests: the example actor id was `plim-local`, which is invalid because Lamport actor ids cannot contain `-`; changed it to `plimlocal`. The remote split button used low-level `cache.charContents` length, which undercounted tree-shaped text; changed it to `visibleLengthForBlock`.
- Verification passed after React tests: `pnpm exec vitest run examples/plim-block-crdt/src/App.test.tsx examples/plim-block-crdt/src/plimBlockCrdtAdapter.test.ts`, `pnpm exec tsc -p examples/plim-block-crdt/tsconfig.json --noEmit`, and `pnpm --dir examples/plim-block-crdt build`.
- Fixed selection reset bug: Plim emits `setSelection` transactions from `selectionchange`; the app was sending those through the document rematerialization path, which fell back to the first block. Selection-only transactions now update `adapter.plim.selection` and retained selection directly without rebuilding from document-start fallback.
- Added a regression test that places the DOM caret in the heading, fires `selectionchange`, and verifies Plim's active caret block remains the heading.
- Fixed selection advancement after typing/paste-like replacements: document transactions were retaining the pre-edit selection. `applyLocalTransaction` now uses the post-Plim transaction state when available, with a fallback for collapsed insertions where Plim leaves selection at the insertion point. Added regressions for sequential typing (`X`, then `Y`) and paste-like `replaceText` preserving the advanced caret.
- Fixed split selection reset: Plim's post-split state contains a temporary id for the newly-created block, so retaining against that document fell back to the first CRDT block. Local apply now combines the post-transaction selection with the adapter's canonical planned Plim document, whose created block ids have been remapped to CRDT Lamport ids. Added pure and React regressions for split selection staying in the new block.
