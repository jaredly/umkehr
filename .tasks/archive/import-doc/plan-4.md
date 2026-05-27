# Phase 4: PeerJS Host Documents And Archive

## Goal

Make PeerJS host documents switchable, exportable, and importable while keeping client import disabled.

## Depends On

- Phase 1 shared infrastructure.

## Scope

1. Add PeerJS host document persistence keyed by `docId`.
   - Store `{docId, appId, schemaFingerprintHash, history, createdAt, updatedAt}`.
   - List summaries for the document picker in host mode.
2. Load the active host document from `?doc=...`.
3. Add host document picker and switch/create behavior.
4. Store host history in `PeerJsApp` state and update it through provider `save`.
5. Include active `docId` in PeerJS protocol config and invite URLs.
6. Add a host document picker that switches host history and updates `sync.setSnapshotDocument`.
7. Add a PeerJS archive adapter and file controls.
8. Export host history as `payload.kind === 'peerjs'` with required archive `docId`.
9. Allow client export after a snapshot is installed if useful, but keep import host-only.
10. Enforce host-only import.
11. On host import:
    - reject when role is not `host`;
    - validate archive and CRDT history;
    - persist the imported archive under `archive.docId`;
    - switch active `docId`;
    - replace host history state;
    - call `sync.setSnapshotDocument(importedHistory.doc)`.
12. Decide whether to proactively disconnect connected clients after host import. First pass can show a message that connected clients need to reconnect, but the behavior should be explicit in UI and tests.
13. Do not include PeerJS connection state, invite URLs, or queued messages in the archive.

## Completion Checks

- Host picker switches documents and updates future invite/snapshot behavior.
- Host export/import round-trips CRDT history.
- Client import is disabled or rejected with a clear error.
- A fresh client joining after host import receives the imported snapshot.

## Suggested Tests

- Host export/import round-trip preserves CRDT history.
- Client import is rejected.
- Host import updates the snapshot used for later clients.
- Host document picker switches between PeerJS documents and updates invite URLs/snapshots.
