import {applyRemoteHistoryUpdate, type CrdtLocalHistory, type CrdtUpdate} from 'umkehr/crdt';
import type {AppDefinition} from '../crdtApp';
import {materializeServerBranch} from './materialize';
import {sortServerEvents} from './persistence';
import type {
    PersistedServerBranch,
    ServerBranch,
    ServerBranchEvent,
    ServerOldPendingChangesPolicy,
    ServerStaleMergeReview,
    ServerStaleMergeReviewMetadata,
    ServerUpdateEvent,
} from './types';

export const DEFAULT_OLD_PENDING_REVIEW_THRESHOLD_MS = 5 * 60 * 1000;

export function thresholdMsForPolicy(policy: ServerOldPendingChangesPolicy) {
    return policy.kind === 'manual-review'
        ? (policy.thresholdMs ?? DEFAULT_OLD_PENDING_REVIEW_THRESHOLD_MS)
        : undefined;
}

export function pendingEventsForBranch<TState>(
    branch: PersistedServerBranch<TState>,
): ServerBranchEvent[] {
    return branch.events.filter((event) => !event.recorded);
}

export function oldestPendingAt<TState>(branch: PersistedServerBranch<TState>): string | undefined {
    return pendingEventsForBranch(branch)
        .map(eventTime)
        .filter((value): value is string => Boolean(value))
        .sort()[0];
}

export function hasOldPending<TState>(
    branch: PersistedServerBranch<TState>,
    now: number,
    thresholdMs: number,
) {
    const oldest = oldestPendingAt(branch);
    if (!oldest) return false;
    const oldestMs = Date.parse(oldest);
    return Number.isFinite(oldestMs) && now - oldestMs >= thresholdMs;
}

export function serverMoved<TState>(
    branch: PersistedServerBranch<TState>,
    branchMeta: ServerBranch | undefined,
) {
    return Boolean(branchMeta && branchMeta.tipEventIndex > branch.lastSeenEventIndex);
}

export function blockedBranchesForReview<TState>({
    branches,
    branchList,
    policy,
    now = Date.now(),
}: {
    branches: Record<string, PersistedServerBranch<TState>>;
    branchList: ServerBranch[];
    policy: ServerOldPendingChangesPolicy;
    now?: number;
}): ServerStaleMergeReviewMetadata[] {
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
            } satisfies ServerStaleMergeReviewMetadata;
        })
        .filter((metadata): metadata is ServerStaleMergeReviewMetadata => metadata !== null);
}

export function buildStaleMergeReview<TState>({
    app,
    branches,
    metadata,
}: {
    app: AppDefinition<TState>;
    branches: Record<string, PersistedServerBranch<TState>>;
    metadata: ServerStaleMergeReviewMetadata;
}): ServerStaleMergeReview<TState> | null {
    const source = branches[metadata.sourceBranchId];
    if (!source) return null;
    const pendingEvents = pendingEventsForBranch(source);
    const serverBranches = withOnlyRecordedEvents(branches, metadata.sourceBranchId);
    const baseHistory = materializeServerBranch({
        app,
        branches: serverBranches,
        branchId: metadata.sourceBranchId,
        throughEventIndex: metadata.baseEventIndex,
    });
    const serverHistory = materializeServerBranch({
        app,
        branches: serverBranches,
        branchId: metadata.sourceBranchId,
        throughEventIndex: metadata.serverTipEventIndex,
    });
    const clientHistory = applyPendingEvents(baseHistory, pendingEvents);
    const resultHistory = applyPendingEvents(serverHistory, pendingEvents);
    return {
        ...metadata,
        pendingEvents,
        baseHistory,
        clientHistory,
        serverHistory,
        resultHistory,
    };
}

export function withOnlyRecordedEvents<TState>(
    branches: Record<string, PersistedServerBranch<TState>>,
    branchId: string,
): Record<string, PersistedServerBranch<TState>> {
    return {
        ...branches,
        [branchId]: {
            ...branches[branchId],
            events: branches[branchId]?.events.filter((event) => event.recorded) ?? [],
        },
    };
}

export function applyPendingEvents<TState>(
    initial: CrdtLocalHistory<TState>,
    events: ServerBranchEvent[],
) {
    let history = initial;
    for (const event of sortServerEvents(events)) {
        if (event.kind !== 'update') continue;
        history = applyRemoteHistoryUpdate(history, event.update);
    }
    return history;
}

export function updatesFromEvents(events: ServerBranchEvent[]): CrdtUpdate[] {
    return events
        .filter((event): event is ServerUpdateEvent => event.kind === 'update')
        .map((event) => event.update);
}

function eventTime(event: ServerBranchEvent) {
    return event.kind === 'update' ? event.receivedAt : event.createdAt;
}
