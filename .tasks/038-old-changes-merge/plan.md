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
- Branch switching is disabled while any branch is under review.
- Completing a review preserves the original local pending events and adds any user merge-result edits after them.
- Forking creates `{source_branch}/sync-review-{timestamp}` and the new branch is allowed to sync immediately.

## Phase 1: Configuration and sync-state plumbing

Add an app-level server sync option, probably near the existing `ServerApp` / `useServerSync` config path:

```ts
type ServerOldPendingChangesPolicy =
    | {kind: 'auto-merge'}
    | {kind: 'manual-review'; thresholdMs?: number};
```

Tasks:

1. Add the config type and default to `{kind: 'auto-merge'}`.
2. Thread the option from `ServerApp` into `useServerSync`.
3. Opt the demo server-mode app into `{kind: 'manual-review', thresholdMs: 300_000}`.
4. Add `merge-review-required` to `ServerSyncState`.
5. Update `canFlushPendingServerWrites` to return false for review-blocked state.
6. Update toolbar notice labeling/tone for review-blocked state.

Tests:

- default config still permits automatic upload;
- manual-review config can produce a paused state;
- `canFlushPendingServerWrites` blocks review state.

## Phase 2: Detection before upload

Move stale-pending detection into the reconnect/initial-subscribe path before pending events can flush.

Tasks:

1. Add helpers:
   - `pendingEventsForBranch(branch)`;
   - `oldestPendingAt(branch)`;
   - `hasOldPending(branch, now, thresholdMs)`;
   - `serverMoved(branch, branchMeta)`;
   - `blockedBranchesForReview(...)`.
2. Gate or remove the socket `open` handler's immediate `flushPending`; review-enabled configs should wait until branch metadata arrives.
3. After `hello` / `branchSnapshot` merges branch metadata, compute blocked branches.
4. If migration state is required, keep migration state and do not enter merge review.
5. If no blocked branches, flush as today.
6. If blocked branches exist, enter review for the first blocked branch and leave other branches queued.

Tests:

- old pending + unchanged server tip flushes normally;
- young pending + advanced server tip flushes normally;
- old pending + advanced server tip enters review;
- initial app load can enter review;
- reconnect does not upload stale pending events before branch metadata is evaluated.

## Phase 3: Branch review data model

Represent each blocked branch without mixing local provisional events into the server branch event line.

Tasks:

1. Add an internal review queue/ref for blocked branch ids and review metadata:
   - source branch id;
   - base event index;
   - server tip event index;
   - pending events;
   - oldest pending timestamp.
2. For the active review, build histories for:
   - base/last-seen server state;
   - client state: base plus pending local events;
   - server state: current server branch through server tip;
   - initial result: server state plus original local pending events.
3. Ensure `receiveServerEvents` can materialize current server state without applying review-blocked local pending events into the same branch timeline.
4. Add methods to `ServerSync<TState>`:
   - `buildStaleMergeReview()`;
   - `completeStaleMerge(...)`;
   - `forkStaleLocalChanges(...)`;
   - `discardStaleLocalChanges()`;
   - possibly `hasBranchReviewLock()` or expose state enough for UI lockout.
5. Persist enough review state that reload during a review returns to the same blocked branch.

Tests:

- multiple blocked branches produce exactly one active review at a time;
- histories are built from the correct base/server/client/result inputs;
- reload during review does not accidentally flush blocked events.

## Phase 4: Branch operations

Implement the three outcomes for the active blocked branch.

Complete merge:

1. Preserve original local pending events.
2. Append temporary merge-result edits after the preserved pending events.
3. Mark the branch review resolved.
4. Allow that branch to flush.
5. Advance to the next blocked branch if present.

Fork:

1. Create a new branch from the source branch at `baseEventIndex`.
2. Name it `{source_branch}/sync-review-{timestamp}` unless the UI supplies a name.
3. Move pending local events to the new branch.
4. Remove those pending events from the original branch.
5. Mark the new branch unblocked so it can sync immediately.
6. Advance to the next blocked branch if present.

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

Notes:

- The result column should initialize from server state plus the original pending local events.
- Result edits should be queued only into the temporary transport until complete.
- Read-only columns should use app `readOnly` behavior and no-op transports.

Tests:

- branch switch controls are disabled/hidden during review;
- editing result does not upload or mutate the real synced branch before completion;
- complete uploads after the user confirms;
- fork and discard are reachable and update state correctly.

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

## Suggested commit order

1. Config/state/detection helpers with unit tests.
2. Reconnect flush gating with tests.
3. Review queue and branch operation helpers with unit tests.
4. Minimal JSON review UI and action wiring.
5. Temporary Provider-based app-rendered review UI.
6. Styling, Playwright tests, and cleanup.
