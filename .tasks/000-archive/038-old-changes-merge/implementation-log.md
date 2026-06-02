# Old offline changes merge implementation log

## 2026-05-28

- Started implementation from `plan.md`.
- Phase 1 complete:
  - Added `ServerOldPendingChangesPolicy` and threaded it from registered apps through `App.tsx`, `ServerApp`, `ServerReadyApp`, and `useServerSync`.
  - Opted the default todos server demo into `{kind: 'manual-review', thresholdMs: 300_000}`.
  - Added `merge-review-required` sync state and toolbar labeling.
- Phase 2 complete:
  - Added stale pending detection helpers in `staleReview.ts`.
  - Detection runs after `hello` / `branchSnapshot` branch metadata is merged, and also updates from `branchUpdate`.
  - `flushPending` now skips review-blocked source branches while still allowing unblocked, completed, or forked branches to upload.
- Phase 3 complete:
  - Added persisted stale review metadata on the server replica.
  - Added a review store/API that builds base, client, server, and result histories while filtering pending local events out of server/base histories.
- Phase 4 complete:
  - Added `completeStaleMerge`, `forkStaleLocalChanges`, and `discardStaleLocalChanges`.
  - Complete reindexes preserved pending events after the current server tip, then appends result edits.
  - Fork moves pending events to a new `{source}/sync-review-{timestamp}` branch and allows that branch to upload.
  - Discard removes only unrecorded local events from the reviewed source branch.
- Phase 5 complete:
  - Added `ServerStaleMergeReview` with read-only client/server columns and an editable temporary result column.
  - Review Providers use no-op/capturing transports so result edits are not sent to the real server transport before completion.
  - Normal server branch controls are not rendered during active review, and `switchBranch` is guarded while a review is active.
- Phase 6 complete:
  - Added focused unit coverage for stale review detection and review-blocked flush state.
  - Added two-client Playwright coverage for stale pending review complete, fork, and discard paths.
  - Fixed the review lifecycle so the real synced Provider is not mounted while stale review Providers are active. This avoids stale path listeners when resolving review replaces or switches branch history.
  - Ran `npx vitest run examples/react-crdt/src/lib/server/states.test.ts examples/react-crdt/src/lib/server/staleReview.test.ts`.
  - Ran `npm run typecheck:examples`.
  - Ran `npm run build` in `examples/react-crdt`.
  - Ran `npm run test:e2e -- --grep "reviews old pending"` in `examples/react-crdt`.
  - Ran `npm run test:e2e -- tests/server-migration.spec.ts` in `examples/react-crdt`.
