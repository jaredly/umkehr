import {deepEqual as equal} from '../deepEqual.js';
import {createPatchDispatcher, getExtra, getPath} from '../helper.js';
import {
    type Annotations,
    dispatchWithChangedPaths,
    type History,
    jumpWithChangedPaths,
} from '../history/history.js';
import {type EqualFn} from '../internal.js';
import {asFlat, type MaybeNested, resolveAndApply} from '../make.js';
import type {ApplyTiming, DraftPatch, PatchBuilderInternal, Path} from '../types.js';
import {
    cancelScheduledTask,
    changedPaths,
    clearPreviewState,
    makeContextForPath,
    makePathListenerNode,
    notifyAllPaths,
    notifyPaths,
    recordPreviewPaths,
    replacePreviewState,
    scheduleTask,
    type Context,
    type PathListenerNode,
    type ScheduledTask,
} from '../framework-core/index.js';

export type RemixHandle = {
    id: string;
    signal: AbortSignal;
    update(): unknown;
    context: {
        set(value: unknown): void;
        set(key: unknown, value: unknown): void;
        get<T>(key: unknown): T;
    };
};

export type WatchedValue<T> = {
    get current(): T;
};

type QueuedChanges<T, Tag extends string = 'type'> = DraftPatch<T, Tag, Context>[];
type RemixUpdater<T, Tag extends string> = PatchBuilderInternal<unknown, T, Tag, void, Context>;

type ContextBase<State, Change, Tag extends string> = {
    state: State;
    save: (v: State) => void;
    listeners: (() => void)[];
    previewState: null | State;
    scheduled?: ScheduledTask;
    listenersByPath: PathListenerNode;
    queuedChanges: QueuedChanges<Change, Tag>;
    previewPaths: Record<string, Path>;
    watches: Map<string, () => void>;
};

type ContextHistory = {
    historyListeners: (() => void)[];
    historyUp: (() => void)[];
};

type CH<T, An, Tag extends string = 'type'> = ContextBase<History<T, An>, T, Tag> & ContextHistory;

export type RemixStateContext<T, Tag extends string = 'type'> = {
    latest(): T;
    watch<V>(
        handle: RemixHandle,
        node: PatchBuilderInternal<unknown, V, Tag, unknown, Context>,
    ): WatchedValue<V>;
    read<V>(node: PatchBuilderInternal<unknown, V, Tag, unknown, Context>): V;
    clearPreview(): void;
    dispatch(v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming): void;
    $: RemixUpdater<T, Tag>;
};

export type RemixHistoryContext<T, An, Tag extends string = 'type'> = RemixStateContext<T, Tag> & {
    history(): History<T, An>;
    watchHistory(handle: RemixHandle): WatchedValue<History<T, An>>;
    onHistoryChange(f: () => void): () => void;
    tip(): string;
    clearHistory(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    previewJump(id: string): void;
    updateAnnotations: PatchBuilderInternal<unknown, Annotations<An>, Tag, void, null>;
};

export type RemixStateContextFactory<T, Tag extends string = 'type'> = {
    provide(
        handle: RemixHandle,
        props: {initial: T; save?(value: T): void},
        contextKey?: unknown,
    ): RemixStateContext<T, Tag>;
    get(handle: RemixHandle, contextKey?: unknown): RemixStateContext<T, Tag>;
};

export type RemixHistoryContextFactory<T, An, Tag extends string = 'type'> = {
    provide(
        handle: RemixHandle,
        props: {initial: History<T, An>; save?(value: History<T, An>): void},
        contextKey?: unknown,
    ): RemixHistoryContext<T, An, Tag>;
    get(handle: RemixHandle, contextKey?: unknown): RemixHistoryContext<T, An, Tag>;
};

export const createStateContext = <T, Tag extends string = 'type'>(
    tag: Tag,
    equalFn: EqualFn = equal,
): RemixStateContextFactory<T, Tag> => {
    const key = function UmkehrRemixStateProvider() {};

    return {
        provide(handle, {initial, save}, contextKey = key) {
            const ctx: ContextBase<T, T, Tag> = {
                state: initial,
                save: (v) => save?.(v),
                listeners: [],
                previewState: null,
                listenersByPath: makePathListenerNode(),
                queuedChanges: [],
                previewPaths: {},
                watches: new Map(),
            };
            const runtime = makeStateRuntime(ctx, tag, equalFn);
            provideContext(handle, contextKey, runtime);
            return runtime;
        },
        get(handle, contextKey = key) {
            return getContext(handle, contextKey, 'createStateContext');
        },
    };
};

export const createHistoryContext = <T, An, Tag extends string = 'type'>(
    tag: Tag,
    equalFn: EqualFn = equal,
): RemixHistoryContextFactory<T, An, Tag> => {
    const key = function UmkehrRemixHistoryProvider() {};

    return {
        provide(handle, {initial, save}, contextKey = key) {
            const ctx: CH<T, An, Tag> = {
                state: initial,
                save: (v) => save?.(v),
                listeners: [],
                previewState: null,
                listenersByPath: makePathListenerNode(),
                historyListeners: [],
                historyUp: [],
                queuedChanges: [],
                previewPaths: {},
                watches: new Map(),
            };
            const runtime = makeHistoryRuntime(ctx, tag, equalFn);
            provideContext(handle, contextKey, runtime);
            return runtime;
        },
        get(handle, contextKey = key) {
            return getContext(handle, contextKey, 'createHistoryContext');
        },
    };
};

function provideContext<T>(handle: RemixHandle, key: unknown, value: T) {
    if (handle.context.set.length >= 2) {
        handle.context.set(key, value);
    } else {
        handle.context.set(value);
    }
}

function getContext<T>(handle: RemixHandle, key: unknown, name: string): T {
    try {
        const value = handle.context.get<T>(key);
        if (value == null) throw new Error('missing');
        return value;
    } catch {
        throw new Error(`${name} value must be read below its matching provider.`);
    }
}

function makeStateRuntime<T, Tag extends string>(
    ctx: ContextBase<T, T, Tag>,
    tag: Tag,
    equalFn: EqualFn,
): RemixStateContext<T, Tag> {
    const {dispatch, $} = makeDispatch(ctx, tag, equalFn);
    return {
        latest() {
            return ctx.state;
        },
        watch(handle, node) {
            return watchNode(ctx, handle, node);
        },
        read(node) {
            return readNode(node);
        },
        clearPreview() {
            clearPreviewState(ctx);
        },
        $,
        dispatch,
    };
}

function makeHistoryRuntime<T, An, Tag extends string>(
    ctx: CH<T, An, Tag>,
    tag: Tag,
    equalFn: EqualFn,
): RemixHistoryContext<T, An, Tag> {
    const {dispatch, $, updateAnnotations} = makeHistoryDispatch(ctx, tag, equalFn);
    return {
        latest() {
            return ctx.state.current;
        },
        history() {
            return ctx.state;
        },
        watch(handle, node) {
            return watchNode(ctx, handle, node);
        },
        watchHistory(handle) {
            const key = `history:${handle.id}`;
            if (!ctx.watches.has(key)) {
                const listener = () => handle.update();
                ctx.historyUp.push(listener);
                const cleanup = () => {
                    const at = ctx.historyUp.indexOf(listener);
                    if (at !== -1) ctx.historyUp.splice(at, 1);
                    ctx.watches.delete(key);
                };
                ctx.watches.set(key, cleanup);
                handle.signal.addEventListener('abort', cleanup, {once: true});
            }
            return {
                get current() {
                    return ctx.state;
                },
            };
        },
        read(node) {
            return readNode(node);
        },
        onHistoryChange(f) {
            ctx.historyListeners.push(f);
            return () => {
                const at = ctx.historyListeners.indexOf(f);
                if (at !== -1) ctx.historyListeners.splice(at, 1);
            };
        },
        tip() {
            return ctx.state.tip;
        },
        clearHistory() {
            ctx.state = clearHistory(ctx.state);
            ctx.save(ctx.state);
            ctx.historyListeners.forEach((f) => f());
            ctx.historyUp.forEach((f) => f());
        },
        canRedo() {
            return ctx.state.undoTrail.length > 0;
        },
        canUndo() {
            return ctx.state.tip !== ctx.state.root;
        },
        undo() {
            dispatch({op: 'undo'});
        },
        redo() {
            dispatch({op: 'redo'});
        },
        clearPreview() {
            clearPreviewState(ctx);
        },
        previewJump(id: string) {
            const {history: next, changedPaths} = jumpWithChangedPaths(ctx.state, id, equalFn);
            replacePreviewState(ctx, next, changedPaths);
        },
        $,
        updateAnnotations,
        dispatch,
    };
}

function readNode<V, Tag extends PropertyKey>(
    node: PatchBuilderInternal<unknown, V, Tag, unknown, Context>,
): V {
    const path = getPath(node);
    const extra = getExtra(node);
    return extra.getForPath<V>(path);
}

function watchNode<State, Change, Tag extends string, V>(
    ctx: ContextBase<State, Change, Tag>,
    handle: RemixHandle,
    node: PatchBuilderInternal<unknown, V, Tag, unknown, Context>,
): WatchedValue<V> {
    const path = getPath(node);
    const extra = getExtra(node);
    const watchKey = `${handle.id}:${path.map((seg) => JSON.stringify(seg)).join('/')}`;
    if (!ctx.watches.has(watchKey)) {
        const cleanup = extra.listenToPath(path, () => handle.update());
        const remove = () => {
            cleanup();
            ctx.watches.delete(watchKey);
        };
        ctx.watches.set(watchKey, remove);
        handle.signal.addEventListener('abort', remove, {once: true});
    }
    return {
        get current() {
            return extra.getForPath<V>(path);
        },
    };
}

function makeDispatch<T, Tag extends string = 'type'>(
    ctx: ContextBase<T, T, Tag>,
    tag: Tag,
    equalFn: EqualFn = equal,
) {
    const extra = makeContextForPath(() => ctx.previewState ?? ctx.state, ctx.listenersByPath);
    const go = (v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming) => {
        if (when === 'preview') {
            ctx.queuedChanges.push(...(asFlat(v) as DraftPatch<T, Tag, Context>[]));
            if (ctx.scheduled == null) {
                ctx.scheduled = scheduleTask(() => {
                    ctx.scheduled = undefined;
                    const queue = ctx.queuedChanges;
                    ctx.queuedChanges = [];

                    const {current: next, changes} = resolveAndApply(
                        ctx.previewState ?? ctx.state,
                        queue,
                        extra,
                        tag,
                        equalFn,
                    );

                    if (next === (ctx.previewState ?? ctx.state)) return;
                    const paths = changedPaths(changes);
                    ctx.previewState = next;
                    recordPreviewPaths(ctx.previewPaths, paths);
                    ctx.listeners.forEach((f) => f());
                    notifyPaths(ctx.listenersByPath, paths);
                });
            }
            return;
        }

        const previewPaths = Object.values(ctx.previewPaths);
        const hadPreview = previewPaths.length > 0;
        ctx.previewState = null;
        ctx.previewPaths = {};
        ctx.queuedChanges = [];
        cancelScheduledTask(ctx.scheduled);
        ctx.scheduled = undefined;

        const {current: next, changes} = resolveAndApply(ctx.state, v, extra, tag, equalFn);
        if (next === ctx.state) return;
        const pathTargets = changedPaths(changes);
        ctx.state = next;
        ctx.save(ctx.state);

        ctx.listeners.forEach((f) => f());
        if (hadPreview) {
            notifyPaths(ctx.listenersByPath, [...previewPaths, ...pathTargets]);
        } else {
            notifyPaths(ctx.listenersByPath, pathTargets);
        }
    };

    return {
        dispatch: go,
        $: createPatchDispatcher<T, Context, Tag>(go, extra, tag),
    };
}

function makeHistoryDispatch<T, An, Tag extends string = 'type'>(
    ctx: CH<T, An, Tag>,
    tag: Tag,
    equalFn: EqualFn = equal,
) {
    const extra = makeContextForPath(
        () => ctx.previewState?.current ?? ctx.state.current,
        ctx.listenersByPath,
    );
    const go = (
        v:
            | {op: 'undo' | 'redo'}
            | {op: 'jump'; id: string}
            | MaybeNested<DraftPatch<T, Tag, Context>>,
        when?: ApplyTiming,
    ) => {
        let hChanged = false;
        if (when === 'preview') {
            if (!Array.isArray(v) && (v.op === 'undo' || v.op === 'redo' || v.op === 'jump')) {
                return;
            }
            ctx.queuedChanges.push(...(asFlat(v) as DraftPatch<T, Tag, Context>[]));
            if (ctx.scheduled == null) {
                ctx.scheduled = scheduleTask(() => {
                    ctx.scheduled = undefined;
                    const queue = ctx.queuedChanges;
                    ctx.queuedChanges = [];
                    const {history: next, changedPaths: paths} = dispatchWithChangedPaths(
                        ctx.previewState ?? ctx.state,
                        queue,
                        extra,
                        tag,
                        equalFn,
                    );
                    if (next === ctx.state) return;
                    ctx.previewState = next;
                    recordPreviewPaths(ctx.previewPaths, paths);
                    ctx.listeners.forEach((f) => f());
                    notifyPaths(ctx.listenersByPath, paths);
                });
            }
            return;
        }

        const previewPaths = Object.values(ctx.previewPaths);
        const hadPreview = previewPaths.length > 0;
        ctx.previewState = null;
        ctx.previewPaths = {};
        ctx.queuedChanges = [];
        cancelScheduledTask(ctx.scheduled);
        ctx.scheduled = undefined;

        const {
            history: next,
            changedPaths: pathTargets,
            changedHistory,
        } = dispatchWithChangedPaths(ctx.state, v, extra, tag, equalFn);
        if (next === ctx.state) return;
        hChanged = changedHistory;
        ctx.state = next;
        ctx.save(ctx.state);

        ctx.listeners.forEach((f) => f());
        if (hadPreview) {
            notifyPaths(ctx.listenersByPath, [...previewPaths, ...pathTargets]);
        } else {
            notifyPaths(ctx.listenersByPath, pathTargets);
        }

        if (hChanged) {
            ctx.historyListeners.forEach((f) => f());
        }
        ctx.historyUp.forEach((f) => f());
    };

    const updateAnnotations = createPatchDispatcher<Annotations<An>, null, Tag>(
        (v: MaybeNested<DraftPatch<Annotations<An>, Tag, null>>) => {
            const {current: next} = resolveAndApply<Annotations<An>, null, Tag>(
                ctx.state.annotations,
                v,
                null,
                tag,
                equalFn,
            );
            ctx.state.annotations = next;
            ctx.save(ctx.state);
            ctx.historyUp.forEach((f) => f());
        },
        null,
        tag,
    );

    return {
        dispatch: go,
        $: createPatchDispatcher<T, Context, Tag>(go, extra, tag),
        updateAnnotations,
    };
}

const clearHistory = <T, An>(h: History<T, An>): History<T, An> => ({
    ...h,
    undoTrail: [],
    initial: h.current,
    tip: h.root,
    nodes: {[h.root]: h.nodes[h.root]},
});
