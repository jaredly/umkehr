export type Branch = {
    branchId: string;
    sourceBranchId?: string;
    forkEventIndex?: number;
};

export type UpdateEvent<TUpdate> = {
    kind: 'update';
    branchId: string;
    eventIndex: number;
    eventId: string;
    update: TUpdate;
    recorded?: boolean;
    receivedAt?: string;
};

export type MergeEvent = {
    kind: 'merge';
    branchId: string;
    eventIndex: number;
    mergeId: string;
    sourceBranchId: string;
    sourceThroughEventIndex: number;
    actor?: string;
    createdAt?: string;
    recorded?: boolean;
};

export type BranchEvent<TUpdate> = UpdateEvent<TUpdate> | MergeEvent;

export type PersistedBranch<THistory, TUpdate> = Branch & {
    history: THistory;
    lastSeenEventIndex: number;
    undoCheckpointEventIndex?: number;
    events: BranchEvent<TUpdate>[];
};

export type BranchAdapter<THistory, TUpdate> = {
    createInitialHistory(): THistory;
    applyUpdate(
        history: THistory,
        update: TUpdate,
        options: {recordHistory: boolean},
    ): THistory;
    sameContents?(left: THistory, right: THistory): boolean;
};

export type MaterializeBranchOptions<THistory, TUpdate> = {
    adapter: BranchAdapter<THistory, TUpdate>;
    branches: Record<string, PersistedBranch<THistory, TUpdate>>;
    branchId: string;
    throughEventIndex?: number;
    undoCheckpointEventIndex?: number;
};

export type MergeImpact = {
    sourceUpdateCount: number;
    effectiveUpdateCount: number;
    alreadyMergedUpdateCount: number;
    noEffectUpdateCount: number;
    alreadyMerged: boolean;
    alreadyMergedThroughEventIndex?: number;
};

type MaterializeContext<THistory, TUpdate> = {
    adapter: BranchAdapter<THistory, TUpdate>;
    branches: Record<string, PersistedBranch<THistory, TUpdate>>;
    applied: Set<string>;
    stack: Set<string>;
};

type CollectedUpdateEvent<TUpdate> = {
    branchId: string;
    eventIndex: number;
    eventId: string;
    update: TUpdate;
};

export function materializeBranch<THistory, TUpdate>({
    adapter,
    branches,
    branchId,
    throughEventIndex,
    undoCheckpointEventIndex,
}: MaterializeBranchOptions<THistory, TUpdate>): THistory {
    const context: MaterializeContext<THistory, TUpdate> = {
        adapter,
        branches,
        applied: new Set(),
        stack: new Set(),
    };
    const checkpoint =
        undoCheckpointEventIndex ?? branches[branchId]?.undoCheckpointEventIndex ?? 0;
    let history = applyBranchToHistory(
        adapter.createInitialHistory(),
        branchId,
        Math.min(throughEventIndex ?? Number.MAX_SAFE_INTEGER, checkpoint),
        context,
    );
    const branch = branches[branchId];
    if (!branch) return history;
    for (const event of sortedEvents(branch.events)) {
        if (event.eventIndex <= checkpoint) continue;
        if (throughEventIndex !== undefined && event.eventIndex > throughEventIndex) break;
        if (event.kind === 'update') {
            history = applyUpdateOnce(history, event.update, event.eventId, context, {
                recordHistory: true,
            });
        } else {
            history = applyBranchToHistory(
                history,
                event.sourceBranchId,
                event.sourceThroughEventIndex,
                context,
            );
        }
    }
    return history;
}

export function mergeSourceUpdatesForBranchThrough<THistory, TUpdate>(
    branches: Record<string, PersistedBranch<THistory, TUpdate>>,
    branchId: string,
    throughEventIndex: number,
): TUpdate[] {
    return updateEventsForBranchThrough(branches, branchId, throughEventIndex).map(
        (event) => event.update,
    );
}

export function updateEventsForBranchThrough<THistory, TUpdate>(
    branches: Record<string, PersistedBranch<THistory, TUpdate>>,
    branchId: string,
    throughEventIndex: number,
    stack = new Set<string>(),
): CollectedUpdateEvent<TUpdate>[] {
    const branch = branches[branchId];
    if (!branch) return [];
    if (stack.has(branchId)) return [];
    stack.add(branchId);
    const events: CollectedUpdateEvent<TUpdate>[] = [];
    for (const event of sortedEvents(branch.events)) {
        if (event.eventIndex > throughEventIndex) break;
        if (event.kind === 'merge') {
            events.push(
                ...updateEventsForBranchThrough(
                    branches,
                    event.sourceBranchId,
                    event.sourceThroughEventIndex,
                    stack,
                ),
            );
        } else {
            events.push({
                branchId,
                eventIndex: event.eventIndex,
                eventId: event.eventId,
                update: event.update,
            });
        }
    }
    stack.delete(branchId);
    return events;
}

export function buildMergeImpact<THistory, TUpdate>({
    adapter,
    branches,
    before,
    targetBranchId,
    sourceBranchId,
    sourceThroughEventIndex,
}: {
    adapter: BranchAdapter<THistory, TUpdate>;
    branches: Record<string, PersistedBranch<THistory, TUpdate>>;
    before: THistory;
    targetBranchId: string;
    sourceBranchId: string;
    sourceThroughEventIndex: number;
}): MergeImpact {
    const sourceUpdates = updateEventsForBranchThrough(
        branches,
        sourceBranchId,
        sourceThroughEventIndex,
    );
    const coverage = mergedSourceCoverage(branches, targetBranchId);
    const alreadyMergedThroughEventIndex = coverage.get(sourceBranchId);
    const alreadyMergedUpdateCount = sourceUpdates.filter(
        (event) => event.eventIndex <= (coverage.get(event.branchId) ?? 0),
    ).length;
    let effectiveUpdateCount = 0;
    let current = before;
    const applied = new Set<string>();
    const sameContents = adapter.sameContents ?? Object.is;
    for (const event of sourceUpdates) {
        if (applied.has(event.eventId)) continue;
        const next = adapter.applyUpdate(current, event.update, {recordHistory: false});
        applied.add(event.eventId);
        if (!sameContents(current, next)) effectiveUpdateCount += 1;
        current = next;
    }
    return {
        sourceUpdateCount: sourceUpdates.length,
        effectiveUpdateCount,
        alreadyMergedUpdateCount,
        noEffectUpdateCount: sourceUpdates.length - effectiveUpdateCount,
        alreadyMerged:
            alreadyMergedThroughEventIndex !== undefined &&
            alreadyMergedThroughEventIndex >= sourceThroughEventIndex,
        alreadyMergedThroughEventIndex,
    };
}

export function mergedSourceCoverage<THistory, TUpdate>(
    branches: Record<string, PersistedBranch<THistory, TUpdate>>,
    targetBranchId: string,
) {
    const coverage = new Map<string, number>();
    collectMergedSourceCoverage(branches, targetBranchId, Number.MAX_SAFE_INTEGER, coverage);
    return coverage;
}

export function sortedEvents<TUpdate>(events: BranchEvent<TUpdate>[]) {
    return [...events].sort((a, b) => a.eventIndex - b.eventIndex);
}

function applyBranchToHistory<THistory, TUpdate>(
    history: THistory,
    branchId: string,
    throughEventIndex: number,
    context: MaterializeContext<THistory, TUpdate>,
): THistory {
    const branch = context.branches[branchId];
    if (!branch) return history;
    if (context.stack.has(branchId)) return history;
    context.stack.add(branchId);
    let current = applyBranchBase(history, branchId, context);
    for (const event of sortedEvents(branch.events)) {
        if (event.eventIndex > throughEventIndex) break;
        if (event.kind === 'update') {
            current = applyUpdateOnce(current, event.update, event.eventId, context, {
                recordHistory: false,
            });
        } else {
            current = applyBranchToHistory(
                current,
                event.sourceBranchId,
                event.sourceThroughEventIndex,
                context,
            );
        }
    }
    context.stack.delete(branchId);
    return current;
}

function applyBranchBase<THistory, TUpdate>(
    history: THistory,
    branchId: string,
    context: MaterializeContext<THistory, TUpdate>,
): THistory {
    const branch = context.branches[branchId];
    if (!branch?.sourceBranchId) return history;
    return applyBranchToHistory(
        history,
        branch.sourceBranchId,
        branch.forkEventIndex ?? 0,
        context,
    );
}

function applyUpdateOnce<THistory, TUpdate>(
    history: THistory,
    update: TUpdate,
    eventId: string,
    context: MaterializeContext<THistory, TUpdate>,
    options: {recordHistory: boolean},
): THistory {
    if (context.applied.has(eventId)) return history;
    const next = context.adapter.applyUpdate(history, update, options);
    context.applied.add(eventId);
    return next;
}

function collectMergedSourceCoverage<THistory, TUpdate>(
    branches: Record<string, PersistedBranch<THistory, TUpdate>>,
    branchId: string,
    throughEventIndex: number,
    coverage: Map<string, number>,
    stack = new Set<string>(),
) {
    const branch = branches[branchId];
    if (!branch) return;
    if (stack.has(branchId)) return;
    stack.add(branchId);
    for (const event of sortedEvents(branch.events)) {
        if (event.eventIndex > throughEventIndex) break;
        if (event.kind !== 'merge') continue;
        coverage.set(
            event.sourceBranchId,
            Math.max(coverage.get(event.sourceBranchId) ?? 0, event.sourceThroughEventIndex),
        );
        collectMergedSourceCoverage(
            branches,
            event.sourceBranchId,
            event.sourceThroughEventIndex,
            coverage,
            stack,
        );
    }
    stack.delete(branchId);
}
