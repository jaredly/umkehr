import {splitPathToDestination} from './findHistoryJump';
import type {Patch, DraftPatch} from '../types';
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

function undo<T, An>(state: History<T, An>, equal: EqualFn) {
    if (state.tip === state.root) return state;
    const node = state.nodes[state.tip];
    return {
        ...state,
        tip: node.pid,
        undoTrail: [state.tip, ...state.undoTrail],
        current: node.changes
            .toReversed()
            .map(ops.invert)
            .reduce((a, b) => ops.apply(a, b, equal), state.current),
    };
}

function redo<T, An>(state: History<T, An>, equal: EqualFn) {
    if (!state.undoTrail.length) return state;
    const next = state.undoTrail[0];
    if (!next || !state.nodes[next]) {
        throw new Error(`Cannot redo: undo trail references missing history node "${next}".`);
    }
    return {
        ...state,
        undoTrail: state.undoTrail.slice(1),
        tip: next,
        current: state.nodes[next].changes.reduce((a, b) => ops.apply(a, b, equal), state.current),
    };
}

export const jump = <T, An>(state: History<T, An>, to: string, equal: EqualFn): History<T, An> => {
    if (!state.nodes[to]) throw new Error(`Cannot jump: unknown history node "${to}".`);
    const split = splitPathToDestination(state, to);
    let current = split.up
        .flatMap((id) => state.nodes[id].changes.map(ops.invert).toReversed())
        .reduce((a, b) => ops.apply(a, b, equal), state.current);
    current = split.down
        .flatMap((id) => state.nodes[id].changes)
        .reduce((a, b) => ops.apply(a, b, equal), current);
    return {...state, current, tip: to, undoTrail: []};
};

export const dispatch = <T, An, Extra, Tag extends string = 'type'>(
    state: History<T, An>,
    nested:
        | {op: 'undo' | 'redo'}
        | {op: 'jump'; id: string}
        | MaybeNested<DraftPatch<T, Tag, Extra>>,
    extra: Extra,
    tag: Tag,
    equal: EqualFn,
    genId = randId,
): History<T, An> => {
    if (!Array.isArray(nested)) {
        if (nested.op === 'undo') {
            return undo(state, equal);
        } else if (nested.op === 'redo') {
            return redo(state, equal);
        } else if (nested.op === 'jump') {
            return jump(state, nested.id, equal);
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

    return {
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
};
