import {materializeBranch, sortedEvents, type BranchAdapter, type BranchEvent, type PersistedBranch} from './index.js';

export const DEFAULT_OLD_PENDING_REVIEW_THRESHOLD_MS = 5 * 60 * 1000;

export type BranchSummary = {
    branchId: string;
    tipEventIndex: number;
};

export type OldPendingChangesPolicy =
    | {kind: 'auto-merge'}
    | {kind: 'manual-review'; thresholdMs?: number};

export type StaleMergeReviewMetadata = {
    sourceBranchId: string;
    baseEventIndex: number;
    serverTipEventIndex: number;
    pendingEventCount: number;
    oldestPendingAt: string;
};

export type StaleMergeReview<THistory, TUpdate> = StaleMergeReviewMetadata & {
    pendingEvents: BranchEvent<TUpdate>[];
    baseHistory: THistory;
    clientHistory: THistory;
    serverHistory: THistory;
    resultHistory: THistory;
};

export function thresholdMsForPolicy(policy: OldPendingChangesPolicy) {
    return policy.kind === 'manual-review'
        ? (policy.thresholdMs ?? DEFAULT_OLD_PENDING_REVIEW_THRESHOLD_MS)
        : undefined;
}

export function pendingEventsForBranch<THistory, TUpdate>(
    branch: PersistedBranch<THistory, TUpdate>,
): BranchEvent<TUpdate>[] {
    return branch.events.filter((event) => !event.recorded);
}

export function oldestPendingAt<THistory, TUpdate>(
    branch: PersistedBranch<THistory, TUpdate>,
): string | undefined {
    return pendingEventsForBranch(branch)
        .map(eventTime)
        .filter((value): value is string => Boolean(value))
        .sort()[0];
}

export function hasOldPending<THistory, TUpdate>(
    branch: PersistedBranch<THistory, TUpdate>,
    now: number,
    thresholdMs: number,
) {
    const oldest = oldestPendingAt(branch);
    if (!oldest) return false;
    const oldestMs = Date.parse(oldest);
    return Number.isFinite(oldestMs) && now - oldestMs >= thresholdMs;
}

export function serverMoved<THistory, TUpdate>(
    branch: PersistedBranch<THistory, TUpdate>,
    branchMeta: BranchSummary | undefined,
) {
    return Boolean(branchMeta && branchMeta.tipEventIndex > branch.lastSeenEventIndex);
}

export function blockedBranchesForReview<THistory, TUpdate>({
    branches,
    branchList,
    policy,
    now = Date.now(),
}: {
    branches: Record<string, PersistedBranch<THistory, TUpdate>>;
    branchList: BranchSummary[];
    policy: OldPendingChangesPolicy;
    now?: number;
}): StaleMergeReviewMetadata[] {
    const thresholdMs = thresholdMsForPolicy(policy);
    if (thresholdMs === undefined) return [];
    return Object.values(branches)
        .map((branch) => {
            const branchMeta = branchList.find(
                (candidate) => candidate.branchId === branch.branchId,
            );
            const pendingEvents = pendingEventsForBranch(branch);
            const oldestPendingAt = pendingEvents
                .map(eventTime)
                .filter((value): value is string => Boolean(value))
                .sort()[0];
            if (!oldestPendingAt) return null;
            if (!hasOldPending(branch, now, thresholdMs)) return null;
            if (!serverMoved(branch, branchMeta)) return null;
            return {
                sourceBranchId: branch.branchId,
                baseEventIndex: branch.lastSeenEventIndex,
                serverTipEventIndex: branchMeta?.tipEventIndex ?? branch.lastSeenEventIndex,
                pendingEventCount: pendingEvents.length,
                oldestPendingAt,
            } satisfies StaleMergeReviewMetadata;
        })
        .filter((metadata): metadata is StaleMergeReviewMetadata => metadata !== null);
}

export function buildStaleMergeReview<THistory, TUpdate>({
    adapter,
    branches,
    metadata,
}: {
    adapter: BranchAdapter<THistory, TUpdate>;
    branches: Record<string, PersistedBranch<THistory, TUpdate>>;
    metadata: StaleMergeReviewMetadata;
}): StaleMergeReview<THistory, TUpdate> | null {
    const source = branches[metadata.sourceBranchId];
    if (!source) return null;
    const pendingEvents = pendingEventsForBranch(source);
    const serverBranches = withOnlyRecordedEvents(branches, metadata.sourceBranchId);
    const baseHistory = materializeBranch({
        adapter,
        branches: serverBranches,
        branchId: metadata.sourceBranchId,
        throughEventIndex: metadata.baseEventIndex,
    });
    const serverHistory = materializeBranch({
        adapter,
        branches: serverBranches,
        branchId: metadata.sourceBranchId,
        throughEventIndex: metadata.serverTipEventIndex,
    });
    const clientHistory = applyPendingEvents(adapter, baseHistory, pendingEvents);
    const resultHistory = applyPendingEvents(adapter, serverHistory, pendingEvents);
    return {
        ...metadata,
        pendingEvents,
        baseHistory,
        clientHistory,
        serverHistory,
        resultHistory,
    };
}

export function withOnlyRecordedEvents<THistory, TUpdate>(
    branches: Record<string, PersistedBranch<THistory, TUpdate>>,
    branchId: string,
): Record<string, PersistedBranch<THistory, TUpdate>> {
    const branch = branches[branchId];
    if (!branch) return branches;
    return {
        ...branches,
        [branchId]: {
            ...branch,
            events: branch.events.filter((event) => event.recorded),
        },
    };
}

export function applyPendingEvents<THistory, TUpdate>(
    adapter: BranchAdapter<THistory, TUpdate>,
    initial: THistory,
    events: BranchEvent<TUpdate>[],
) {
    let history = initial;
    for (const event of sortedEvents(events)) {
        if (event.kind !== 'update') continue;
        history = adapter.applyUpdate(history, event.update, {recordHistory: true});
    }
    return history;
}

export function acceptStaleLocalChanges<THistory, TUpdate>({
    branch,
    metadata,
}: {
    branch: PersistedBranch<THistory, TUpdate>;
    metadata: StaleMergeReviewMetadata;
}): PersistedBranch<THistory, TUpdate> {
    const recorded = branch.events.filter((event) => event.recorded);
    const pending = reindexEvents(
        pendingEventsForBranch(branch),
        metadata.sourceBranchId,
        metadata.serverTipEventIndex,
    );
    return {
        ...branch,
        events: sortedEvents([...recorded, ...pending]),
    };
}

export function discardStaleLocalChanges<THistory, TUpdate>(
    branch: PersistedBranch<THistory, TUpdate>,
): PersistedBranch<THistory, TUpdate> {
    return {
        ...branch,
        events: sortedEvents(branch.events.filter((event) => event.recorded)),
        undoCheckpointEventIndex: branch.lastSeenEventIndex,
    };
}

export function forkStaleLocalChanges<THistory, TUpdate>({
    source,
    forkBranchId,
    baseEventIndex,
}: {
    source: PersistedBranch<THistory, TUpdate>;
    forkBranchId: string;
    baseEventIndex: number;
}): {
    source: PersistedBranch<THistory, TUpdate>;
    fork: PersistedBranch<THistory, TUpdate>;
} {
    const pending = pendingEventsForBranch(source);
    return {
        source: discardStaleLocalChanges(source),
        fork: {
            ...source,
            branchId: forkBranchId,
            sourceBranchId: source.branchId,
            forkEventIndex: baseEventIndex,
            lastSeenEventIndex: 0,
            undoCheckpointEventIndex: 0,
            events: reindexEvents(pending, forkBranchId, 0),
        },
    };
}

function reindexEvents<TUpdate>(
    events: BranchEvent<TUpdate>[],
    branchId: string,
    afterEventIndex: number,
): BranchEvent<TUpdate>[] {
    return sortedEvents(
        events.map((event, index) => ({
            ...event,
            branchId,
            eventIndex: afterEventIndex + index + 1,
            recorded: false,
        })),
    );
}

function eventTime<TUpdate>(event: BranchEvent<TUpdate>) {
    return event.kind === 'update' ? event.receivedAt : event.createdAt;
}
