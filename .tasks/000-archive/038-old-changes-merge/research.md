# Old offline changes merge research

## Goal

For `examples/react-crdt` in `server` mode, old offline work should not be uploaded automatically when the server has moved on. The target behavior is:

- on reconnect,
- if the active branch has pending local events,
- and the oldest pending local event is more than 5 minutes old,
- and the server has events newer than the last server event this client had seen,
- and the app/server-mode config has enabled manual review for old pending changes,
- then pause automatic upload and show a manual merge/review UI.

The review should show current client state, current server state, and editable merge result. The user can then complete the merge, fork the local work into a new branch based on the last seen server state, or discard local edits.

Important caveat: this behavior should be optional. Some applications will prefer the existing CRDT behavior where old pending events are still uploaded and merged automatically. The default should probably preserve today's automatic behavior unless the example/app opts into manual review.

## Current implementation

`useServerSync` stores one local replica per server document. Each branch keeps:

- `lastSeenEventIndex`, the highest server event seen for that branch;
- `events`, including recorded server events and local unrecorded events;
- `history`, the materialized local editor state;
- branch metadata such as `sourceBranchId` and `forkEventIndex`.

Relevant code:

- Local edits become unrecorded `ServerUpdateEvent`s with `receivedAt: new Date().toISOString()` in `transport.publish` (`examples/react-crdt/src/lib/server/useServerSync.ts:729`).
- `flushPending` immediately sends every unrecorded update/merge and every pending branch (`examples/react-crdt/src/lib/server/useServerSync.ts:206`).
- Reconnect currently calls `flushPending` as soon as the socket opens, before processing `hello` / branch metadata (`examples/react-crdt/src/lib/server/useServerSync.ts:509`).
- After `hello`, the client subscribes to the active branch and flushes again (`examples/react-crdt/src/lib/server/useServerSync.ts:535`).
- Server events are appended to the same branch and applied to the live editor unless authored by the same actor (`examples/react-crdt/src/lib/server/useServerSync.ts:392`).
- Pending upload count is just `branch.events.filter((event) => !event.recorded).length` (`examples/react-crdt/src/lib/server/useServerSync.ts:1099`).
- Branch creation already supports forking from a specific source event index (`examples/react-crdt/src/lib/server/useServerSync.ts:829`, `examples/react-crdt-server/src/store.ts:515`).

The server branch list includes `tipEventIndex` (`examples/react-crdt/src/lib/server/types.ts:38`), so the client can detect "server has had new changes" from branch metadata before downloading all events:

```ts
remoteTipEventIndex > localBranch.lastSeenEventIndex
```

## Important constraint

The current active-branch event log cannot safely mix stale local pending events and newly fetched server events as if they were already one linear server branch. Pending local events use provisional `eventIndex` values from `nextLocalEventIndex` (`examples/react-crdt/src/lib/server/useServerSync.ts:1189`). If the server has independently appended events while this client was offline, those server events can use the same event indexes.

That means the manual-review implementation should not just "receive server events, keep pending local events, and pause upload" in the same branch. It needs an explicit separation between:

- the last server base this client had seen,
- the current local pending branch,
- the current server branch tip,
- and the user's eventual merge result.

## Recommended model

Treat stale offline work as a branch-review operation. Reviews should be processed one blocked branch at a time. If multiple branches have old pending events and the server has moved on for those branches, the UI should address the next blocked branch only after the current one is completed, forked, or discarded.

When the trigger is detected for the active branch:

1. Pause pending uploads with a new sync state, e.g. `kind: 'merge-review-required'`.
2. Capture `baseEventIndex = branch.lastSeenEventIndex`.
3. Move/copy local pending events into a local pending review branch forked from the active server branch at `baseEventIndex`.
4. Reset or rematerialize the active branch to the server state through the latest downloaded server events.
5. Show a review UI using:
   - `base`: active branch through `baseEventIndex`,
   - `client`: base plus the pending local review branch,
   - `server`: active branch through current server tip,
   - `result`: an editable CRDT history initialized from normal CRDT merge of server plus pending local changes.

This matches the existing branch/merge architecture better than adding a second pending-event queue. It also makes "create a new branch forked off of the last server state I had seen" almost identical to keeping the pending review branch as a real branch.

While a branch is under manual review, branch switching should be disabled in all merge-review panes and controls. The review is scoped to a single blocked branch, and allowing the user to switch branches inside one of the Providers would make it ambiguous which branch the editable result should complete, fork, or discard.

## Trigger detection

Add helpers around the active branch:

- `shouldReviewOldPendingChanges(config)`: returns true only when the app has opted into this behavior.
- `pendingEventsForBranch(branch)`: unrecorded update/merge events, likely only local events authored by this actor for the trigger.
- `oldestPendingReceivedAt(branch)`: minimum `receivedAt` from unrecorded updates; merge events use `createdAt`.
- `hasOldPending(branch, now, thresholdMs = 300_000)`.
- `serverMoved(branch, serverBranchMeta)`: `serverBranchMeta.tipEventIndex > branch.lastSeenEventIndex`.

Detection should happen after `hello` / `branchSnapshot` merges branch metadata and before any call to `flushPending`. The socket `open` handler should stop flushing immediately for configurations that might require review; otherwise it can upload stale local events before knowing the server tip. For configs where review is disabled, flushing can continue through the current automatic path after branch metadata is known.

`canFlushPendingServerWrites` should return false for the new review state, just as it does for migration-paused states.

## Configuration

Add a server sync option rather than making this behavior global. Possible shape:

```ts
type ServerOldPendingChangesPolicy =
    | {kind: 'auto-merge'}
    | {kind: 'manual-review'; thresholdMs?: number};
```

This can live in the server-mode config passed from `ServerApp` / `useServerSync`, possibly alongside the existing `schemaConfig`. A simpler first cut could be:

```ts
oldPendingChangesReview?: {
    enabled: boolean;
    thresholdMs?: number;
};
```

Recommended default: disabled / `auto-merge`, to avoid changing behavior for apps that rely on automatic CRDT convergence. The examples can then opt specific apps or modes into manual review.

## Review state shape

Add to `ServerSyncState`:

```ts
{
  kind: 'merge-review-required';
  message: string;
  branchId: string;
  baseEventIndex: number;
  serverTipEventIndex: number;
  pendingEventCount: number;
  oldestPendingAt: string;
  blockedBranchCount: number;
}
```

`ServerSync<TState>` likely needs methods such as:

```ts
buildStaleMergeReview(): ServerStaleMergeReview<TState> | null;
completeStaleMerge(result: CrdtLocalHistory<TState>): void;
forkStaleLocalChanges(name?: string): void;
discardStaleLocalChanges(): void;
cancelStaleMergeReview?(): void;
```

The review object should expose histories or documents for:

- base/last-seen server state;
- current local client state;
- current server state;
- editable merge result.

## UI fit

`ServerHistoryView` already has a merge preview panel with path-level apply/revert controls and a resulting-state preview (`examples/react-crdt/src/lib/server/ServerHistoryView.tsx:217`). That is useful precedent, but the requested UI is different:

- It needs three visible columns, not just a changed-path list plus JSON result.
- The result must be editable through the app's normal editor UI, not only path toggles.
- The "complete merge" action should queue ordinary pending updates representing the user's result.
- Branch switching must be forbidden during review, because blocked branches are handled sequentially and each review action applies to the currently reviewed branch.

The least invasive UI is probably a new `ServerStaleMergeReview` component rendered in `ServerDocumentWorkspace` when the sync state is `merge-review-required`. It can show:

- left column: read-only app panel for client/pending branch state,
- middle column: read-only app panel for current server branch state,
- right column: normal app panel backed by a temporary editable `CrdtLocalHistory`.

The existing app render API already accepts `readOnly`, so the main missing piece is mounting multiple CRDT providers/histories at once or adding a lightweight read-only rendering path for a supplied history.

The result column should use an isolated temporary Provider/transport. It should not expose server branch switching, and it should not call the real `sync.switchBranch`. The ordinary `ServerHistoryView` branch controls should be hidden or disabled while any branch is in `merge-review-required`.

## Completing the merge

The cleanest completion semantics are:

1. Compute CRDT restore/set updates that transform the current server document into the edited result document.
2. Queue those updates as local unrecorded events on the active server branch.
3. Mark the stale review resolved and allow `flushPending`.

There is already precedent for "restore selected paths by emitting normal CRDT updates": merge preview builds revert updates from previous metadata (`examples/react-crdt/src/lib/server/materialize.ts:105`). This may need a more general document diff helper that compares two CRDT documents and emits updates for all changed paths.

Open implementation issue: if the edited result is produced by normal app commands, those commands may already generate CRDT updates. It may be simpler to initialize the result editor from the merged result and let every edit queue updates into a separate temporary history/log, then append those updates to the active branch on completion. That avoids needing a whole-document diff, but it requires a temporary transport/store for the result column.

## Forking local changes

The requested "create a new branch forked off of the last server state I had seen" maps directly to:

- `sourceBranchId = active branch id`;
- `forkEventIndex = baseEventIndex`;
- events = the pending local events that were made offline;
- active branch returns to current server state.

The existing `createBranch(name, forkEventIndex)` creates an empty branch from the current active branch. For this feature it needs a variant that can move/copy pending events into the new branch and remove them from the original active branch.

Recommended behavior: move the pending events into the new branch, switch to that branch, and let it upload as a normal server branch. That preserves the user's work while not merging it into the server branch. If "handle the merge later" means do not upload even the branch yet, keep the branch metadata/events local and do not call `flushPending` until the user reconnects or confirms; this is an open product question.

After the fork is created and unblocked, the sync layer should continue to the next blocked branch, if any. It should not leave the review UI in a state where the user can manually switch to an unrelated branch before the queued branch reviews are resolved.

## Discarding local edits

Discard should remove unrecorded local events from the active branch, rematerialize it from recorded server events plus newly fetched server events, reset undo history with `createCrdtLocalHistory`, persist, and allow normal sync.

This must be scoped carefully:

- discard only local pending events for the branch under review;
- do not delete recorded events;
- decide whether pending local branch creation/merge events are included if the user created branches while offline.

## Tests to add

- Config tests:
  - review disabled -> old pending events still flush automatically;
  - review enabled -> old pending plus server tip advance pauses upload;
  - custom threshold changes the age cutoff.
- Unit tests for stale-pending detection:
  - no pending events -> no review;
  - pending younger than 5 minutes -> flush allowed;
  - old pending but server tip unchanged -> flush allowed;
  - old pending and server tip advanced -> review state.
- `canFlushPendingServerWrites` returns false for `merge-review-required`.
- Sequential branch-review tests:
  - multiple blocked branches produce one active review at a time;
  - completing/forking/discarding one branch advances to the next blocked branch;
  - branch switching is disabled while review is active.
- A hook/state test, or Playwright test, for reconnect ordering: stale pending events are not sent before `hello` branch metadata is evaluated.
- Materialization test for moving pending events to a fork branch at `baseEventIndex`.
- Discard test: unrecorded events are removed and active history equals current server state.
- End-to-end server-mode test with two clients:
  - client A goes offline and edits;
  - client B edits and syncs;
  - client A reconnects after an old pending timestamp;
  - client A sees review UI and server receives no automatic `clientUpdate`;
  - complete/fork/discard each do the expected thing.

## Open questions

- Should the 5-minute threshold use wall-clock `receivedAt`, HLC timestamp physical time, or elapsed offline duration? `receivedAt` is easiest because local events already store it.
  - receivedAt is fine
- Should manual review be configured per app, per document, per server-mode runtime, or per user/session?
  - configured per app
- Should the default be strict backward compatibility (`auto-merge`) or should the demo app opt in by default to showcase the feature?
  - demo should opt in, but default should be auto-merge
- Does "pending changes" include pending merge events and pending branch creation, or only update events authored by the active actor?
  - each branch with old pending events (where the server has new changes on that branch) should be blocked from syncing until handled manually.
- When old pending changes exist on multiple branches, should review block all flushing or only the active branch?
  - sync block & manual review should be applied on a per-branch basis
- Should the review trigger only on reconnect after being offline, or also after app reload if the server has moved on?
  - also app reload / initial connection
- Should "complete merge" preserve local pending edits as original events plus additional edits, or should it upload only the final reviewed result as new updates authored at completion time?
  - preserve local pending edits, to preserve expected CRDT merge behavior
- How should the editable result be represented for arbitrary apps: multiple nested `Provider`s, a temporary transport, or a new app render path that accepts an explicit history?
  - I'm not sure what you mean, could you elaborate?
  - clarified: use isolated Providers/temporary transport for the three panes, and forbid branch switching during review because branches are handled sequentially.
- When the user chooses "fork", should the new branch be uploaded immediately, or remain local-only until they explicitly sync/merge later?
  - it should no longer be blocked from syncing (so sync immediately)
- What branch name should be used for automatic fork creation?
  - `{source_branch}/sync-review-{timestamp}`
- If server schema migration is also required, which pause state wins: migration required or stale merge review?
  - migration required wins
- Should the server protocol expose an explicit "branch tip since" response, or is `hello` / `branchSnapshot` branch metadata enough?
  - hello has branch info so it should be enough, right?

## Suggested implementation sequence

1. Add config plumbing with default `auto-merge`.
2. Add detection helpers and `merge-review-required` state; remove or gate the socket-open `flushPending` call so review-enabled configs flush only after branch metadata is known.
3. Add tests for config behavior, detection, and flush gating.
4. Add branch-log operations to split pending active-branch events into a local review/fork branch and to discard them.
5. Add a minimal review UI that initially shows JSON/current app state for the three columns.
6. Add editable result transport and complete/fork/discard actions.
7. Replace JSON-only review panes with app-rendered read-only/editable panes if the provider structure allows it cleanly.
