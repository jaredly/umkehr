import equal from 'fast-deep-equal';
import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {createPatchDispatcher} from '../helper.js';
import {
    type Annotations,
    dispatchWithChangedPaths,
    type History,
    jumpWithChangedPaths,
} from '../history/history.js';
import {type EqualFn} from '../internal.js';
import {asFlat, type MaybeNested, resolveAndApply} from '../make.js';
import type {Updater} from '../react/Updater.js';
import type {ApplyTiming, DraftPatch, Path} from '../types.js';
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
    useValue,
    type Context,
    type PathListenerNode,
    type ScheduledTask,
} from '../react-core/index.js';
import {useLatest} from './useLatest.js';

export {useValue};
export type {Context};

type C<T> = {
    state: T;
    save: (v: T) => void;
    listeners: (() => void)[];
};

type ContextBase<T, Change, Tag extends string> = {
    state: T;
    save: (v: T) => void;
    listeners: (() => void)[];
    previewState: null | T;
    scheduled?: ScheduledTask;
    listenersByPath: PathListenerNode;
    queuedChanges: QueuedChanges<Change, Tag>;
    previewPaths: Record<string, Path>;
};

type ContextHistory = {
    historyListeners: (() => void)[];
    historyUp: (() => void)[];
};

type QueuedChanges<T, Tag extends string = 'type'> = DraftPatch<T, Tag, Context>[];

type CH<T, An, Tag extends string = 'type'> = ContextBase<History<T, An>, T, Tag> & ContextHistory;

const makeHistoryProvider = <T, An, Tag extends string = 'type'>(
    Ctx: React.Context<CH<T, An, Tag>>,
) => {
    return function Provide({
        children,
        initial,
        save,
    }: {
        children: React.ReactElement;
        initial: History<T, An>;
        save?(v: History<T, An>): void;
    }) {
        const l = useLatest(save);
        const value = useRef<CH<T, An, Tag>>({
            state: initial,
            save: (v) => l.current?.(v),
            listeners: [],
            previewState: null,
            listenersByPath: makePathListenerNode(),
            historyListeners: [],
            historyUp: [],
            queuedChanges: [],
            previewPaths: {},
        });
        useEffect(() => {
            if (initial !== value.current.state) {
                value.current.state = initial;
                value.current.listeners.forEach((f) => f());
                notifyAllPaths(value.current.listenersByPath);
            }
        }, [initial]);
        return <Ctx.Provider value={value.current} children={children} />;
    };
};

const makeProvider = <T, Tag extends string = 'type'>(
    Ctx: React.Context<ContextBase<T, T, Tag>>,
) => {
    return function Provide({
        children,
        initial,
        save,
    }: {
        children: React.ReactElement;
        initial: T;
        save?(v: T): void;
    }) {
        const l = useLatest(save);
        const value = useRef<ContextBase<T, T, Tag>>({
            state: initial,
            save: (v) => l.current?.(v),
            listeners: [],
            previewState: null,
            listenersByPath: makePathListenerNode(),
            queuedChanges: [],
            previewPaths: {},
        });
        useEffect(() => {
            if (initial !== value.current.state) {
                value.current.state = initial;
                value.current.listeners.forEach((f) => f());
                notifyAllPaths(value.current.listenersByPath);
            }
        }, [initial]);
        return <Ctx.Provider value={value.current} children={children} />;
    };
};

export const createHistoryContext = <T, An, Tag extends string = 'type'>(
    tag: Tag,
    equalFn: EqualFn = equal,
) => {
    const Ctx = createContext<CH<T, An, Tag>>(null as any);

    return [
        makeHistoryProvider(Ctx),

        function useStateContext() {
            const ctx = useContext(Ctx);
            if (ctx === null) {
                throw new Error(
                    `createHistoryContext hook must be used within its matching Provider.`,
                );
            }

            return useMemo(() => {
                const {dispatch, $, updateAnnotations} = makeHistoryDispatch(ctx, tag, equalFn);

                return {
                    onHistoryChange(f: () => void) {
                        ctx.historyListeners.push(f);
                        return () => {
                            const at = ctx.historyListeners.indexOf(f);
                            if (at !== -1) ctx.historyListeners.splice(at, 1);
                        };
                    },
                    latest() {
                        return ctx.state.current;
                    },
                    useHistory() {
                        const [tick, setTick] = useState(0);
                        useEffect(() => {
                            const f = () => setTick((t) => t + 1);
                            ctx.historyUp.push(f);
                            return () => {
                                const at = ctx.historyUp.indexOf(f);
                                if (at !== -1) ctx.historyUp.splice(at, 1);
                            };
                        }, []);
                        return ctx.state;
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
                        const {history: next, changedPaths} = jumpWithChangedPaths(
                            ctx.state,
                            id,
                            equalFn,
                        );
                        replacePreviewState(ctx, next, changedPaths);
                    },
                    $,
                    updateAnnotations,
                    dispatch,
                };
            }, [ctx, tag]);
        },
    ] as const;
};

const makeDispatch = <T, Tag extends string = 'type'>(
    ctx: ContextBase<T, T, Tag>,
    tag: Tag,
    equalFn: EqualFn = equal,
) => {
    // const inner = ctx;
    const extra = makeContextForPath(() => ctx.previewState ?? ctx.state, ctx.listenersByPath);
    const go = (v: MaybeNested<DraftPatch<T, Tag, Context>>, when?: ApplyTiming) => {
        if (when === 'preview') {
            ctx.queuedChanges.push(...(asFlat(v) as DraftPatch<T, Tag, Context>[]));
            if (ctx.scheduled == null) {
                ctx.scheduled = scheduleTask(() => {
                    ctx.scheduled = undefined;
                    // const base = inner.previewState ?? inner.state.current;
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
};

const makeHistoryDispatch = <T, An, Tag extends string = 'type'>(
    ctx: ContextBase<History<T, An>, T, Tag> & ContextHistory,
    tag: Tag,
    equalFn: EqualFn = equal,
) => {
    // const inner = ctx;
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
                return; // not previewing those
            }
            ctx.queuedChanges.push(...(asFlat(v) as DraftPatch<T, Tag, Context>[]));
            if (ctx.scheduled == null) {
                ctx.scheduled = scheduleTask(() => {
                    ctx.scheduled = undefined;
                    // const base = inner.previewState?.current ?? inner.state.current;
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
};

const clearHistory = <T, An>(h: History<T, An>): History<T, An> => ({
    ...h,
    undoTrail: [],
    initial: h.current,
    tip: h.root,
    nodes: {[h.root]: h.nodes[h.root]},
});

export const createStateContext = <T, Tag extends string = 'type'>(
    tag: Tag,
    equalFn: EqualFn = equal,
) => {
    const Ctx = createContext<ContextBase<T, T, Tag>>(null as any);

    return [
        makeProvider(Ctx),

        function useStateContext() {
            const ctx = useContext(Ctx);
            if (ctx === null) {
                throw new Error(
                    `createStateContext hook must be used within its matching Provider.`,
                );
            }

            return useMemo(() => {
                const {dispatch, $} = makeDispatch(ctx, tag, equalFn);

                return {
                    latest() {
                        return ctx.state;
                    },
                    clearPreview() {
                        clearPreviewState(ctx);
                    },
                    $,
                    dispatch,
                };
            }, [ctx, tag]);
        },
    ] as const;
};

export type {Updater};
