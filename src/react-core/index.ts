import equal from 'fast-deep-equal';
import {useEffect, useState} from 'react';
import {getExtra, getPath} from '../helper.js';
import {_get, type EqualFn} from '../internal.js';
import {pathToString} from '../types.js';
import type {DraftPatch, Patch, PatchBuilderInternal, Path, PathSegment} from '../types.js';
import {useLatest} from '../react/useLatest.js';

export type Context = {
    getForPath<T>(v: Path): T;
    listenToPath(v: Path, f: () => void): () => void;
};

export type PathListener = () => void;

export type PathListenerNode = {
    listeners: Set<PathListener>;
    children: Map<string, PathListenerNode>;
};

export type PreviewContextBase<T, Change, Tag extends string> = {
    listeners: (() => void)[];
    previewState: null | T;
    raf?: number;
    listenersByPath: PathListenerNode;
    queuedChanges: DraftPatch<Change, Tag, Context>[];
    previewPaths: Record<string, Path>;
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

export const collectAllPathListeners = (node: PathListenerNode | undefined, out: Set<PathListener>) => {
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
): Context => ({
    getForPath(path) {
        return _get(getState(), path);
    },
    listenToPath(path, f) {
        addPathListener(listenersByPath, path, f);
        return () => removePathListener(listenersByPath, path, f);
    },
});

export const clearPreviewState = <T, Change, Tag extends string>(
    ctx: PreviewContextBase<T, Change, Tag>,
): boolean => {
    const previewPaths = Object.values(ctx.previewPaths);
    const hadPreview = previewPaths.length > 0;
    ctx.previewState = null;
    ctx.previewPaths = {};
    ctx.queuedChanges = [];
    if (ctx.raf != null) {
        cancelAnimationFrame(ctx.raf);
        ctx.raf = undefined;
    }
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
    if (ctx.raf != null) {
        cancelAnimationFrame(ctx.raf);
        ctx.raf = undefined;
    }
    recordPreviewPaths(ctx.previewPaths, paths);
    ctx.listeners.forEach((f) => f());
    notifyPaths(ctx.listenersByPath, [...previewPaths, ...paths]);
};

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
