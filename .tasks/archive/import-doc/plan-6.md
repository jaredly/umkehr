# Phase 6: Server Local Archive Import/Export

## Goal

Support server-mode local replica backup/restore before backend import protocol changes.

## Depends On

- Phase 1 shared archive/file controls and validation helpers.
- Phase 5 server `appId` metadata and local replica listing.

## Scope

1. Add server persistence helpers.
   - `listServerReplicas()`
   - `replaceServerReplica(replica)`
   - test-only `deleteServerReplica(docId)` if useful
2. Add server archive adapter and file controls.
3. Export the active `PersistedServerReplica` as `payload.kind === 'server'`.
   - Include `appId`, schema metadata, doc id, and `exportedBy: {actor: identity.actor}`.
4. Validate imported server replicas.
5. Re-materialize or verify imported branch histories.
6. Persist imported replicas under `archive.docId`.
7. Hot-switch active server document and refresh local/remote summary lists.
8. Ensure imported archives record but do not recreate the exporting actor.
   - Event origins remain as authored in the event log.
   - The current importing actor is used for future local updates.

## Completion Checks

- Server archive export/import works locally.
- Wrong app id, schema, malformed branches, and malformed update events are rejected.
- Imported local replica appears in the picker and hot-switches without page reload.

## Suggested Tests

- Export/import active server replica locally.
- Import rejects wrong app id/schema.
- Imported branch events materialize the same branch state locally.
- Existing local document switching still works after import.
