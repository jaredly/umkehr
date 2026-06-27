# Implementation Log

## Phase 0: Orientation

- Started implementation from `plan.md`.
- Goal: add a Wordsearch app whose CRDT state only tracks finds, with immutable puzzle data carried as artifact payloads across server, PeerJS, local-first, and archive paths.

## Phase 1: Artifact API And PeerJS Foundation

- Added `examples/react-crdt/src/lib/artifacts` with artifact types, serialized payloads, manifest validation, deterministic canonical JSON, and a small FNV-1a fingerprint helper.
- Extended `AppDefinition` with optional `artifacts`.
- Extended document archive payload types to carry optional serialized artifacts and load them during archive import.
- Added optional artifact payloads to PeerJS persisted documents.
- Extended PeerJS snapshot messages with optional serialized artifact payloads and a separate artifact size limit.
- Wired `PeerJsApp` so host documents save serialized app artifacts, archives include artifacts, and clients load artifacts received in host snapshots.
- Issue noted: artifact storage is currently app-store-backed and synchronous; this is enough for JSON puzzle payloads but not for large binary artifacts.

## Phase 2: Wordsearch App

- Added the wordsearch puzzle artifact with fixed id `"puzzle"`, serialization, validation, and fingerprinting.
- Added `WordsearchState` with only `found` as CRDT state.
- Workaround/decision: initialized `found` with one empty nested record per puzzle word. This avoids concurrent first finds racing to create the same `found[wordIndex]` parent object and losing one actor entry.
- Added wordsearch synced/history contexts and typed ephemeral selection messages.
- Added selection/matching/first-finder helpers.
- Added `WordsearchPanel`, app registration, and scoped CSS.
- Correction: the first implementation used a fixed puzzle artifact. This missed the original requirement that the puzzle be generated when a document is created. Added `ArtifactStore.createInitial()` and changed wordsearch to generate a fresh puzzle artifact for new documents.
- New document creation paths now use generated initial artifacts in local simulator, PeerJS, server, and local-first local persistence.
- Ran `pnpm build` in `examples/react-crdt`; TypeScript and Vite build passed. The command emitted `Error connecting to agent: Operation not permitted` before the build output, but the build itself completed successfully.
- Issue found by tests: the first hand-authored puzzle board did not actually spell `MERGE` or `SYNC` at the configured coordinates. Fixed the board and word placements, then added a test that verifies every word placement matches board letters.

## Phase 3: Server Artifact Payloads

- Extended client/server document archive payloads with serialized artifacts.
- Extended server-side document metadata and summaries with artifact manifests.
- Added artifact payload storage to `examples/react-crdt-server` using an `artifactsJson` column on `documents`.
- Server document imports now persist artifact payloads.
- Server hello and branch snapshot messages now include serialized artifacts so clients can hydrate missing document artifacts.
- Server migration dump/upload paths preserve artifact payloads.
- PeerJS host snapshots include serialized artifacts, and PeerJS clients load them on snapshot receipt.
- Verification:
  - `npm exec vitest -- run src/apps/wordsearch/wordsearch.test.ts` passed.
  - `pnpm build` in `examples/react-crdt` passed.
  - `pnpm test` in `examples/react-crdt-server` passed.
  - `pnpm typecheck` in `examples/react-crdt-server` passed.
- Issue noted: `pnpm` commands in the server package print a registry metadata fetch warning in this restricted network environment before running the requested script; the scripts themselves completed successfully after the warning.
- Remaining issue: local-first now persists generated artifacts locally, but full local-first peer snapshot exchange for artifact payloads is not wired yet. Server mode and PeerJS mode transfer artifact payloads; local simulator saves artifacts with local documents.
