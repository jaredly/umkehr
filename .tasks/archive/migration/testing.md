# Schema Migration Manual Testing

This document covers the manual testing needed to build confidence in the schema migration work across local history, CRDT history, local-first/PeerJS, and server-backed sync.

The automated tests cover core invariants and focused protocol cases. Manual testing should focus on browser storage behavior, multi-tab/multi-client timing, user-facing states, and end-to-end data preservation.

## Preconditions

- Use a clean working tree or note all local changes before starting.
- Install dependencies for the root package, React CRDT example, and server example.
- Run the automated baseline before manual testing:

```sh
npm test
npm run typecheck:examples
npm run typecheck:tests
cd examples/react-crdt-server && npm run typecheck
cd examples/react-crdt-server && npm test
```

- Start the React CRDT example:

```sh
cd examples/react-crdt
npm run dev
```

- Start the server example in a second terminal:

```sh
cd examples/react-crdt-server
npm run dev
```

- Open the React CRDT app in at least two browser profiles or two browsers. Prefer separate profiles over tabs when testing IndexedDB/localStorage isolation.
- Keep browser developer tools open for Console, Application storage, and Network/WebSocket inspection.

## General Acceptance Criteria

For every migration path:

- Existing documents either load unchanged when schema metadata matches or enter a clear migration/incompatible state when it does not.
- Migration is opt-in where expected.
- Source data is not discarded before migration succeeds.
- Migrated state validates against the current schema.
- Migrated retained operations replay to the same realized state.
- Dropped obsolete operations do not leave replay mismatches.
- Pending local edits remain available and are not silently lost.
- Old clients receive an unobtrusive “update your app” notice and can continue local editing where local editing is possible.
- Server writes pause during server migration locks but local server-mode edits enqueue as pending events.
- Developer console includes detailed errors for validation/replay failures while the UI shows concise user-facing messages.

## Browser Storage Cleanup

Before each scenario, decide whether you need a clean browser profile or existing data.

To reset the React CRDT example manually:

- Clear `localStorage`.
- Clear IndexedDB databases:
  - `umkehr-react-crdt-local-first`
  - `umkehr-react-crdt-server-sync`
- Reload all app tabs.

For server testing, also reset or isolate the server SQLite database. The server default database is `server-sync.sqlite` in `examples/react-crdt-server` unless overridden by code or environment.

## Non-CRDT Local History

Use the `Todos` app in solo/local history mode.

### Fresh Current Schema

1. Clear browser storage.
2. Open the React CRDT example.
3. Select `Todos`.
4. Use solo/local mode.
5. Make several edits:
   - Rename a todo.
   - Toggle completion.
   - Add a todo.
   - Change background color if available.
6. Reload.

Expected:

- The document loads without migration prompts.
- Edits persist.
- Undo/redo still works after reload.
- No schema mismatch warnings appear.

### Legacy Wrapper Compatibility

1. Seed a legacy local history object without the new persisted wrapper, or use an older build that writes unwrapped history.
2. Load the current build.

Expected:

- Data with matching old schema is normalized as version 1 when possible.
- Data with incompatible schema is rejected or ignored without crashing.
- The UI does not lose current valid data after an invalid load.

### Concrete Fixture Shape

Use the migration fixture semantics as a guide when manually creating old data:

- v1 todo item fields: `id`, `text`, `done`, optional `archived`.
- v1 state includes optional `legacyFilter`.
- v2 todo item fields: `id`, `title`, `done`, required `priority`.

Expected after migration:

- `text` becomes `title`.
- `priority` is set to `normal`.
- `archived` and `legacyFilter` are gone.
- Undo/redo and branch/jump history still materialize the expected states.

## Core CRDT History

This is mostly covered by automated tests, but manually verify through app behavior in CRDT-backed modes.

1. Create a document with multiple todo edits.
2. Make edits in different parts of the document:
   - Replace a scalar field.
   - Add an array item.
   - Reorder items if the UI exposes it.
3. Reload.
4. Confirm state is preserved.
5. If testing a schema change, migrate old data and inspect state plus retained update count.

Expected:

- The migrated base and realized state match.
- Retained updates remain ordered.
- Dropped obsolete updates do not show as pending.
- HLC timestamps remain valid, including any suffixed migration timestamps.

## Local-First Mode

Use two browser profiles: Profile A and Profile B.

### Fresh Sync

1. Clear IndexedDB in both profiles.
2. In Profile A, open `Todos` in `local-first` mode.
3. Copy the invite link.
4. Open the invite link in Profile B.
5. Make edits in A and B.
6. Request sync from both profiles if needed.

Expected:

- Both profiles converge.
- Retained batch counts increase.
- Vector counts update.
- No schema warnings appear.

### Retained Batch Migration

1. Seed or create a v1 local-first document with retained batches.
2. Load the current app with a migration config that recognizes the v1 schema.
3. Confirm the “Schema migration available” panel appears.
4. Click “Create migrated document”.
5. Open the target document.

Expected:

- The old source document remains unchanged.
- The target document has current schema metadata.
- Lineage shows source document id and source schema version.
- Retained batch count is preserved except for batches whose updates were fully dropped.
- The vector is recomputed from migrated retained batches.
- The realized state includes renamed/defaulted fields.

### Local-First Schema Mismatch

1. Run two clients with different schema versions/hashes, or modify one client’s schema metadata for testing.
2. Connect them via local-first invite.

Expected:

- The connection row shows a schema mismatch/update-your-app message.
- The local-first network state becomes incompatible.
- The app does not crash.
- Existing local edits remain in the local replica.
- The client does not accept incompatible batches or snapshots.

### Snapshot/Rebase Interaction

1. In Profile A, create local-first edits and compact retained logs.
2. In Profile B, connect from a stale state.
3. Trigger snapshot flow.
4. Test both:
   - discard local and accept snapshot
   - preview local batches on snapshot, then apply preview

Expected:

- Pending snapshot warning appears when B has local knowledge.
- Preview shows local state replayed on the snapshot.
- Applying preview preserves valid local edits.
- Schema metadata remains current after accepting or replaying.

## PeerJS Mode

PeerJS mode should keep rejecting schema mismatches even though it does not perform document migration.

1. Open two browser profiles in PeerJS mode with matching app schema.
2. Connect peers.
3. Edit both sides and verify sync.
4. Repeat with mismatched schema metadata by running one old build or altering schema metadata for one profile.

Expected:

- Matching clients sync normally.
- Mismatched clients reject the connection.
- The visible message tells the user to update their app.
- Local edits on either side remain local and are not discarded.

## Server Mode

Use at least two browser profiles and the Bun server.

### Fresh Server Sync

1. Clear server database and browser server IndexedDB.
2. Start the server.
3. Open Profile A in server mode.
4. Log in as one user.
5. Make several edits.
6. Open Profile B in server mode as another user.
7. Verify branch list, event timeline, presence, and edits sync.

Expected:

- Both clients connect.
- Edits from A appear in B.
- Presence appears and clears when a client closes.
- Server debug page shows active schema version/hash.
- No archived schema hashes are present.

### Server Client Local Migration Before Connect

1. Seed Profile A with an old-schema persisted server replica.
2. Load the current app.

Expected:

- Local persisted branch events migrate before WebSocket connection.
- Pending local update events stay pending after migration.
- Merge events remain structural and materialize correctly.
- If migration fails, WebSocket connection is prevented and old local data remains in IndexedDB.
- Developer console shows detailed migration error information.

### Server Migration Required

1. Start server with an old-schema active document.
2. Open a current-schema client.

Expected:

- The toolbar shows document migration required.
- The user is prompted to migrate.
- If the user declines, local editing remains possible where the local replica exists; server sync does not proceed.
- If the user accepts, the client sends `serverMigrationRequest`.
- Server grants a lock and sends a full dump.
- Client uploads a migrated package.
- Server completes migration and reconnects the client.

### Competing Client During Server Migration

1. Arrange a server document that needs migration.
2. Open Profile A and start migration.
3. Before A uploads/completes, open Profile B.

Expected:

- B shows “migration in progress” as an informational toolbar notice.
- B can continue editing its local copy.
- B’s edits are persisted as unrecorded/pending local events.
- B does not flush writes to the server while the migration lock is active.
- Pending upload count increases after local edits.

### Old Client After Server Migration

1. Complete a server migration with a current client.
2. Open an old-schema client against the migrated server document.

Expected:

- The old client shows an unobtrusive update-your-app notice.
- The message states that local edits stay pending.
- Existing local editing remains possible.
- Network flushes stay paused.
- Local pending events are not discarded.

### Migration Lock Expiry

1. Start a migration with Profile A.
2. Interrupt A before upload:
   - close the tab,
   - kill the dev server client,
   - or pause request handling if debugging.
3. Wait longer than the server lock timeout.
4. Keep Profile B connected or reconnect it.

Expected:

- Server expires the lock.
- Waiting clients receive or observe migration cancelled.
- The cancellation notice is informational.
- Waiting clients reconnect/retry and can either start migration or return to normal sync depending on active server state.
- Pending local edits remain queued.

### Migration Upload Transactionality

1. Start a valid server migration.
2. Before upload, inspect server debug page or database:
   - active schema hash is old hash
   - no new active branch data exists yet
3. Complete upload.
4. Inspect again.

Expected:

- Old active data is archived under the old schema hash.
- Active document schema version/hash is updated.
- Active branches/events are the migrated data.
- Branch tip indexes equal event counts.
- Event indexes are contiguous starting at 1 per branch.
- Old active data is not returned through normal sync.

### Bad Uploads And Recovery

Manually or with a temporary test client, attempt bad uploads:

- wrong source schema hash
- wrong target schema hash
- missing migration ids
- missing migrated timestamp
- non-contiguous event indexes
- branch tip that does not match event count

Expected:

- Server rejects the upload.
- Old active data remains active.
- Migration lock behavior is clear: either still active for the owner or expired/cancelled.
- Clients show concise user-facing failure messages.
- Developer console/server logs include enough detail to diagnose the structural failure.

## Server Debug Page

Open the server debug page while testing server migration.

Expected:

- Active document rows show schema version/hash.
- Archived schema hashes appear only after successful migration.
- Active migration locks show owner and target schema while migration is in progress.
- Expired locks disappear after timeout handling.

## Offline And Reconnect Cases

### Local Edits While Disconnected

1. Open server mode.
2. Disconnect from server with the toolbar button or stop the server.
3. Make edits.
4. Restart/reconnect.

Expected:

- Local edits are accepted.
- Pending upload count increases while offline.
- Pending events upload after reconnect if schema matches and no migration lock blocks writes.

### Local Edits While Server Migration Is Running

1. Open server mode with a local replica.
2. Have another client own a server migration lock.
3. Make local edits.

Expected:

- UI remains editable.
- Pending upload count increases.
- No generic blocking error appears.
- No writes are sent until the migration state clears.

## Failure Mode Matrix

Run at least one manual test for each failure class:

- Missing source schema in migration config.
- Missing migration path.
- Source validation failure.
- Target validation failure.
- Replay mismatch.
- Pending CRDT update that cannot settle before migration.
- Server upload rejected.
- WebSocket disconnect during migration.
- Old client connecting to newer data.
- New client connecting to older server data.

Expected:

- Source data remains available.
- User-facing message is concise and actionable.
- Developer logs include the detailed error.
- No partial migrated data is written as active data.

## Data Inspection Checklist

After each migration, inspect:

- Stored schema version.
- Stored schema fingerprint hash.
- Full schema fingerprint when available.
- Document id and lineage metadata.
- Retained batch count.
- Retained batch timestamp ranges.
- Version vector.
- Branch event indexes.
- Pending/unrecorded event count.
- Realized state shape.
- Absence of old fields that should be dropped.
- Presence of required defaults.

For the todos fixture shape, specifically verify:

- No `text` fields remain in migrated todos.
- Every todo has `title`.
- Every todo has `priority: "normal"` unless intentionally migrated otherwise.
- No `archived` fields remain.
- No `legacyFilter` remains.

## Cross-Version Testing Strategy

The most valuable manual test is a real two-build upgrade.

1. Build or check out a pre-migration version of the app.
2. Create data in each mode:
   - local history
   - local-first with retained batches
   - PeerJS session data where applicable
   - server document with multiple branches/events
3. Switch to the current build.
4. Exercise migration and sync.
5. Optionally switch one browser back to the old build and verify update-your-app behavior.

Expected:

- Current build migrates where configured.
- Old build cannot corrupt migrated server data.
- Old build can keep local edits pending where the mode supports local editing.

## Final Sign-Off Checklist

Before considering migration behavior manually verified:

- Fresh current-schema data works in all modes.
- Legacy data either migrates or fails safely.
- Local non-CRDT history replay works after migration.
- Local-first retained batches are source of truth after migration.
- PeerJS/local-first schema mismatches show update-your-app behavior.
- Server client local replica migration runs before connection.
- Server lock/dump/upload/transaction flow succeeds.
- Competing server clients can edit locally while writes are paused.
- Old server clients see an unobtrusive update-your-app notice and keep local edits pending.
- Server archived data is visible in debug/admin surfaces but not normal sync.
- Migration cancellation and reconnect behavior is understandable.
- Developer logs are detailed enough for validation/replay failures.
