# Phase 5: Server App Metadata And Local Document Listing

## Goal

Make server document identity app-aware and make offline/local server document switching reliable.

## Depends On

- Phase 1 shared document picker and URL helpers.

## Scope

1. Add `appId` to the server `documents` table and migrate existing rows.
2. Include `appId` in:
   - server `DocumentSummary`;
   - seed documents;
   - debug output;
   - `/documents`.
3. Include `appId` in client/server `hello`, migration, import-related messages, and document parsers.
4. Update `ensureDocument` to accept and verify/backfill `appId`.
   - Existing rows with empty app id can be backfilled on first matching hello.
   - A non-empty mismatched app id should produce a clear incompatible-document error.
5. Add `appId` to `PersistedServerReplica`.
   - Bump server client IndexedDB storage version.
   - Normalize older replicas by filling `appId` from active `app.id`.
6. Add local server replica listing helpers.
   - `listServerReplicas()` or `listServerReplicaSummaries()`.
7. Merge local IndexedDB summaries with remote `/documents` summaries in `ServerApp`.
   - Prefer server metadata when both exist.
   - Preserve manual active doc behavior.
8. Filter or label picker entries by active app id.

## Completion Checks

- Existing server data migrates without losing documents.
- `/documents` returns `appId`.
- Client parsing rejects malformed summaries.
- Server mode can switch to local-only replicas while offline.
- Incompatible app documents do not appear as normal options for the active app.

## Suggested Tests

- Store migration adds app id and preserves existing documents.
- `/documents` returns app id.
- Client document parser rejects invalid app id shape.
- Offline local replicas appear in the document picker.
