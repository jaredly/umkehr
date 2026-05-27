# Document Modal Implementation Log

## 2026-05-26

- Started implementation from `plan.md`.
- Confirmed current app definitions do not expose a schema version to solo/local/PeerJS modes. I will add `schemaVersion` to `AppDefinition` so every persisted document summary can provide required schema metadata.
- Added `schemaVersion` to `AppDefinition` and populated the registered apps/test app fixtures.
- Added title/schema metadata and delete helpers for solo, local simulator, PeerJS, server local replicas, and local-first replicas.
- Added shared modal row models and `DocumentManagerModal` with document rows, seed rows, new-document creation, local delete, and import/export controls.
- Replaced the old document pickers in solo, local simulator, PeerJS host, local-first, and server modes.
- Removed the server seed controls and the synthetic active-document helper from server document discovery.
- `pnpm --dir examples/react-crdt exec tsc --noEmit` passes after the initial wiring and cleanup.
- Targeted Vitest run passes: `server/documents`, `seed/generate`, `server/materialize`, `server/migration`, and `apps/todos/migrationFixture`.
- `pnpm --dir examples/react-crdt run build` passes; Vite still reports the existing >500 kB chunk warning.
- Local headless Playwright smoke checks passed against `http://127.0.0.1:5173/`: modal opens with import/export/new/seed controls, seed creation keeps the modal open and moves a seed into documents, and blank document creation keeps the modal open and shows the new title.
- Fixed title preservation so subsequent sync/save paths do not overwrite newly created document titles with doc ids. Re-ran typecheck, targeted tests, build, and the blank-document smoke check successfully.
- Follow-up local simulator fix: modal now awaits `onChanged`, seed success names the created seed, and local simulator document refresh returns the updated summaries so create actions update the modal deterministically. Re-ran local headless smoke, typecheck, and build successfully.
- Follow-up loading fix: local simulator now validates persisted records before accepting them. If a stale/corrupt IndexedDB row is missing replica or transport data, the app recreates it instead of staying on "Loading document...". Verified with a headless smoke test that injects a bad default local row, reloads `?mode=local`, and reaches `Replica A`.
