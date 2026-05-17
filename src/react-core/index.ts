import {useEffect, useState} from 'react';
import {deepEqual as equal} from '../deepEqual.js';
import {getExtra, getPath} from '../helper.js';
import {type EqualFn} from '../internal.js';
import type {PatchBuilderInternal} from '../types.js';
import {useLatest} from '../react/useLatest.js';
import type {Context} from '../framework-core/index.js';

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

export const useValue: (<Current, Return, Tag extends PropertyKey>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context>,
    mod: (v: Current) => Return,
    exact?: boolean,
    equalFn?: EqualFn,
) => Return) &
    (<Current, Tag extends PropertyKey>(
        node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context>,
    ) => Current) = <Current, Return, Tag extends PropertyKey>(
    node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context>,
    mod: (v: Current) => Return = (v) => v as any,
    exact = true,
    equalFn: EqualFn = equal,
) => {
    const path = getPath(node);
    const extra = getExtra(node);
    const [v, setV] = useState(() => mod(extra.getForPath<Current>(path)));
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
        [extra, path, lv, lmod, exact, equalFn],
    );
    return v;
};
