# Old offline changes merge plan

## Decisions from research

- Manual review for old pending server-mode changes is optional and configured per app.
- Default behavior remains automatic CRDT upload/merge.
- The demo app should opt into manual review.
- The threshold uses local event `receivedAt`; default threshold is 5 minutes.
- Review is triggered on reconnect and initial app load.
- Schema migration pauses win over stale-change review.
- Branch metadata from `hello` / `branchSnapshot` is enough to detect server movement.
- Review is per branch, and blocked branches are handled sequentially.
- Review blocking is branch-level, not a global "no writes" switch. Completed branches, forked review branches, and unrelated unblocked branches must be allowed to flush while other source branches remain queued for review.
- Branch switching is disabled while any branch is under review.
- Completing a review preserves the original local pending events and adds any user merge-result edits after them.
- Forking creates `{source_branch}/sync-review-{timestamp}` and the new branch is allowed to sync immediately.

## Phase 1: Configuration and sync-state plumbing

Add an app-level server sync option near the registered app / `ServerApp` / `useServerSync` config path:

```ts
type ServerOldPendingChangesPolicy =
    | {kind: 'auto-merge'}
    | {kind: 'manual-review'; thresholdMs?: number};
```

Tasks:

1. Add the config type and default to `{kind: 'auto-merge'}`.
2. Add the option to the registered app config, thread it through `App.tsx`, `ServerApp`, `ServerReadyApp`, and into `useServerSync`.
3. Opt the demo server-mode app into `{kind: 'manual-review', thresholdMs: 300_000}`.
4. Add `merge-review-required` to `ServerSyncState`.
5. Keep global sync state separate from branch-level review blocking. `canFlushPendingServerWrites` should reject `merge-review-required`, but `flushPending` must also have branch-level skip/allow rules so a review state does not prevent explicitly unblocked branches from uploading.
6. Update toolbar notice labeling/tone for review-blocked state.
7. Decide whether `canFlushPendingServerWrites` should continue allowing `connecting` / `offline` as today, or narrow it to connected-only and update tests accordingly.

Tests:

- default config still permits automatic upload;
- manual-review config can produce a paused state;
- `canFlushPendingServerWrites` blocks review state.
- branch-level flush filtering skips only review-blocked source branches and still allows completed, forked, and unrelated unblocked branches to flush.

## Phase 2: Detection before upload

Move stale-pending detection into the reconnect/initial-subscribe path before pending events can flush.

Note: the current implementation already removed the older socket `open` handler's eager `flushPending`. The dangerous flush point is now the post-`hello` / post-`branchSnapshot` path after branch metadata is merged.

Tasks:

1. Add helpers:
   - `pendingEventsForBranch(branch)`;
   - `oldestPendingAt(branch)`;
   - `hasOldPending(branch, now, thresholdMs)`;
   - `serverMoved(branch, branchMeta)`;
   - `blockedBranchesForReview(...)`.
2. Gate the post-`hello` / post-`branchSnapshot` `flushPending`; review-enabled configs should evaluate branch metadata first.
3. After `hello` / `branchSnapshot` merges branch metadata, compute blocked branches.
4. Recompute or update blocked branches when `branchUpdate` / later `branchSnapshot` messages advance server branch metadata while a client is connected.
5. Use a precise server-movement rule: a branch with old unrecorded local events requires review when the server branch `tipEventIndex` is greater than the persisted branch `lastSeenEventIndex`.
6. If migration state is required, keep migration state and do not enter merge review.
7. If no blocked branches, flush as today.
8. If blocked branches exist, enter review for the first blocked branch and leave other blocked branches queued. Unblocked branches should still be eligible for branch-level flush.

Tests:

- old pending + unchanged server tip flushes normally;
- young pending + advanced server tip flushes normally;
- old pending + advanced server tip enters review;
- initial app load can enter review;
- reconnect does not upload stale pending events before branch metadata is evaluated.
- `branchUpdate` / `branchSnapshot` received during an active review can add newly advanced branches to the review queue without flushing their stale pending events.
- unblocked branches can flush while a different branch is waiting for or undergoing review.

## Phase 3: Branch review data model

Represent each blocked branch without mixing local provisional events into the server branch event line.

Tasks:

1. Add an internal review queue/ref for blocked branch ids and review metadata:
   - source branch id;
   - base event index;
   - server tip event index;
   - pending events;
   - oldest pending timestamp.
2. Persist enough review state in `PersistedServerReplica` that reload during a review returns to the same blocked branch. This likely requires a `storageVersion` / IndexedDB version bump or a backward-compatible optional field.
3. Track branch-level review status separately from the global sync state:
   - blocked source branch ids;
   - the active review branch id;
   - branches explicitly allowed to flush after complete/fork;
   - queued blocked branches still waiting for review.
4. For the active review, build histories for:
   - base/last-seen server state;
   - client state: base plus pending local events;
   - server state: current server branch through server tip;
   - initial result: server state plus original local pending events.
5. Ensure `receiveServerEvents` can materialize current server state without applying review-blocked local pending events into the same branch timeline.
6. Ensure server/base histories explicitly exclude unrecorded local pending events from the reviewed source branch.
7. Add methods to `ServerSync<TState>`:
   - `buildStaleMergeReview()`;
   - `completeStaleMerge(...)`;
   - `forkStaleLocalChanges(...)`;
   - `discardStaleLocalChanges()`;
   - possibly `hasBranchReviewLock()` or expose state enough for UI lockout.

Tests:

- multiple blocked branches produce exactly one active review at a time;
- histories are built from the correct base/server/client/result inputs;
- reload during review does not accidentally flush blocked events.
- persisted review state restores the active blocked branch and queue after reload.
- server/base histories do not include unrecorded local pending events.

## Phase 4: Branch operations

Implement the three outcomes for the active blocked branch.

Complete merge:

1. Preserve original local pending events.
2. Append temporary merge-result edits after the preserved pending events.
3. Mark the branch review resolved.
4. Mark that branch as unblocked/allowed and allow it to flush even if other branches remain queued for review.
5. Advance to the next blocked branch if present.

Fork:

1. Create a new branch from the source branch at `baseEventIndex`.
2. Name it `{source_branch}/sync-review-{timestamp}` unless the UI supplies a name.
3. Move pending local events to the new branch.
4. Remove those pending events from the original branch.
5. Mark the new branch unblocked so it can sync immediately.
6. Advance to the next blocked branch if present.
7. Keep the original source branch blocked/resolved according to the chosen fork semantics; do not let the removed pending events flush on the original source branch.

Discard:

1. Remove only the reviewed branch's unrecorded local events.
2. Keep recorded server events.
3. Rematerialize the source branch to current server state.
4. Reset local undo history for that branch.
5. Advance to the next blocked branch if present.

Tests:

- complete preserves original pending events and appends extra result edits;
- fork creates the expected branch and allows immediate branch upload;
- discard removes only local pending events;
- each action advances to the next queued branch;
- when the queue is empty, normal flushing resumes.
- complete/fork can upload their resolved branch while another branch remains queued for review.

## Phase 5: Temporary review Providers

Build isolated UI state for the three-way review without writing to the real synced branch until completion.

Tasks:

1. Add `ServerStaleMergeReview` rendered from `ServerDocumentWorkspace` when state is `merge-review-required`.
2. Hide or disable `ServerHistoryView` branch controls while review is active.
3. Render client and server columns as read-only app panels with no-op transports.
4. Render merge-result column with a temporary Provider and temporary transport.
5. Record temporary result edits in memory/local review state.
6. Prevent any review Provider from calling `sync.switchBranch`.
7. Add complete/fork/discard controls.
8. Do not mount or allow editing of the real synced branch editor while the active branch is under review.
9. Use no-op presence and ephemeral transports for all review Providers so selections, cursors, and whiteboard ephemeral events are not published to the real branch.

Notes:

- The result column should initialize from server state plus the original pending local events.
- Result edits should be queued only into the temporary transport until complete.
- Read-only columns should use app `readOnly` behavior and no-op transports.
- The real `Provider` / real transport should not receive review edits or review presence events.

Tests:

- branch switch controls are disabled/hidden during review;
- editing result does not upload or mutate the real synced branch before completion;
- complete uploads after the user confirms;
- fork and discard are reachable and update state correctly.
- review panels do not publish presence or ephemeral messages to the real branch.

## Phase 6: Polish and end-to-end coverage

Make the feature understandable and verify with browser-level behavior.

Tasks:

1. Add clear toolbar/review messages with branch name, pending count, oldest pending age, and blocked branch count.
2. Add responsive three-column styling; stack columns on narrow screens.
3. Ensure focus and keyboard behavior works for complete/fork/discard.
4. Add Playwright coverage with two clients:
   - client A syncs, goes offline, edits;
   - client B edits and syncs;
   - client A reloads/reconnects after old pending timestamp;
   - client A enters review and sends no stale `clientUpdate`;
   - complete path syncs expected result;
   - fork path creates immediately syncing review branch;
   - discard path removes local edits and accepts server state.
5. Run existing server-mode tests and app tests.

## Implementation risks

- Event index collisions are the main correctness risk. Do not let review-blocked local provisional events share the active server branch timeline with newly received server events.
- The temporary merge-result editor must not publish to the real transport before completion.
- Branch lockout must cover all branch switching entry points, not just visible buttons.
- Complete semantics preserve pending events, so extra result edits must be appended after them rather than replacing them.
- Migration-required state must short-circuit review detection.
- A global `merge-review-required` state must not accidentally block upload of completed or forked review branches. Keep branch-level blocked/allowed state as the source of truth for `flushPending`.
- Server metadata can move while a review is active. `branchUpdate` and `branchSnapshot` must update the queue without releasing stale pending events.

## Suggested commit order

1. Config/state/detection helpers with unit tests.
2. Branch-level flush filtering and post-`hello` / post-`branchSnapshot` detection gating with tests.
3. Persisted review queue and branch operation helpers with unit tests.
4. Minimal JSON review UI and action wiring.
5. Temporary Provider-based app-rendered review UI.
6. Styling, Playwright tests, and cleanup.
