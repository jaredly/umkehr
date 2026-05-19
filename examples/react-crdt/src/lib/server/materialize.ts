import {
    applyCrdtUpdate,
    applyRemoteHistoryUpdate,
    createCrdtLocalHistory,
    getMetaAtPath,
    hlc,
    materialize,
    type CrdtDocument,
    type CrdtLocalHistory,
    type CrdtPathSegment,
    type CrdtUpdate,
    type HlcTimestamp,
    type JsonValue,
} from 'umkehr/crdt';
import {createInitialCrdtHistory, type AppDefinition} from '../crdtApp';
import type {PersistedServerBranch, ServerBranchEvent} from './types';

export function materializeServerBranch<TState>({
    app,
    branches,
    branchId,
    throughEventIndex,
    undoCheckpointEventIndex,
}: {
    app: AppDefinition<TState>;
    branches: Record<string, PersistedServerBranch<TState>>;
    branchId: string;
    throughEventIndex?: number;
    undoCheckpointEventIndex?: number;
}): CrdtLocalHistory<TState> {
    const context: MaterializeContext<TState> = {
        app,
        branches,
        applied: new Set(),
        stack: new Set(),
    };
    const checkpoint = undoCheckpointEventIndex ?? branches[branchId]?.undoCheckpointEventIndex ?? 0;
    const baseDoc = applyBranchToDocument(
        createInitialCrdtHistory(app).doc,
        branchId,
        Math.min(throughEventIndex ?? Number.MAX_SAFE_INTEGER, checkpoint),
        context,
    );
    let history = createCrdtLocalHistory(baseDoc);
    const branch = branches[branchId];
    if (!branch) return history;
    for (const event of sortedEvents(branch.events)) {
        if (event.eventIndex <= checkpoint) continue;
        if (throughEventIndex !== undefined && event.eventIndex > throughEventIndex) break;
        if (event.kind === 'update') {
            if (context.applied.has(event.hlcTimestamp)) continue;
            history = applyRemoteHistoryUpdate(history, event.update);
            context.applied.add(event.hlcTimestamp);
        } else {
            history = {
                ...history,
                doc: applyBranchToDocument(
                    history.doc,
                    event.sourceBranchId,
                    event.sourceThroughEventIndex,
                    context,
                ),
            };
        }
    }
    return history;
}

export function applyEventsToDocument<TState>(
    doc: CrdtDocument<TState>,
    events: ServerBranchEvent[],
): CrdtDocument<TState> {
    let current = doc;
    const applied = new Set<string>();
    for (const event of sortedEvents(events)) {
        if (event.kind !== 'update') continue;
        if (applied.has(event.hlcTimestamp)) continue;
        current = applyCrdtUpdate(current, event.update);
        applied.add(event.hlcTimestamp);
    }
    return current;
}

export type MergePathPreview<TState> = {
    sourceBranchId: string;
    sourceThroughEventIndex: number;
    targetBranchId: string;
    before: CrdtLocalHistory<TState>;
    merged: CrdtLocalHistory<TState>;
    preview: CrdtLocalHistory<TState>;
    changedPaths: CrdtPathSegment[][];
    revertUpdates: CrdtUpdate[];
};

export function buildMergePathPreview<TState>({
    app,
    branches,
    targetBranchId,
    sourceBranchId,
    sourceThroughEventIndex,
    revertedPathKeys,
    clock,
}: {
    app: AppDefinition<TState>;
    branches: Record<string, PersistedServerBranch<TState>>;
    targetBranchId: string;
    sourceBranchId: string;
    sourceThroughEventIndex: number;
    revertedPathKeys: Set<string>;
    clock: hlc.HLC;
}): MergePathPreview<TState> {
    const before = materializeServerBranch({app, branches, branchId: targetBranchId});
    const merged = materializeServerBranch({
        app,
        branches: withPreviewMerge(branches, targetBranchId, sourceBranchId, sourceThroughEventIndex),
        branchId: targetBranchId,
    });
    const changedPaths = pathsForBranchThrough(branches, sourceBranchId, sourceThroughEventIndex);
    const revertPaths = changedPaths.filter((path) => revertedPathKeys.has(pathKey(path)));
    const revertUpdates = createRestoreUpdates(before.doc, revertPaths, clock);
    let preview = merged;
    for (const update of revertUpdates) {
        preview = applyRemoteHistoryUpdate(preview, update);
    }
    return {
        sourceBranchId,
        sourceThroughEventIndex,
        targetBranchId,
        before,
        merged,
        preview,
        changedPaths,
        revertUpdates,
    };
}

export function pathKey(path: CrdtPathSegment[]) {
    return JSON.stringify(path);
}

export function pathLabel(path: CrdtPathSegment[]) {
    if (path.length === 0) return '<root>';
    return path
        .map((segment) => {
            switch (segment.type) {
                case 'objectField':
                case 'recordEntry':
                    return segment.key;
                case 'arrayItem':
                    return `[${segment.id.slice(-6)}]`;
                case 'taggedField':
                    return `${segment.tagValue}.${segment.key}`;
            }
        })
        .join('.');
}

type MaterializeContext<TState> = {
    app: AppDefinition<TState>;
    branches: Record<string, PersistedServerBranch<TState>>;
    applied: Set<string>;
    stack: Set<string>;
};

function applyBranchToDocument<TState>(
    doc: CrdtDocument<TState>,
    branchId: string,
    throughEventIndex: number,
    context: MaterializeContext<TState>,
): CrdtDocument<TState> {
    const branch = context.branches[branchId];
    if (!branch) return doc;
    if (context.stack.has(branchId)) return doc;
    context.stack.add(branchId);
    let current = applyBranchBase(doc, branchId, context);
    for (const event of sortedEvents(branch.events)) {
        if (event.eventIndex > throughEventIndex) break;
        if (event.kind === 'update') {
            current = applyUpdateOnce(current, event.update, context.applied);
        } else {
            current = applyBranchToDocument(
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

function applyBranchBase<TState>(
    doc: CrdtDocument<TState>,
    branchId: string,
    context: MaterializeContext<TState>,
): CrdtDocument<TState> {
    const branch = context.branches[branchId];
    if (!branch?.sourceBranchId) return doc;
    return applyBranchToDocument(doc, branch.sourceBranchId, branch.forkEventIndex ?? 0, context);
}

function withPreviewMerge<TState>(
    branches: Record<string, PersistedServerBranch<TState>>,
    targetBranchId: string,
    sourceBranchId: string,
    sourceThroughEventIndex: number,
) {
    const target = branches[targetBranchId];
    if (!target) return branches;
    return {
        ...branches,
        [targetBranchId]: {
            ...target,
            events: [
                ...target.events,
                {
                    kind: 'merge' as const,
                    mergeId: 'preview',
                    docId: target.events[0]?.docId ?? '',
                    branchId: targetBranchId,
                    eventIndex: Math.max(0, ...target.events.map((event) => event.eventIndex)) + 1,
                    sourceBranchId,
                    sourceThroughEventIndex,
                    actor: 'preview',
                    createdAt: new Date(0).toISOString(),
                },
            ],
        },
    };
}

function pathsForBranchThrough<TState>(
    branches: Record<string, PersistedServerBranch<TState>>,
    branchId: string,
    throughEventIndex: number,
    seen = new Set<string>(),
): CrdtPathSegment[][] {
    const branch = branches[branchId];
    if (!branch) return [];
    const paths: CrdtPathSegment[][] = [];
    for (const event of sortedEvents(branch.events)) {
        if (event.eventIndex > throughEventIndex) break;
        if (event.kind === 'merge') {
            paths.push(
                ...pathsForBranchThrough(
                    branches,
                    event.sourceBranchId,
                    event.sourceThroughEventIndex,
                    seen,
                ),
            );
            continue;
        }
        const path = pathForUpdate(event.update);
        const key = pathKey(path);
        if (seen.has(key)) continue;
        seen.add(key);
        paths.push(path);
    }
    return paths;
}

function pathForUpdate(update: CrdtUpdate): CrdtPathSegment[] {
    return update.op === 'setOrder' ? update.arrayPath : update.path;
}

function createRestoreUpdates<TState>(
    before: CrdtDocument<TState>,
    paths: CrdtPathSegment[][],
    clock: hlc.HLC,
): CrdtUpdate[] {
    const updates: CrdtUpdate[] = [];
    let currentClock = clock;
    for (const path of paths) {
        currentClock = hlc.inc(currentClock, Date.now());
        updates.push(metaToUpdate(path, getMetaAtPath(before.meta, path), hlc.pack(currentClock)));
    }
    return updates;
}

function metaToUpdate(
    path: CrdtPathSegment[],
    meta: ReturnType<typeof getMetaAtPath>,
    ts: HlcTimestamp,
): CrdtUpdate {
    if (!meta || meta.kind === 'tombstone') return {op: 'delete', path, ts};
    const value = materialize(meta) as JsonValue | undefined;
    if (value === undefined) return {op: 'delete', path, ts};
    return {op: 'set', path, value, ts};
}

function applyUpdateOnce<TState>(
    doc: CrdtDocument<TState>,
    update: CrdtUpdate,
    applied: Set<string>,
) {
    const timestamp = latestTimestamp(update);
    if (timestamp && applied.has(timestamp)) return doc;
    const next = applyCrdtUpdate(doc, update);
    if (timestamp) applied.add(timestamp);
    return next;
}

function latestTimestamp(update: CrdtUpdate) {
    if (update.op !== 'setOrder') return update.ts;
    return Object.values(update.orders)
        .map((order) => order.ts)
        .sort()
        .at(-1);
}

function sortedEvents(events: ServerBranchEvent[]) {
    return [...events].sort((a, b) => a.eventIndex - b.eventIndex);
}
