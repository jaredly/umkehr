# Phase 7: Server Backend Import Protocol

## Goal

Make imported server archives replicate to the backend when the server does not yet know the document.

## Depends On

- Phase 5 server `appId` metadata.
- Phase 6 server local archive import/export.

## Scope

1. Add server-to-client `unknownDocument` message during `hello`.
2. Add client-to-server document import message, similar to `serverMigrationUpload` but not migration-lock based.
   - `appId`
   - `docId`
   - schema version/fingerprint/hash
   - branches
   - events
   - importedAt
   - importedBy actor/user id
3. Add server store `importDocument(upload, options)`.
   - Validate app id and schema metadata.
   - Validate branches and event consistency.
   - Insert or replace document transactionally.
   - Preserve event indices only when internally consistent.
   - Reject replacement unless explicitly requested and confirmed.
4. Client import flow:
   - write local replica;
   - switch active doc;
   - connect;
   - respond to `unknownDocument` by uploading full imported branch/event contents;
   - mark matching events recorded after server ack;
   - refresh `/documents`.
5. Keep event origins as authored; use the current actor only for the import/upload envelope.
6. Add UI confirmation if import will create, upload, or replace backend data.

## Completion Checks

- Importing a server archive for an unknown `docId` creates the backend document.
- `/documents` includes the imported backend document.
- Existing-document replacement is rejected or requires explicit confirmation.
- Reconnecting another client can subscribe to and materialize the imported server document.

## Suggested Tests

- Server protocol parse/validation for `unknownDocument` and import upload.
- Server store import transaction creates the document with app id/schema/branches/events.
- Unknown document handshake triggers import upload and creates the backend document.
- Existing-document replacement is rejected or gated by confirmation.
- Imported branch events materialize the same branch state after server round-trip.
