import {splitPathToDestination} from './findHistoryJump';
import type {Patch, DraftPatch, Path} from '../types';
import {resolveAndApply} from '../make';
import {ops} from '../ops';
import type {EqualFn} from '../internal';

type HistoryNode<T, An> = {
    id: string;
    changes: Patch<T>[];
    pid: string;
    children: string[];
};

export type Annotations<An> = Record<string, Record<string, An>>;

export type History<T, An> = {
    version: 2;
    initial: T;
    nodes: Record<string, HistoryNode<T, An>>;
    annotations: Annotations<An>;
    root: string;
    tip: string;
    current: T;
    undoTrail: string[];
};

export function blankHistory<T, An = never>(v: T): History<T, An> {
    return {
        version: 2,
        current: v,
        initial: v,
        nodes: {root: {changes: [], children: [], id: 'root', pid: 'root'}},
        annotations: {},
        root: 'root',
        tip: 'root',
        undoTrail: [],
    };
}

type MaybeNested<T> = T | MaybeNested<T>[];

const randId = () => Math.random().toString(36).slice(2);

type HistoryCommand = {op: 'undo' | 'redo'} | {op: 'jump'; id: string};

export type HistoryDispatchResult<T, An> = {
    history: History<T, An>;
    changedPaths: Path[];
    changedHistory: boolean;
};

const changedPaths = (changes: Patch<unknown>[]) => {
    const paths: Path[] = [];
    changes.forEach((op) => {
        paths.push(op.path);
        if (op.op === 'move') paths.push(op.from);
    });
    return paths;
};

function undoWithChangedPaths<T, An>(
    state: History<T, An>,
    equal: EqualFn,
): HistoryDispatchResult<T, An> {
    if (state.tip === state.root) {
        return {history: state, changedPaths: [], changedHistory: false};
    }
    const node = state.nodes[state.tip];
    const history = {
        ...state,
        tip: node.pid,
        undoTrail: [state.tip, ...state.undoTrail],
        current: node.changes
            .toReversed()
            .map(ops.invert)
            .reduce((a, b) => ops.apply(a, b, equal), state.current),
    };
    return {history, changedPaths: changedPaths(node.changes), changedHistory: false};
}

function redoWithChangedPaths<T, An>(
    state: History<T, An>,
    equal: EqualFn,
): HistoryDispatchResult<T, An> {
    if (!state.undoTrail.length) {
        return {history: state, changedPaths: [], changedHistory: false};
    }
    const next = state.undoTrail[0];
    if (!next || !state.nodes[next]) {
        throw new Error(`Cannot redo: undo trail references missing history node "${next}".`);
    }
    const node = state.nodes[next];
    const history = {
        ...state,
        undoTrail: state.undoTrail.slice(1),
        tip: next,
        current: node.changes.reduce((a, b) => ops.apply(a, b, equal), state.current),
    };
    return {history, changedPaths: changedPaths(node.changes), changedHistory: false};
}

export const jumpWithChangedPaths = <T, An>(
    state: History<T, An>,
    to: string,
    equal: EqualFn,
): HistoryDispatchResult<T, An> => {
    if (!state.nodes[to]) throw new Error(`Cannot jump: unknown history node "${to}".`);
    const split = splitPathToDestination(state, to);
    const upChanges = split.up.flatMap((id) => state.nodes[id].changes);
    const downChanges = split.down.flatMap((id) => state.nodes[id].changes);
    let current = upChanges
        .map(ops.invert)
        .toReversed()
        .reduce((a, b) => ops.apply(a, b, equal), state.current);
    current = downChanges.reduce((a, b) => ops.apply(a, b, equal), current);
    return {
        history: {...state, current, tip: to, undoTrail: []},
        changedPaths: changedPaths([...upChanges, ...downChanges]),
        changedHistory: false,
    };
};

export const jump = <T, An>(state: History<T, An>, to: string, equal: EqualFn): History<T, An> =>
    jumpWithChangedPaths(state, to, equal).history;

export const dispatchWithChangedPaths = <T, An, Extra, Tag extends string = 'type'>(
    state: History<T, An>,
    nested: HistoryCommand | MaybeNested<DraftPatch<T, Tag, Extra>>,
    extra: Extra,
    tag: Tag,
    equal: EqualFn,
    genId = randId,
): HistoryDispatchResult<T, An> => {
    if (!Array.isArray(nested)) {
        if (nested.op === 'undo') {
            return undoWithChangedPaths(state, equal);
        } else if (nested.op === 'redo') {
            return redoWithChangedPaths(state, equal);
        } else if (nested.op === 'jump') {
            return jumpWithChangedPaths(state, nested.id, equal);
        }
    }

    const id = genId();
    const node = state.nodes[state.tip];

    const {current, changes} = resolveAndApply(
        state.current,
        nested as MaybeNested<DraftPatch<T, Tag, Extra>>,
        extra,
        tag,
        equal,
    );

    const history = {
        ...state,
        tip: id,
        nodes: {
            ...state.nodes,
            [id]: {id, pid: state.tip, changes, children: []},
            [node.id]: {...node, children: node.children.concat([id])},
        },
        undoTrail: [],
        current,
    };
    return {history, changedPaths: changedPaths(changes), changedHistory: true};
};

export const dispatch = <T, An, Extra, Tag extends string = 'type'>(
    state: History<T, An>,
    nested: HistoryCommand | MaybeNested<DraftPatch<T, Tag, Extra>>,
    extra: Extra,
    tag: Tag,
    equal: EqualFn,
    genId = randId,
): History<T, An> =>
    dispatchWithChangedPaths(state, nested, extra, tag, equal, genId).history;
