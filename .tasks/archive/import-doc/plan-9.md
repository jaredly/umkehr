# Phase 9: Polish And End-to-end Verification

## Goal

Make the feature cohesive across all architectures and verify the full workflow.

## Depends On

- Phases 1 through 8.

## Scope

1. Normalize toolbar placement and styling for document picker and archive controls.
2. Add concise error/status display.
3. Add confirmations for server import/upload/replace behavior.
4. Update README or task implementation notes with manual testing steps.
5. Run package-level checks for the example and server packages.

## Completion Checks

- Every mode can create/switch documents.
- Every mode can export a JSON archive.
- Every mode can import a matching JSON archive.
- Wrong app and wrong payload kind are rejected consistently.
- No import path relies on full page reload unless explicitly documented as a temporary fallback.

## Manual Verification

1. Start the React CRDT example.
2. For each mode, create edits, export, reset/switch away, import, and verify visible state and history/log behavior.
3. Local simulator: pause sync, diverge replicas, export/import, resume sync.
4. PeerJS: export/import on host, connect a fresh client, verify snapshot.
5. Server: export a local replica, import into a missing doc id, verify backend creates the document and `/documents` includes it.
6. Local-first: export/import with retained batches and sync to a peer.

## Suggested Tests

- Run all targeted tests added in earlier phases.
- Run package-level checks for `examples/react-crdt`.
- Run package-level checks for `examples/react-crdt-server`.
- Document any unavailable scripts or temporary reload fallback in the implementation log.
