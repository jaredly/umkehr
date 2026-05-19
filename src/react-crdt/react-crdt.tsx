import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {deepEqual as equal} from '../deepEqual.js';
import {createPatchDispatcher} from '../helper.js';
import {type EqualFn} from '../internal.js';
import {asFlat, type MaybeNested, resolveAndApply} from '../make.js';
import {
    applyLocalCommand,
    applyRemoteHistoryUpdate,
    canRedoLocalCommand,
    canUndoLocalCommand,
    changedNormalPathsForCrdtUpdate,
    redoLocalCommand,
    undoLocalCommand,
    hlc,
    type CrdtDocument,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from '../crdt/index.js';
import {
    changedPaths,
    cancelScheduledTask,
    makeContextForPath,
    makePathListenerNode,
    notifyAllPaths,
    notifyPaths,
    recordPreviewPaths,
    scheduleTask,
    useValue,
    useStatuses,
    type Context,
    type PathListenerNode,
    type ScheduledTask,
} from '../react-core/index.js';
import type {ApplyTiming, DraftPatch, Path} from '../types.js';
import {useLatest} from '../react/useLatest.js';
import {createStatusStore, type StatusStore} from '../statuses.js';

export type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
};

export type SyncedContext<T, Tag extends string = 'type'> = {
    latest(): T;
    clearPreview(): void;
    previewHistory(history: CrdtLocalHistory<T> | null): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    useLocalHistory(): CrdtLocalHistory<T>;
    $: ReturnType<typeof createPatchDispatcher<T, Context, Tag, void>>;
    dispatch(v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming): void;
};

type QueuedChanges<T, Tag extends string = 'type'> = DraftPatch<T, Tag, Context>[];

type SyncedContextBase<T, Tag extends string> = {
    history: CrdtLocalHistory<T>;
    transport: SyncedTransport;
    tag: Tag;
    equalFn: EqualFn;
    save: (history: CrdtLocalHistory<T>) => void;
    listeners: (() => void)[];
    localHistoryListeners: (() => void)[];
    previewState: null | T;
    externalPreviewHistory: null | CrdtLocalHistory<T>;
    scheduled?: ScheduledTask;
    listenersByPath: PathListenerNode;
    queuedChanges: QueuedChanges<T, Tag>;
    activePreviewChanges: QueuedChanges<T, Tag>;
    previewPaths: Record<string, Path>;
    statuses: StatusStore;
};

export const createSyncedContext = <T, Tag extends string = 'type'>(
    tag: Tag,
    equalFn: EqualFn = equal,
) => {
    const Ctx = createContext<SyncedContextBase<T, Tag>>(null as any);

    return [
        makeProvider(Ctx, tag, equalFn),

        function useSyncedContext() {
            const ctx = useContext(Ctx);
            if (ctx === null) {
                throw new Error(
                    `createSyncedContext hook must be used within its matching Provider.`,
                );
            }

            return useMemo((): SyncedContext<T, Tag> => {
                const {dispatch, $} = makeDispatch(ctx, tag, equalFn);

                return {
                    latest() {
                        return visibleState(ctx);
                    },
                    clearPreview() {
                        clearSyncedPreview(ctx);
                    },
                    previewHistory(history) {
                        if (history === null) {
                            clearSyncedPreview(ctx);
                            clearExternalPreview(ctx);
                        } else {
                            replaceExternalPreview(ctx, history);
                        }
                    },
                    canUndo() {
                        return canUndoLocalCommand(ctx.history, ctx.transport.actor);
                    },
                    canRedo() {
                        return canRedoLocalCommand(ctx.history, ctx.transport.actor);
                    },
                    undo() {
                        applyUndo(ctx);
                    },
                    redo() {
                        applyRedo(ctx);
                    },
                    useLocalHistory() {
                        const [tick, setTick] = useState(0);
                        useEffect(() => {
                            const f = () => setTick((t) => t + 1);
                            ctx.localHistoryListeners.push(f);
                            return () => {
                                const at = ctx.localHistoryListeners.indexOf(f);
                                if (at !== -1) ctx.localHistoryListeners.splice(at, 1);
                            };
                        }, []);
                        tick;
                        return visibleHistory(ctx);
                    },
                    $,
                    dispatch,
                };
            }, [ctx, tag]);
        },
    ] as const;
};

function makeProvider<T, Tag extends string>(
    Ctx: React.Context<SyncedContextBase<T, Tag>>,
    tag: Tag,
    equalFn: EqualFn,
) {
    return function Provide({
        children,
        initial,
        transport,
        save,
        statuses,
    }: {
        children: React.ReactElement;
        initial: CrdtLocalHistory<T>;
        transport: SyncedTransport;
        save?(history: CrdtLocalHistory<T>): void;
        statuses?: StatusStore;
    }) {
        const latestSave = useLatest(save);
        const internalStatuses = useRef(statuses ?? createStatusStore());
        const value = useRef<SyncedContextBase<T, Tag>>({
            history: initial,
            transport,
            tag,
            equalFn,
            save: (history) => latestSave.current?.(history),
            listeners: [],
            localHistoryListeners: [],
            previewState: null,
            externalPreviewHistory: null,
            listenersByPath: makePathListenerNode(),
            queuedChanges: [],
            activePreviewChanges: [],
            previewPaths: {},
            statuses: statuses ?? internalStatuses.current,
        });

        value.current.statuses = statuses ?? internalStatuses.current;

        useEffect(() => {
            value.current.transport = transport;
        }, [transport]);

        useEffect(() => {
            if (initial !== value.current.history) {
                value.current.history = initial;
                clearSyncedPreview(value.current);
                clearExternalPreview(value.current);
                notifyAll(value.current);
            }
        }, [initial]);

        useEffect(
            () => transport.subscribe((update) => receiveRemoteUpdate(value.current, update)),
            [transport],
        );

        return <Ctx.Provider value={value.current} children={children} />;
    };
}

function makeDispatch<T, Tag extends string>(
    ctx: SyncedContextBase<T, Tag>,
    tag: Tag,
    equalFn: EqualFn,
) {
    const extra = makeContextForPath(
        () => visibleState(ctx),
        ctx.listenersByPath,
        () => ctx.statuses,
    );
    const go = (v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming) => {
        if (when === 'preview') {
            queuePreview(ctx, v, extra, tag, equalFn);
            return;
        }
        applyLocalDraft(ctx, v, extra, tag, equalFn);
    };
    return {
        dispatch: go,
        $: createPatchDispatcher<T, Context, Tag>(go, extra, tag),
    };
}

function queuePreview<T, Tag extends string>(
    ctx: SyncedContextBase<T, Tag>,
    v: MaybeNested<DraftPatch<T, Tag, Context>>,
    extra: Context,
    tag: Tag,
    equalFn: EqualFn,
) {
    ctx.queuedChanges.push(...(asFlat(v) as DraftPatch<T, Tag, Context>[]));
    if (ctx.scheduled != null) return;
    ctx.scheduled = scheduleTask(() => {
        ctx.scheduled = undefined;
        ctx.activePreviewChanges.push(...ctx.queuedChanges);
        ctx.queuedChanges = [];
        recomputePreview(ctx, extra, tag, equalFn);
    });
}

function recomputePreview<T, Tag extends string>(
    ctx: SyncedContextBase<T, Tag>,
    extra: Context,
    tag: Tag,
    equalFn: EqualFn,
) {
    const oldPaths = Object.values(ctx.previewPaths);
    ctx.previewState = null;
    ctx.previewPaths = {};
    if (!ctx.activePreviewChanges.length) {
        if (oldPaths.length) notifyPaths(ctx.listenersByPath, oldPaths);
        return;
    }
    const {current, changes} = resolveAndApply(
        visibleHistory(ctx).doc.state,
        ctx.activePreviewChanges,
        extra,
        tag,
        equalFn,
    );
    ctx.previewState = current;
    const paths = changedPaths(changes);
    recordPreviewPaths(ctx.previewPaths, paths);
    ctx.listeners.forEach((f) => f());
    notifyPaths(ctx.listenersByPath, [...oldPaths, ...paths]);
}

function clearSyncedPreview<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>) {
    const previewPaths = Object.values(ctx.previewPaths);
    const hadPreview = ctx.previewState !== null || previewPaths.length > 0;
    ctx.previewState = null;
    ctx.previewPaths = {};
    ctx.queuedChanges = [];
    ctx.activePreviewChanges = [];
    cancelScheduledTask(ctx.scheduled);
    ctx.scheduled = undefined;
    if (hadPreview) {
        ctx.listeners.forEach((f) => f());
        if (previewPaths.length) notifyPaths(ctx.listenersByPath, previewPaths);
        else notifyAllPaths(ctx.listenersByPath);
    }
}

function replaceExternalPreview<T, Tag extends string>(
    ctx: SyncedContextBase<T, Tag>,
    history: CrdtLocalHistory<T>,
) {
    ctx.externalPreviewHistory = history;
    clearSyncedPreview(ctx);
    ctx.listeners.forEach((f) => f());
    notifyAllPaths(ctx.listenersByPath);
    ctx.localHistoryListeners.forEach((f) => f());
}

function clearExternalPreview<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>) {
    if (ctx.externalPreviewHistory === null) return;
    ctx.externalPreviewHistory = null;
    ctx.listeners.forEach((f) => f());
    notifyAllPaths(ctx.listenersByPath);
    ctx.localHistoryListeners.forEach((f) => f());
}

function visibleState<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>) {
    return ctx.previewState ?? visibleHistory(ctx).doc.state;
}

function visibleHistory<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>) {
    return ctx.externalPreviewHistory ?? ctx.history;
}

function applyLocalDraft<T, Tag extends string>(
    ctx: SyncedContextBase<T, Tag>,
    v: MaybeNested<DraftPatch<T, Tag, Context>>,
    extra: Context,
    tag: Tag,
    equalFn: EqualFn,
) {
    const previewPaths = Object.values(ctx.previewPaths);
    clearSyncedPreview(ctx);
    clearExternalPreview(ctx);
    const {current, changes} = resolveAndApply(ctx.history.doc.state, v, extra, tag, equalFn);
    if (current === ctx.history.doc.state || !changes.length) return;

    const result = applyLocalCommand(
        ctx.history,
        v,
        ctx.transport.tick(),
        extra,
        tag,
        equalFn,
    );
    ctx.history = result.history;
    ctx.save(ctx.history);
    notifyChanged(ctx, [...previewPaths, ...changedPaths(changes)]);
    ctx.transport.publish(result.updates);
}

function receiveRemoteUpdate<T, Tag extends string>(
    ctx: SyncedContextBase<T, Tag>,
    update: CrdtUpdate,
) {
    const before = ctx.history.doc;
    const history = applyRemoteHistoryUpdate(ctx.history, update);
    ctx.history = history;
    ctx.save(ctx.history);

    const paths = changedNormalPathsForCrdtUpdate(before, history.doc, update);
    const extra = makeContextForPath(
        () => visibleState(ctx),
        ctx.listenersByPath,
    );
    if (ctx.activePreviewChanges.length || ctx.queuedChanges.length) {
        if (ctx.scheduled != null) {
            cancelScheduledTask(ctx.scheduled);
            ctx.scheduled = undefined;
            ctx.activePreviewChanges.push(...ctx.queuedChanges);
            ctx.queuedChanges = [];
        }
        recomputePreview(ctx, extra, ctx.tag, ctx.equalFn);
    }

    if (paths) notifyChanged(ctx, paths);
    else notifyAll(ctx);
}

function applyUndo<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>) {
    clearSyncedPreview(ctx);
    clearExternalPreview(ctx);
    const before = ctx.history.doc;
    const result = undoLocalCommand(ctx.history, ctx.transport.actor, ctx.transport.tick());
    if (!result.ok) return;
    ctx.history = result.history;
    ctx.save(ctx.history);
    notifyCrdtUpdates(ctx, before, result.history.doc, result.updates);
    ctx.transport.publish(result.updates);
}

function applyRedo<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>) {
    clearSyncedPreview(ctx);
    clearExternalPreview(ctx);
    const before = ctx.history.doc;
    const result = redoLocalCommand(ctx.history, ctx.transport.actor, ctx.transport.tick());
    if (!result.ok) return;
    ctx.history = result.history;
    ctx.save(ctx.history);
    notifyCrdtUpdates(ctx, before, result.history.doc, result.updates);
    ctx.transport.publish(result.updates);
}

function notifyCrdtUpdates<T, Tag extends string>(
    ctx: SyncedContextBase<T, Tag>,
    before: CrdtDocument<T>,
    after: CrdtDocument<T>,
    updates: CrdtUpdate[],
) {
    const paths: Path[] = [];
    let failed = false;
    for (const update of updates) {
        const changed = changedNormalPathsForCrdtUpdate(before, after, update);
        if (!changed) {
            failed = true;
            break;
        }
        paths.push(...changed);
    }
    if (failed) notifyAll(ctx);
    else notifyChanged(ctx, paths);
}

function notifyChanged<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>, paths: Path[]) {
    ctx.listeners.forEach((f) => f());
    notifyPaths(ctx.listenersByPath, paths);
    ctx.localHistoryListeners.forEach((f) => f());
}

function notifyAll<T, Tag extends string>(ctx: SyncedContextBase<T, Tag>) {
    ctx.listeners.forEach((f) => f());
    notifyAllPaths(ctx.listenersByPath);
    ctx.localHistoryListeners.forEach((f) => f());
}

export {useValue, useStatuses};
