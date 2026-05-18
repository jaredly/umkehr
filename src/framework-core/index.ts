import {_get} from '../internal.js';
import {pathToString} from '../types.js';
import type {DraftPatch, Patch, Path, PathSegment} from '../types.js';
import type {StatusStore} from '../statuses.js';

export type Context = {
    getForPath<T>(v: Path): T;
    listenToPath(v: Path, f: () => void): () => void;
    getStatusStore?(): StatusStore;
};

export type PathListener = () => void;

export type PathListenerNode = {
    listeners: Set<PathListener>;
    children: Map<string, PathListenerNode>;
};

export type ScheduledTask =
    | {kind: 'raf'; id: number}
    | {kind: 'timeout'; id: ReturnType<typeof setTimeout>};

export type PreviewContextBase<T, Change, Tag extends string> = {
    listeners: (() => void)[];
    previewState: null | T;
    scheduled?: ScheduledTask;
    listenersByPath: PathListenerNode;
    queuedChanges: DraftPatch<Change, Tag, Context>[];
    previewPaths: Record<string, Path>;
};

export const scheduleTask = (task: () => void): ScheduledTask => {
    if (typeof requestAnimationFrame === 'function') {
        return {kind: 'raf', id: requestAnimationFrame(task)};
    }
    return {kind: 'timeout', id: setTimeout(task, 0)};
};

export const cancelScheduledTask = (task: ScheduledTask | undefined) => {
    if (!task) return;
    if (task.kind === 'raf' && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(task.id);
        return;
    }
    if (task.kind === 'timeout') {
        clearTimeout(task.id);
    }
};

export const makePathListenerNode = (): PathListenerNode => ({
    listeners: new Set(),
    children: new Map(),
});

export const segmentKey = (seg: PathSegment) => {
    switch (seg.type) {
        case 'key':
            return `k:${typeof seg.key === 'number' ? `n:${seg.key}` : `s:${seg.key}`}`;
        case 'tag':
            return `t:${seg.key}=${seg.value}`;
    }
};

export const addPathListener = (root: PathListenerNode, path: Path, listener: PathListener) => {
    let node = root;
    for (const seg of path) {
        const key = segmentKey(seg);
        let child = node.children.get(key);
        if (!child) {
            child = makePathListenerNode();
            node.children.set(key, child);
        }
        node = child;
    }
    node.listeners.add(listener);
};

export const removePathListener = (root: PathListenerNode, path: Path, listener: PathListener) => {
    const stack: Array<{node: PathListenerNode; key?: string}> = [{node: root}];
    let node = root;
    for (const seg of path) {
        const key = segmentKey(seg);
        const child = node.children.get(key);
        if (!child) return;
        stack.push({node: child, key});
        node = child;
    }
    node.listeners.delete(listener);
    for (let i = stack.length - 1; i > 0; i--) {
        const {node: child, key} = stack[i];
        const parent = stack[i - 1].node;
        if (child.children.size === 0 && child.listeners.size === 0) {
            parent.children.delete(key as string);
        }
    }
};

export const collectAllPathListeners = (
    node: PathListenerNode | undefined,
    out: Set<PathListener>,
) => {
    if (!node) return;
    node.listeners.forEach((l) => out.add(l));
    node.children.forEach((child) => collectAllPathListeners(child, out));
};

export const notifyPaths = (root: PathListenerNode, paths: Path[]) => {
    if (!paths.length) return;
    const listeners = new Set<PathListener>();
    paths.forEach((p) => {
        let node: PathListenerNode | undefined = root;
        node.listeners.forEach((l) => listeners.add(l));
        for (const seg of p) {
            node = node?.children.get(segmentKey(seg));
            if (!node) break;
            node.listeners.forEach((l) => listeners.add(l));
        }
        collectAllPathListeners(node, listeners);
    });
    listeners.forEach((l) => l());
};

export const notifyAllPaths = (root: PathListenerNode) => {
    const listeners = new Set<PathListener>();
    collectAllPathListeners(root, listeners);
    listeners.forEach((l) => l());
};

export const changedPaths = (changes: Patch<unknown>[]) => {
    const paths: Path[] = [];
    changes.forEach((op) => {
        paths.push(op.path);
        if (op.op === 'move') paths.push(op.from);
    });
    return paths;
};

export const recordPreviewPaths = (previewPaths: Record<string, Path>, paths: Path[]) => {
    paths.forEach((path) => {
        previewPaths[pathToString(path)] = path;
    });
};

export const makeContextForPath = <State>(
    getState: () => State,
    listenersByPath: PathListenerNode,
    getStatusStore?: () => StatusStore,
): Context => ({
    getForPath(path) {
        return _get(getState(), path);
    },
    listenToPath(path, f) {
        addPathListener(listenersByPath, path, f);
        return () => removePathListener(listenersByPath, path, f);
    },
    getStatusStore,
});

export const clearPreviewState = <T, Change, Tag extends string>(
    ctx: PreviewContextBase<T, Change, Tag>,
): boolean => {
    const previewPaths = Object.values(ctx.previewPaths);
    const hadPreview = previewPaths.length > 0;
    ctx.previewState = null;
    ctx.previewPaths = {};
    ctx.queuedChanges = [];
    cancelScheduledTask(ctx.scheduled);
    ctx.scheduled = undefined;
    if (hadPreview) {
        ctx.listeners.forEach((f) => f());
        notifyPaths(ctx.listenersByPath, previewPaths);
    }
    return hadPreview;
};

export const replacePreviewState = <T, Change, Tag extends string>(
    ctx: PreviewContextBase<T, Change, Tag>,
    previewState: T,
    paths: Path[],
) => {
    const previewPaths = Object.values(ctx.previewPaths);
    ctx.previewState = previewState;
    ctx.previewPaths = {};
    ctx.queuedChanges = [];
    cancelScheduledTask(ctx.scheduled);
    ctx.scheduled = undefined;
    recordPreviewPaths(ctx.previewPaths, paths);
    ctx.listeners.forEach((f) => f());
    notifyPaths(ctx.listenersByPath, [...previewPaths, ...paths]);
};
