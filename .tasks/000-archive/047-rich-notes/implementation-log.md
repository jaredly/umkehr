# Rich notes implementation log

## Progress

- Started implementation under the existing `examples/react-crdt` harness, per the answered plan questions.
- Chose to build the rich-text editor binding in the app panel from `useValue` and rich-text patch dispatches so the app can work in solo/history as well as CRDT sync modes.
- Added the `rich-notes` app model, schema, providers, app definition, panel, sidebar helpers, registration, and scoped CSS.
- Added `materializeRichTextValue` to the public rich-text entrypoint so the example can derive sidebar titles from rich-text values without importing internal Peritext modules.
- Updated the React CRDT and root examples README files to mention the rich-text notes app.
- Added focused helper tests for rich note title derivation, sorting, and archive filtering.
- Added `tests/smoke/rich-notes-local.spec.ts`, a local-simulator Playwright repro that types `hello` into the rich note editor and expects both local replicas to show the full text.
- Added a Testing Library integration repro in `src/react-crdt/react-crdt.test.tsx` that feeds sequential rich-text input through the real `createSyncedContext` + `RichTextEditor` path.

## Verification

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` passed.
- `pnpm exec vitest run src/richtext/index.test.ts` passed.
- `pnpm exec vitest run src/package-smoke.test.ts` passed.
- `pnpm exec vitest run examples/react-crdt/src/apps/rich-notes/helpers.test.ts` passed.
- `pnpm --dir examples/react-crdt exec vite build` passed after rebuilding the root package.
- `pnpm --dir examples/react-crdt build` is blocked by pre-existing TypeScript errors in `examples/migration-fixtures/todos.ts` and `examples/react-crdt/src/lib/server/materialize.ts` involving `CrdtRichTextUpdate` union narrowing.
- The Browser plugin smoke test could not run because the in-app browser backend reported `Browser is not available: iab`.
- A standalone Playwright smoke attempt hung during browser startup in this environment and was killed; it did not produce a valid result.
- `pnpm --dir examples/react-crdt exec playwright test -c playwright.config.ts tests/smoke/rich-notes-local.spec.ts` currently fails in the rich-text editor: after typing `hello`, the left editor contains `hel` and the textbox aria label reports `Body for hlo`.
- `pnpm exec vitest run src/react-crdt/react-crdt.test.tsx -t "handles sequential rich text keyboard insertion"` currently fails with the same character-loss class of bug: expected `hello`, received `hel`.
