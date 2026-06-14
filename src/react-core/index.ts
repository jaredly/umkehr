import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {deepEqual as equal} from '../deepEqual.js';
import {getExtra, getPath} from '../helper.js';
import {type EqualFn} from '../internal.js';
import {pathToString, type PatchBuilderInternal} from '../types.js';
import {useLatest} from '../react/useLatest.js';
import type {Context} from '../framework-core/index.js';
import type {LeafBuilderExtensionAny} from '../builderExtensions.js';
import type {Status, StatusQuery, StatusStore} from '../statuses.js';

export {
    addPathListener,
    cancelScheduledTask,
    changedPaths,
    clearPreviewState,
    collectAllPathListeners,
    makeContextForPath,
    makePathListenerNode,
    notifyAllPaths,
    notifyPaths,
    recordPreviewPaths,
    removePathListener,
    replacePreviewState,
    scheduleTask,
    segmentKey,
    type Context,
    type PathListener,
    type PathListenerNode,
    type PreviewContextBase,
    type ScheduledTask,
} from '../framework-core/index.js';

export const useResettingState = <T>(f: () => T, r: unknown[]) => {
    const [_t, setT] = useState(0);
    const v = useMemo(() => ({current: f()}), r);
    const setV = useCallback(
        (nv: T) => {
            if (!equal(v.current, nv)) {
                v.current = nv;
                setT((t) => t + 1);
            }
        },
        [v],
    );
    return [v.current, setV] as const;
};

export function useValue<
    Current,
    Return,
    Tag extends PropertyKey,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
    mod: (v: Current) => Return,
    exact?: boolean,
    equalFn?: EqualFn,
): Return;
export function useValue<
    Current,
    Tag extends PropertyKey,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>): Current;
export function useValue<
    Current,
    Return,
    Tag extends PropertyKey,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
    mod: (v: Current) => Return = (v) => v as any,
    exact = true,
    equalFn: EqualFn = equal,
) {
    const path = getPath(node);
    const extra = getExtra(node);
    const [v, setV] = useResettingState(() => mod(extra.getForPath<Current>(path)), [path]);
    const lv = useLatest(v);
    const lmod = useLatest(mod);
    useEffect(
        () =>
            extra.listenToPath(path, () => {
                const nw = lmod.current(extra.getForPath<Current>(path));
                if (exact ? !equalFn(lv.current, nw) : lv.current !== nw) {
                    lv.current = nw;
                    setV(nw);
                }
            }),
        [extra, path, lv, lmod, exact, equalFn, setV],
    );
    return v;
}

export function useStatusesFromStore<
    Current,
    Tag extends PropertyKey,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
    store: StatusStore,
    query?: StatusQuery,
): Status[] {
    const path = getPath(node);
    const [statuses, setStatuses] = useState(() => store.get(path, query));
    const latestStatuses = useLatest(statuses);
    useEffect(() => {
        const current = store.get(path, query);
        if (!equal(latestStatuses.current, current)) {
            latestStatuses.current = current;
            setStatuses(current);
        }
        return store.subscribe(path, query, (next) => {
            if (!equal(latestStatuses.current, next)) {
                latestStatuses.current = next;
                setStatuses(next);
            }
        });
    }, [store, path, query, latestStatuses]);
    return statuses;
}

export function useStatuses<
    Current,
    Tag extends PropertyKey,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
    query?: StatusQuery,
): Status[] {
    const extra = getExtra(node);
    const store = extra.getStatusStore?.();
    if (!store) {
        throw new Error(`useStatuses requires a status store in the patch builder context.`);
    }
    return useStatusesFromStore(node, store, query);
}
