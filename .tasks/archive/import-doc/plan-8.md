# Phase 8: Local-first Picker And File Archive

## Goal

Bring existing local-first clipboard import/export into the shared file/archive system and add a document picker over local-first replicas.

## Depends On

- Phase 1 shared archive/file controls and validation helpers.

## Scope

1. Add local-first document picker over existing `PersistedReplica` records.
2. Load active local-first doc from `?doc=...`.
3. Support creating/opening a new local-first document for the active app.
4. Replace clipboard/prompt controls with shared file controls.
5. Wrap existing `{replica, batches}` as `payload.kind === 'local-first'` with required archive `docId`.
6. Keep durable `ReplicaIdentity` out of the archive.
7. Add deep update validation for imported batches by reusing or extracting local-first batch validation logic.
8. Persist imported replica under `archive.docId`, select it, and hot-swap local-first refs/state.
9. Clear pending snapshot/replay preview and resync or close peers as needed.
10. If hot-swap is too risky, keep reload only as a temporary fallback and document it in the implementation log. The target behavior remains hot-swap.

## Completion Checks

- Local-first picker lists and switches replicas.
- Export/import round-trips retained batches.
- Imported batches are marked received.
- Malformed batch updates are rejected.
- Imported state can sync to a peer.

## Suggested Tests

- Round-trip `{replica, batches}` through the archive wrapper.
- Imported retained batches are marked received.
- Imported state syncs to a peer.
- Malformed update inside a batch is rejected.
- Document picker lists and switches local-first replicas.
