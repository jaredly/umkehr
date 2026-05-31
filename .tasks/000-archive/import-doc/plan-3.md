# Phase 3: Local Simulator Documents And Archive

## Goal

Preserve the full two-replica simulator state across document switching and archives.

## Depends On

- Phase 1 shared infrastructure.
- Phase 2 only if you want to reuse solo persistence or picker patterns; no hard runtime dependency.

## Scope

1. Add local simulator document persistence keyed by `docId`.
   - Store `{docId, appId, schemaFingerprintHash, replicas, transportState, createdAt, updatedAt}`.
   - List summaries for the shared document picker.
2. Load the active simulator document from `?doc=...`.
3. Add document picker and switch/create behavior.
4. Refactor `LocalSimulatorApp` to hold per-replica histories, not one shared initial object.
5. Pass each replica's history to its provider.
6. Persist each replica's provider history changes for the active document.
7. Add `DemoSync` snapshot/replace APIs for `TransportState`.
   - `exportTransportState()`
   - `replaceTransportState(state)`
8. Add a local simulator archive adapter and file controls.
9. Export:
   - all replica histories;
   - `syncEnabled`;
   - outbox updates for every replica.
10. Import only `payload.kind === 'local-simulator'`.
11. Validate every replica history and queued update.
12. Persist imported archives under `archive.docId`.
13. Replace all replica histories and transport state together so imported replicas do not briefly sync partial state.
14. Omit status/presence stores from the archive.

## Completion Checks

- The local simulator picker switches between independent documents.
- Export includes all replicas and all outboxes.
- Import replaces all replica histories and transport state together.
- Resuming sync after import delivers queued updates.

## Suggested Tests

- Round-trip with sync disabled, divergent replicas, and queued outbox updates.
- After import, re-enabling sync delivers queued updates.
- Document picker switches between independent local simulator documents.
