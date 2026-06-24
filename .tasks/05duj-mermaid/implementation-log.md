# Implementation Log: Mermaid Diagram Block Type

## Phase 1: Dependency And Data Model

- Started implementation from `.tasks/05duj-mermaid/plan.md`.
- Confirmed the repo uses `pnpm` with a root `pnpm-lock.yaml`; `examples/block-rich-text` has its own `package.json` but no local lockfile.
- Issue: `pnpm add mermaid --filter ./examples/block-rich-text` did not match any project because `pnpm-workspace.yaml` does not define package globs. Workaround: ran `pnpm add mermaid` from `examples/block-rich-text`, which updated that package and the root lockfile.
- Added `mermaid` dependency.
- Added `mermaid` to `RichBlockMeta` and `sameTypeWithTs`.
- Added import/export support for no-metadata Mermaid blocks.

## Phase 2: Block Type Creation Surfaces

- Added Mermaid to `BlockTypeMenuValue`, slash commands, toolbar select, `blockTypeMeta`, and `blockTypeMenuValue`.

## Phase 3: Editing Behavior

- Added code-like editor handling for Mermaid blocks in `App.tsx`:
  - monospaced/code surface class
  - trailing newline sentinel support
  - `Tab` inserts four spaces
  - no Mermaid syntax highlighting
- Added Mermaid-specific `splitBlock` behavior:
  - inserts newline normally
  - exits via the existing code-block exit helper when the caret is at the end and content ends in `\n\n`
- Updated multiline paste guard so Mermaid blocks keep pasted multiline source inside one block.

## Phase 4: Mermaid View/Edit UI

- Added `MermaidBlock` with local `edit`/`view` state initialized to `edit`.
- Added async Mermaid rendering with one-time `mermaid.initialize`, stale-result cancellation, sanitized render ids, and inline error display.
- Added non-editable preview rendering with Mermaid SVG output.

## Phase 5: Styling

- Added compact styles for Mermaid toolbar, mode toggle, preview, SVG sizing, and error state.

## Phase 6: Tests

- Added command tests for Mermaid newline insertion, single-trailing-newline retention, two-trailing-newline exit, and multiline paste.
- Added document-format coverage for Mermaid import and import/export round-trip.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts`: passed, 2 files / 162 tests.
- Added clipboard support so Mermaid copies as preformatted HTML and internal clipboard metadata accepts `mermaid`.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/clipboard.test.ts`: passed, 3 files / 183 tests.
- Ran `npm run build` in `examples/block-rich-text`: passed. Reran after clipboard changes: passed.
- Issue: build command printed `Error connecting to agent: Operation not permitted` before npm output, but the build completed successfully. This appears unrelated to the app build.
- Issue: Vite warned that some chunks are larger than 500 kB after adding Mermaid. This is expected from the official Mermaid package's dependency graph; no code-splitting workaround was added in this pass.

## Phase 7: Manual Verification

- Started Vite dev server from `examples/block-rich-text`.
- Port `5173` was already in use, so Vite selected `http://127.0.0.1:5174/`.
- Verified the dev endpoint with `curl -I http://127.0.0.1:5174/`: HTTP 200.

## Follow-up: Mermaid Fixture

- Added a `mermaid-diagram` fixture document with a representative flowchart.
- Added fixture test coverage to confirm the fixture includes Mermaid source.
- Ran `npm exec vitest -- run examples/block-rich-text/src/documentFixtures.test.ts`: passed, 1 file / 32 tests.

## Follow-up: Default Mermaid Mode

- Changed Mermaid blocks to initialize in `view` mode when source content is non-empty, and `edit` mode when source is empty.
- Added App UI tests covering populated fixture blocks opening in view mode and newly-created empty Mermaid blocks opening in edit mode.
- Mocked Mermaid rendering in `App.test.tsx` so jsdom tests do not depend on the browser renderer.
- Ran `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "mermaid"`: passed, 1 file / 2 tests.
- Ran full `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx` twice: failed both times on the existing/order-sensitive perf threshold test `keeps React render after typing in a 70 word block with every fifth word bolded close to plain text`; the measured values were about 8.69ms vs 6.12ms and 8.38ms vs 5.96ms.
- Ran that perf test alone with `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "keeps React render after typing in a 70 word block"`: passed.
- Ran `npm run build` in `examples/block-rich-text`: passed, with the same non-fatal SSH agent message and Vite Mermaid chunk-size warning noted above.

## Follow-up: Mermaid Render Cache

- Changed Mermaid preview rendering so source changes keep showing the previous successful SVG while the next render is pending.
- Added a `rendering` render state that carries the cached SVG; the `Rendering diagram...` text is now only used before the first successful render.
- Added an App UI regression test that edits one replica while the other remains in Mermaid view mode and verifies the old SVG stays visible until the delayed render resolves.
- Ran `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "mermaid"`: passed, 1 file / 3 tests.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/documentFixtures.test.ts`: passed, 4 files / 215 tests.
- Ran `npm run build` in `examples/block-rich-text`: passed, with the same non-fatal SSH agent message and Vite Mermaid chunk-size warning noted above.

## Follow-up: Mermaid Error Overlay

- Changed Mermaid render errors after a successful render to preserve the cached SVG and show the error in a bottom overlay.
- First-render errors still use the full error panel because there is no cached visual yet.
- Added an App UI regression test that makes the remote Mermaid re-render fail and verifies the previous SVG remains visible with `.mermaidErrorOverlay`.
- Initial build caught a TypeScript narrowing issue for cached error SVGs; fixed by deriving an explicit `visualSvg` local before rendering.
- Ran `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "mermaid"`: passed, 1 file / 4 tests.
- Ran `npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/documentFixtures.test.ts`: passed, 4 files / 215 tests.
- Ran `npm run build` in `examples/block-rich-text`: passed, with the same non-fatal SSH agent message and Vite Mermaid chunk-size warning noted above.

## Follow-up: Consecutive Mermaid Errors

- Fixed a cache drop after consecutive render errors: `error` states with a cached SVG are now treated as cache sources during the next pending render and catch transition.
- Added a `cachedMermaidSvg` helper so `rendered`, `rendering`, and cached `error` states all preserve the same SVG consistently.
- Extended the error-overlay regression test to trigger a second failing update and verify the original SVG remains visible.
- Ran `npm exec vitest -- run examples/block-rich-text/src/App.test.tsx -t "mermaid"`: passed, 1 file / 4 tests.
- Ran `npm run build` in `examples/block-rich-text`: passed, with the same non-fatal SSH agent message and Vite Mermaid chunk-size warning noted above.
