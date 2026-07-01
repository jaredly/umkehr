# Implementation Log: Jigsaw Document Creation Options

## 2026-06-29

### Phase 1: Generic Document Init Contract

- Started by adding the shared app-level initialization API planned in `plan.md`.
- Added `documentInit` to `AppDefinition`.
- Updated `createInitialHistory` and `createInitialCrdtHistory` to accept optional init params.
- Added `initialArtifactsForApp` so app-specific document params can initialize artifacts without pushing params into the generic `ArtifactStore` API.

### Phase 2: Jigsaw Init Params

- Added a pure `initialJigsawArtifacts(pieceCount)` helper.
- Added `isJigsawPieceCount` for document init validation.
- Added required jigsaw `documentInit` with a `Number of pieces` select and artifact-only piece count initialization.

### Phase 3: Document Manager Form

- Extended `DocumentManagerModal` with optional app-specific creation fields and `initialOpen`.
- Changed blank document creation input to carry `initParams`.
- Preserved existing title input and "New document" behavior; creating still does not auto-switch.

### Phase 4: URL Selection

- Added `readOptionalActiveDocIdFromSearch` so modes can distinguish an explicit `doc` from fallback defaults.

### Phase 5/6: Runtime Plumbing And Required-Init Behavior

- Updated solo mode to pass init params into blank history/artifact creation.
- Added artifact persistence for solo documents so jigsaw's artifact-only piece count survives reload/import paths in solo mode.
- Updated local simulator mode to avoid implicit required-init document creation and to create all replicas from the same init params.
- Updated PeerJS host mode to use creation params; clients remain snapshot-only and still do not show document management.
- Updated server mode with an explicit `needsDocument` load state after login, plus shared parameterized blank server replica creation.
- Updated local-first mode with an explicit `needsDocument` load state that avoids taking a tab lock for the default doc when no document has been chosen.
- Added light styling for app-specific fields in the document creation form.

Issues/workarounds:

- Solo mode did not previously persist artifacts even though archive payload types allowed them. This would have lost jigsaw piece count because the count is intentionally artifact-only. I extended solo persistence to include optional artifacts.
- Server and local-first needed separate chooser shells instead of pretending a document was loaded; this keeps branch/replica sync code from starting against an implicit default jigsaw document.
- The jigsaw smoke test previously opened a brand-new explicit doc id and expected auto-creation. I updated it to create/open through the document manager because missing explicit jigsaw docs now intentionally require creation options.
- Playwright exposed a race in the shared `openDocumentManager` helper: when a modal was already opening, the trigger was `aria-expanded=true` while the overlay intercepted clicks before the modal section appeared. The helper now checks `aria-expanded` and waits for the modal instead of clicking through the overlay.

### Phase 7: Tests

- Added unit coverage for `readOptionalActiveDocIdFromSearch`.
- Added jigsaw unit coverage for piece-count validation and parameterized initial artifacts.
- Updated document helper creation to optionally fill `Number of pieces`.
- Added jigsaw Playwright coverage for missing explicit docs and no-current-doc modal behavior.
- Updated the existing jigsaw smoke test to create and open a jigsaw document before testing canvas navigation.

### Phase 8: Verification

- `./node_modules/.bin/tsc -p tsconfig.json --noEmit` exits 0. It prints `Error connecting to agent: Operation not permitted` in this environment, but TypeScript reports no errors.
- `npm exec vitest -- run src/lib/useUrlSelection.test.ts src/apps/jigsaw/jigsaw.test.ts`: passed, 2 files / 19 tests.
- `pnpm test:e2e -- tests/smoke/jigsaw-solo.spec.ts`: passed, 3 tests.
- `pnpm test:e2e -- tests/documents/document-manager.spec.ts`: passed, 2 tests.
