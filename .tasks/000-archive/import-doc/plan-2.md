# Phase 2: Solo Documents And Solo Archive

## Goal

Make the solo history architecture multi-document and import/export capable.

## Depends On

- Phase 1 shared archive, document picker, file controls, URL helpers, and validation helpers.

## Scope

1. Add solo document persistence keyed by `docId`.
   - Store `{docId, appId, schemaFingerprintHash, history, createdAt, updatedAt}`.
   - List summaries for the document picker.
2. Load the active solo document from `?doc=...`, falling back to the app default.
3. Add solo document picker and switch/create behavior.
4. Make `SoloApp` use stateful `historySnapshot` loaded by `docId`.
5. Persist provider history changes back to the active `docId`.
6. Add a solo archive adapter and file controls.
7. Export `payload.kind === 'solo'` with required archive `docId`, `appId`, schema fingerprint, and optional `exportedBy: {actor: 'solo'}`.
8. Import only `payload.kind === 'solo'`.
9. Validate imported history.
10. Persist imported archives under `archive.docId`, add them to the picker, and hot-switch to them.
11. Verify the history provider responds to changed `initial`; if it does not, add equivalent initial-replacement behavior to the history React provider.

## Completion Checks

- The solo picker lists, creates, and switches documents.
- Solo export downloads a JSON archive with `payload.kind === 'solo'`.
- Solo import persists `archive.docId`, selects it, and hot-swaps the visible history.
- Wrong app/schema and malformed patches are rejected.

## Suggested Tests

- Round-trip a solo archive and confirm `current`, `initial`, and history nodes are preserved.
- Reject wrong app/schema and malformed patches.
- Document picker lists, creates, and switches solo documents.
