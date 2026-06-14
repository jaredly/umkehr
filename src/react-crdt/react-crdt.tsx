import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {deepEqual as equal} from '../deepEqual.js';
import {createPatchDispatcher, getPath, type PatchBuilder} from '../helper.js';
import {type EqualFn} from '../internal.js';
import {asFlat, type MaybeNested, resolveAndApply} from '../make.js';
import {
    applyLocalCommand,
    applyRemoteHistoryUpdate,
    canRedoLocalCommand,
    canUndoLocalCommand,
    changedNormalPathsForCrdtUpdate,
    crdtPathForExisting,
    getMetaAtPath,
    redoLocalCommand,
    undoLocalCommand,
    builderExtensionsFromLeafPlugins,
    hlc,
    type CrdtMeta,
    type CrdtDocument,
    type CrdtLocalHistory,
    type CrdtPathSegment,
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
    useResettingState,
} from '../react-core/index.js';
import {pathToString, type ApplyTiming, type DraftPatch, type Path} from '../types.js';
import type {PatchBuilderInternal} from '../types.js';
import type {LeafBuilderExtensionAny, PatchBuilderOptions} from '../builderExtensions.js';
import {useLatest} from '../react/useLatest.js';
import {type RichCollaborativeText, type RichTextImportSnapshot} from '../richtext/index.js';
import {materializeRichTextState} from '../peritext/materialize.js';
import type {RichTextJsonValue, RichTextRenderView, RichTextState} from '../peritext/types.js';
import {createStatusStore, type StatusStore} from '../statuses.js';
import {
    createEphemeralStore,
    type EphemeralConfig,
    type EphemeralMessage,
    type EphemeralQuery,
    type EphemeralRecord,
    type EphemeralStore,
} from '../ephemeral.js';

export type SyncedTransport = {
    actor: string;
    tick(): hlc.HLC;
    publish(updates: CrdtUpdate[]): void;
    subscribe(receive: (update: CrdtUpdate) => void): () => void;
    publishEphemeral<Data>(messages: EphemeralMessage<Data>[]): void;
    subscribeEphemeral<Data>(receive: (message: EphemeralMessage<Data>) => void): () => void;
    clearEphemeralActor?(actor: string): void;
};

export type SyncedContext<
    T,
    Tag extends string = 'type',
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    latest(): T;
    clearPreview(): void;
    publishEphemeral(messages: EphemeralMessage<EphemeralData>[]): void;
    useEphemeral(query?: EphemeralQuery): EphemeralRecord<EphemeralData>[];
    previewHistory(history: CrdtLocalHistory<T> | null): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    useLocalHistory(): CrdtLocalHistory<T>;
    useCrdtPath<Current>(
        node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
    ): CrdtPathSegment[];
    useCrdtMeta<Current>(
        node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
    ): CrdtMeta | undefined;
    useRichText(
        node: PatchBuilderInternal<unknown, RichCollaborativeText, Tag, void, Context, Extensions>,
    ): RichTextBinding;
    $: PatchBuilder<T, Tag, void, Context, Extensions>;
    dispatch(v: MaybeNested<DraftPatch<T, Tag, Context, Extensions>>, when?: ApplyTiming): void;
};

export type RichTextBinding = {
    view: RichTextRenderView;
    commands: {
        insert(index: number, text: string): void;
        delete(start: number, end: number): void;
        mark(
            start: number,
            end: number,
            markType: string,
            value: RichTextJsonValue,
            preset?: 'inclusive' | 'exclusive' | 'none',
        ): void;
        unmark(
            start: number,
            end: number,
            markType: string,
            preset?: 'inclusive' | 'exclusive' | 'none',
        ): void;
        replace(snapshot: RichTextImportSnapshot): void;
    };
};

type QueuedChanges<
    T,
    Tag extends string = 'type',
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = DraftPatch<T, Tag, Context, Extensions>[];

type SyncedContextBase<
    T,
    Tag extends string,
    EphemeralData,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    history: CrdtLocalHistory<T>;
    transport: SyncedTransport;
    ephemeralConfig?: EphemeralConfig<EphemeralData>;
    ephemeralStore: EphemeralStore;
    tag: Tag;
    builderExtensions: Extensions;
    equalFn: EqualFn;
    save: (history: CrdtLocalHistory<T>) => void;
    listeners: (() => void)[];
    localHistoryListeners: (() => void)[];
    previewState: null | T;
    externalPreviewHistory: null | CrdtLocalHistory<T>;
    scheduled?: ScheduledTask;
    listenersByPath: PathListenerNode;
    queuedChanges: QueuedChanges<T, Tag, Extensions>;
    activePreviewChanges: QueuedChanges<T, Tag, Extensions>;
    previewPaths: Record<string, Path>;
    statuses: StatusStore;
};

export const createSyncedContext = <
    T,
    Tag extends string = 'type',
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(
    tag: Tag,
    equalFn: EqualFn = equal,
    ephemeralConfig?: EphemeralConfig<EphemeralData>,
    options?: PatchBuilderOptions<Extensions>,
) => {
    const Ctx = createContext<SyncedContextBase<T, Tag, EphemeralData, Extensions>>(null as any);

    return [
        makeProvider(Ctx, tag, equalFn, ephemeralConfig, options),

        function useSyncedContext() {
            const ctx = useContext(Ctx);
            if (ctx === null) {
                throw new Error(
                    `createSyncedContext hook must be used within its matching Provider.`,
                );
            }

            return useMemo((): SyncedContext<T, Tag, EphemeralData, Extensions> => {
                const {dispatch, $} = makeDispatch(ctx, tag, equalFn);

                return {
                    latest() {
                        return visibleState(ctx);
                    },
                    clearPreview() {
                        clearSyncedPreview(ctx);
                    },
                    publishEphemeral(messages) {
                        ctx.transport.publishEphemeral(messages);
                    },
                    useEphemeral(query) {
                        const [records, setRecords] = useState(() =>
                            ctx.ephemeralStore.get<EphemeralData>(query),
                        );
                        const latestRecords = useLatest(records);
                        useEffect(() => {
                            const current = ctx.ephemeralStore.get<EphemeralData>(query);
                            if (!equal(latestRecords.current, current)) {
                                latestRecords.current = current;
                                setRecords(current);
                            }
                            return ctx.ephemeralStore.subscribe<EphemeralData>(query, (next) => {
                                if (!equal(latestRecords.current, next)) {
                                    latestRecords.current = next;
                                    setRecords(next);
                                }
                            });
                        }, [ctx, query, latestRecords]);
                        return records;
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
                    useCrdtPath(node) {
                        const path = getPath(node);
                        const [tick, setTick] = useState(0);
                        useEffect(
                            () =>
                                makeContextForPath(
                                    () => visibleState(ctx),
                                    ctx.listenersByPath,
                                ).listenToPath(path, () => setTick((t) => t + 1)),
                            [ctx, path],
                        );
                        tick;
                        return crdtPathForExisting(visibleHistory(ctx).doc, path);
                    },
                    useCrdtMeta(node) {
                        const path = getPath(node);
                        // const [tick, setTick] = useState(0);
                        const [meta, setMeta] = useResettingState(() => {
                            const history = visibleHistory(ctx);
                            return getMetaAtExistingPath(history.doc, path);
                        }, [path]);
                        const lmeta = useLatest(meta);
                        useEffect(
                            () =>
                                makeContextForPath(
                                    () => visibleState(ctx),
                                    ctx.listenersByPath,
                                ).listenToPath(path, () => {
                                    const history = visibleHistory(ctx);
                                    const newMeta = getMetaAtExistingPath(history.doc, path);

                                    if (!equal(newMeta, lmeta.current)) {
                                        setMeta(newMeta);
                                    }
                                }),
                            [ctx, path],
                        );
                        // tick;
                        return meta;
                    },
                    useRichText(node) {
                        const path = getPath(node);
                        const [view, setView] = useResettingState(() => {
                            return richTextViewAtPath(visibleHistory(ctx).doc, path);
                        }, [path]);
                        const latestView = useLatest(view);
                        useEffect(
                            () =>
                                makeContextForPath(
                                    () => visibleState(ctx),
                                    ctx.listenersByPath,
                                ).listenToPath(path, () => {
                                    const next = richTextViewAtPath(visibleHistory(ctx).doc, path);
                                    if (!equal(next, latestView.current)) setView(next);
                                }),
                            [ctx, path, latestView],
                        );
                        return {
                            view,
                            commands: {
                                insert: (index, text) =>
                                    dispatch({
                                        op: 'leaf',
                                        plugin: 'umkehr.rich-text',
                                        path,
                                        change: {kind: 'insert', at: {index}, text},
                                    } as DraftPatch<T, Tag, Context, Extensions>),
                                delete: (start, end) =>
                                    dispatch({
                                        op: 'leaf',
                                        plugin: 'umkehr.rich-text',
                                        path,
                                        change: {kind: 'delete', range: {start, end}},
                                    } as DraftPatch<T, Tag, Context, Extensions>),
                                mark: (start, end, markType, value, preset) =>
                                    dispatch({
                                        op: 'leaf',
                                        plugin: 'umkehr.rich-text',
                                        path,
                                        change: {
                                            kind: 'mark',
                                            range: {start, end},
                                            markType,
                                            value,
                                            preset,
                                        },
                                    } as DraftPatch<T, Tag, Context, Extensions>),
                                unmark: (start, end, markType, preset) =>
                                    dispatch({
                                        op: 'leaf',
                                        plugin: 'umkehr.rich-text',
                                        path,
                                        change: {
                                            kind: 'unmark',
                                            range: {start, end},
                                            markType,
                                            preset,
                                        },
                                    } as DraftPatch<T, Tag, Context, Extensions>),
                                replace: (snapshot) =>
                                    dispatch({
                                        op: 'leaf',
                                        plugin: 'umkehr.rich-text',
                                        path,
                                        change: {kind: 'replace', snapshot},
                                    } as DraftPatch<T, Tag, Context, Extensions>),
                            },
                        };
                    },
                    $,
                    dispatch,
                };
            }, [ctx, tag]);
        },
    ] as const;
};

function getMetaAtExistingPath<T>(doc: CrdtDocument<T>, path: Path) {
    const crdtPath = tryCrdtPathForExisting(doc, path);
    return crdtPath ? getMetaAtPath(doc.meta, crdtPath) : undefined;
}

function richTextViewAtPath<T>(doc: CrdtDocument<T>, path: Path): RichTextRenderView {
    const meta = getMetaAtExistingPath(doc, path);
    const value = valueAtPath(doc.state, path);
    return meta?.kind === 'leaf' && meta.plugin === 'umkehr.rich-text' && isRichTextState(value)
        ? materializeRichTextState(value)
        : {plainText: '', spans: []};
}

function valueAtPath(root: unknown, path: Path) {
    let current = root;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string | number, unknown>)[segment.key];
    }
    return current;
}

function isRichTextState(value: unknown): value is RichTextState {
    return Boolean(
        value && typeof value === 'object' && Array.isArray((value as {chars?: unknown}).chars),
    );
}

function tryCrdtPathForExisting<T>(doc: CrdtDocument<T>, path: Path) {
    try {
        return crdtPathForExisting(doc, path);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Cannot translate CRDT path:')) {
            return null;
        }
        throw error;
    }
}

function makeProvider<
    T,
    Tag extends string,
    EphemeralData,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(
    Ctx: React.Context<SyncedContextBase<T, Tag, EphemeralData, Extensions>>,
    tag: Tag,
    equalFn: EqualFn,
    ephemeralConfig?: EphemeralConfig<EphemeralData>,
    options?: PatchBuilderOptions<Extensions>,
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
        const runtimeBuilderExtensions = (options?.builderExtensions ??
            builderExtensionsFromLeafPlugins(initial.doc.schema.leafPlugins)) as Extensions;
        const value = useRef<SyncedContextBase<T, Tag, EphemeralData, Extensions>>({
            history: initial,
            transport,
            ephemeralConfig,
            ephemeralStore: createEphemeralStore(),
            tag,
            builderExtensions: runtimeBuilderExtensions,
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
        value.current.ephemeralConfig = ephemeralConfig;
        value.current.builderExtensions = (options?.builderExtensions ??
            builderExtensionsFromLeafPlugins(initial.doc.schema.leafPlugins)) as Extensions;

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

        useEffect(
            () =>
                transport.subscribeEphemeral<unknown>((message) =>
                    receiveRemoteEphemeral(value.current, message),
                ),
            [transport],
        );

        useEffect(() => {
            const clearActor = (actor: string) => value.current.ephemeralStore.clearActor(actor);
            transport.clearEphemeralActor = clearActor;
            return () => {
                if (transport.clearEphemeralActor === clearActor) {
                    delete transport.clearEphemeralActor;
                }
            };
        }, [transport]);

        return <Ctx.Provider value={value.current} children={children} />;
    };
}

function makeDispatch<T, Tag extends string, Extensions extends readonly LeafBuilderExtensionAny[]>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
    tag: Tag,
    equalFn: EqualFn,
) {
    const extra = makeContextForPath(
        () => visibleState(ctx),
        ctx.listenersByPath,
        () => ctx.statuses,
    );
    const go = (v: MaybeNested<DraftPatch<T, Tag, Context, Extensions>>, when?: ApplyTiming) => {
        if (when === 'preview') {
            queuePreview(ctx, v, extra, tag, equalFn);
            return;
        }
        applyLocalDraft(ctx, v, extra, tag, equalFn);
    };
    return {
        dispatch: go,
        $: createPatchDispatcher<T, Context, Tag, void, Extensions>(go, extra, tag, {
            builderExtensions: ctx.builderExtensions,
        }),
    };
}

function queuePreview<T, Tag extends string, Extensions extends readonly LeafBuilderExtensionAny[]>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
    v: MaybeNested<DraftPatch<T, Tag, Context, Extensions>>,
    extra: Context,
    tag: Tag,
    equalFn: EqualFn,
) {
    ctx.queuedChanges.push(...(asFlat(v) as DraftPatch<T, Tag, Context, Extensions>[]));
    if (ctx.scheduled != null) return;
    ctx.scheduled = scheduleTask(() => {
        ctx.scheduled = undefined;
        ctx.activePreviewChanges.push(...ctx.queuedChanges);
        ctx.queuedChanges = [];
        recomputePreview(ctx, extra, tag, equalFn);
    });
}

function recomputePreview<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, any, Extensions>, extra: Context, tag: Tag, equalFn: EqualFn) {
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

function clearSyncedPreview<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, any, Extensions>) {
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

function replaceExternalPreview<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, any, Extensions>, history: CrdtLocalHistory<T>) {
    ctx.externalPreviewHistory = history;
    clearSyncedPreview(ctx);
    ctx.listeners.forEach((f) => f());
    notifyAllPaths(ctx.listenersByPath);
    ctx.localHistoryListeners.forEach((f) => f());
}

function clearExternalPreview<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, any, Extensions>) {
    if (ctx.externalPreviewHistory === null) return;
    ctx.externalPreviewHistory = null;
    ctx.listeners.forEach((f) => f());
    notifyAllPaths(ctx.listenersByPath);
    ctx.localHistoryListeners.forEach((f) => f());
}

function visibleState<T, Tag extends string, Extensions extends readonly LeafBuilderExtensionAny[]>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
) {
    return ctx.previewState ?? visibleHistory(ctx).doc.state;
}

function visibleHistory<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, any, Extensions>) {
    return ctx.externalPreviewHistory ?? ctx.history;
}

function applyLocalDraft<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
    v: MaybeNested<DraftPatch<T, Tag, Context, Extensions>>,
    extra: Context,
    tag: Tag,
    equalFn: EqualFn,
) {
    const previewPaths = Object.values(ctx.previewPaths);
    clearSyncedPreview(ctx);
    clearExternalPreview(ctx);
    const {current, changes} = resolveAndApply(ctx.history.doc.state, v, extra, tag, equalFn);
    if (!changes.length) return;

    const result = applyLocalCommand(ctx.history, v, ctx.transport.tick(), extra, tag, equalFn);
    ctx.history = result.history;
    ctx.save(ctx.history);
    notifyChanged(ctx, [...previewPaths, ...changedPaths(changes)]);
    ctx.transport.publish(result.updates);
}

function receiveRemoteUpdate<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, any, Extensions>, update: CrdtUpdate) {
    const before = ctx.history.doc;
    const history = applyRemoteHistoryUpdate(ctx.history, update);
    ctx.history = history;
    ctx.save(ctx.history);

    const paths = changedNormalPathsForCrdtUpdate(before, history.doc, update);
    const extra = makeContextForPath(() => visibleState(ctx), ctx.listenersByPath);
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

function receiveRemoteEphemeral<
    T,
    Tag extends string,
    EphemeralData,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, EphemeralData, Extensions>, message: EphemeralMessage<unknown>) {
    if (message.actor === ctx.transport.actor) return;
    if (!isValidEphemeralMessage(ctx, message)) return;
    ctx.ephemeralStore.add([message as EphemeralMessage<EphemeralData>]);
}

function isValidEphemeralMessage<
    T,
    Tag extends string,
    EphemeralData,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(
    ctx: SyncedContextBase<T, Tag, EphemeralData, Extensions>,
    message: EphemeralMessage<unknown>,
): message is EphemeralMessage<EphemeralData> {
    const config = ctx.ephemeralConfig;
    if (!config) return false;
    if (config.maxEphemeralBytes !== undefined) {
        let bytes = 0;
        try {
            bytes = new TextEncoder().encode(JSON.stringify(message)).length;
        } catch {
            return false;
        }
        if (bytes > config.maxEphemeralBytes) return false;
    }
    return config.validateEphemeralData(message.data);
}

function applyUndo<T, Tag extends string, Extensions extends readonly LeafBuilderExtensionAny[]>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
) {
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

function applyRedo<T, Tag extends string, Extensions extends readonly LeafBuilderExtensionAny[]>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
) {
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

function notifyCrdtUpdates<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
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

function notifyChanged<
    T,
    Tag extends string,
    Extensions extends readonly LeafBuilderExtensionAny[],
>(ctx: SyncedContextBase<T, Tag, any, Extensions>, paths: Path[]) {
    ctx.listeners.forEach((f) => f());
    notifyPaths(ctx.listenersByPath, paths);
    ctx.localHistoryListeners.forEach((f) => f());
}

function notifyAll<T, Tag extends string, Extensions extends readonly LeafBuilderExtensionAny[]>(
    ctx: SyncedContextBase<T, Tag, any, Extensions>,
) {
    ctx.listeners.forEach((f) => f());
    notifyAllPaths(ctx.listenersByPath);
    ctx.localHistoryListeners.forEach((f) => f());
}

export {useValue, useStatuses};
export {RichTextEditor} from '../react-rich-text/index.js';
