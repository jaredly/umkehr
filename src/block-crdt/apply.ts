import equal from 'fast-deep-equal';
import {validateBlockOrderPath} from './blocks';
import {organizeState} from './cache';
import {compareLamports, compareLamportStrings, lamportToString} from './ids';
import {maxLamportCounterForOp} from './ops';
import {Block, CachedState, Lamport, Op} from './types';
import {blockOrderVersionWins, charParentVersionWins} from './versions';

export type ApplyResult =
    | {status: 'applied'; state: CachedState}
    | {status: 'ignored'; state: CachedState; reason: 'stale' | 'duplicate'}
    | {status: 'pending'; state: CachedState; missing: Lamport[]}
    | {status: 'invalid'; state: CachedState; error: Error};

export const charOp = (text: string, id: Lamport, after: Lamport, ts: string): Op => ({
    type: 'char',
    char: {text, id, deleted: false, parent: {id: after, ts: ''}},
});

export const applyRemote = (state: CachedState, op: Op): ApplyResult => {
    try {
        const result = apply(state, op);
        if (result === false) {
            return {status: 'pending', state, missing: missingDependenciesForOp(state, op)};
        }
        return result === state
            ? {status: 'ignored', state, reason: 'duplicate'}
            : {status: 'applied', state: result};
    } catch (error) {
        return {status: 'invalid', state, error: error instanceof Error ? error : new Error(String(error))};
    }
};

export const applyRemoteMany = (state: CachedState, ops: Op[]) => {
    const applied: Op[] = [];
    const ignored: {op: Op; reason: 'stale' | 'duplicate'}[] = [];
    const pending: {op: Op; missing: Lamport[]}[] = [];
    const invalid: {op: Op; error: Error}[] = [];

    for (const op of ops) {
        const result = applyRemote(state, op);
        if (result.status === 'applied') {
            state = result.state;
            applied.push(op);
        } else if (result.status === 'ignored') {
            state = result.state;
            ignored.push({op, reason: result.reason});
        } else if (result.status === 'pending') {
            pending.push({op, missing: result.missing});
        } else {
            invalid.push({op, error: result.error});
        }
    }

    return {state, applied, ignored, pending, invalid};
};

export const assertCacheConsistent = (state: CachedState) => {
    const expected = organizeState(state.state.blocks, state.state.chars, state.state.joins);
    if (!equal(state.cache, expected)) {
        throw new Error(`cached state is inconsistent`);
    }
};

export const applyStrict = (state: CachedState, op: Op): CachedState => {
    const result = apply(state, op);
    if (result === false) {
        throw new Error(`op was pending`);
    }
    return result;
};

export const apply = (state: CachedState, op: Op): CachedState | false => {
    switch (op.type) {
        case 'char':
            return applyChar(state, op);
        case 'block':
            return applyBlock(state, op);
        case 'block:delete':
            return applyBlockDelete(state, op);
        case 'char:move':
            return applyCharMove(state, op);
        case 'char:delete':
            return applyCharDelete(state, op);
        case 'block:move':
            return applyBlockMove(state, op);
        case 'block:meta':
            return applyBlockMeta(state, op);
        case 'mark':
            return applyMark(state, op);
        case 'split-record':
            return applySplitRecord(state, op);
        case 'join-record':
            return applyJoinRecord(state, op);
    }
};

export const applyMany = (state: CachedState, ops: Op[]) => {
    ops.forEach((op) => {
        state = applyStrict(state, op);
    });
    return state;
};

export const applyManyStrict = applyMany;

const applyMark = ({state, cache}: CachedState, op: Op & {type: 'mark'}): CachedState | false => {
    const id = lamportToString(op.mark.id);
    const current = state.marks[id];
    if (current) {
        if (!equal(current, op.mark)) {
            throw new Error(`re-insert of mark ${id} and the payload is different`);
        }
        return {state, cache};
    }
    return {
        state: {
            ...state,
            marks: {...state.marks, [id]: op.mark},
            maxSeenCount: Math.max(state.maxSeenCount, maxLamportCounterForOp(op)),
        },
        cache,
    };
};

const applySplitRecord = (
    {state, cache}: CachedState,
    op: Op & {type: 'split-record'},
): CachedState | false => {
    const id = lamportToString(op.split.id);
    const current = state.splits[id];
    if (current) {
        if (!equal(current, op.split)) {
            throw new Error(`re-insert of split ${id} and the payload is different`);
        }
        return {state, cache};
    }
    return {
        state: {
            ...state,
            splits: {...state.splits, [id]: op.split},
            maxSeenCount: Math.max(state.maxSeenCount, maxLamportCounterForOp(op)),
        },
        cache,
    };
};

const applyJoinRecord = (
    {state, cache}: CachedState,
    op: Op & {type: 'join-record'},
): CachedState | false => {
    const id = lamportToString(op.join.id);
    const current = state.joins[id];
    if (current) {
        if (!equal(current, op.join)) {
            throw new Error(`re-insert of join ${id} and the payload is different`);
        }
        return {state, cache};
    }
    const nextState = {
        ...state,
        joins: {...state.joins, [id]: op.join},
        maxSeenCount: Math.max(state.maxSeenCount, maxLamportCounterForOp(op)),
    };
    return {
        state: nextState,
        cache: organizeState(nextState.blocks, nextState.chars, nextState.joins),
    };
};

const applyCharDelete = (
    {state, cache}: CachedState,
    op: Op & {type: 'char:delete'},
): CachedState | false => {
    const {chars, blocks, marks, splits, joins, maxSeenCount} = state;
    const charId = lamportToString(op.id);
    let current = state.chars[charId];
    if (!current) {
        return false;
    }
    if (current.deleted) {
        return {state, cache};
    }
    current = {...current, deleted: true};
    return {
        state: {
            blocks,
            chars: {...chars, [charId]: current},
            marks,
            splits,
            joins,
            maxSeenCount: Math.max(maxSeenCount, maxLamportCounterForOp(op)),
        },
        cache,
    };
};

const applyCharMove = (
    {state, cache}: CachedState,
    op: Op & {type: 'char:move'},
): CachedState | false => {
    const {chars, blocks, marks, splits, joins, maxSeenCount} = state;
    const charId = lamportToString(op.id);
    let current = state.chars[charId];
    if (!current) {
        return false;
    }
    if (!parentExists({state, cache}, op.parent.id)) {
        return false;
    }
    if (!charParentVersionWins(op.parent.ts, current.parent.ts)) {
        return {state, cache};
    }
    const charContents = {...cache.charContents};
    const ppid = lamportToString(current.parent.id);
    removeFromCache(charContents, ppid, charId);
    current = {...current, parent: op.parent};
    const pid = lamportToString(op.parent.id);
    charContents[pid] = insertSortedRev((charContents[pid] ?? []).slice(), charId);
    return {
        state: {
            blocks,
            chars: {...chars, [charId]: current},
            marks,
            splits,
            joins,
            maxSeenCount: Math.max(maxSeenCount, maxLamportCounterForOp(op)),
        },
        cache: {
            ...cache,
            charContents,
        },
    };
};

const applyBlockDelete = (
    state: CachedState,
    op: Op & {type: 'block:delete'},
): CachedState | false => {
    const id = lamportToString(op.id);
    let current = state.state.blocks[id];
    if (!current) {
        return false;
    }
    if (current.deleted) {
        return state;
    }
    current = {...current, deleted: true};
    return {
        state: {
            ...state.state,
            blocks: {...state.state.blocks, [id]: current},
            maxSeenCount: Math.max(state.state.maxSeenCount, maxLamportCounterForOp(op)),
        },
        cache: state.cache,
    };
};

const applyBlockMove = (
    {state, cache}: CachedState,
    op: Op & {type: 'block:move'},
): CachedState | false => {
    const id = lamportToString(op.id);
    const current = state.blocks[id];
    if (!current) {
        return false;
    }
    const valid = validateBlockOrderPath(state.blocks, id, op.order);
    if (valid === false) {
        return false;
    }
    if (!blockOrderWins(op.order, current.order)) {
        return {state, cache};
    }

    const blocks = {...state.blocks, [id]: {...current, order: op.order}};
    const nextState = {
        ...state,
        blocks,
        maxSeenCount: Math.max(state.maxSeenCount, maxLamportCounterForOp(op)),
    };
    return {
        state: nextState,
        cache: organizeState(nextState.blocks, nextState.chars, nextState.joins),
    };
};

const applyBlockMeta = (
    {state, cache}: CachedState,
    op: Op & {type: 'block:meta'},
): CachedState | false => {
    const id = lamportToString(op.id);
    const current = state.blocks[id];
    if (!current) {
        return false;
    }
    if (op.meta.ts <= current.meta.ts) {
        return {state, cache};
    }
    return {
        state: {
            ...state,
            blocks: {...state.blocks, [id]: {...current, meta: op.meta}},
            maxSeenCount: Math.max(state.maxSeenCount, maxLamportCounterForOp(op)),
        },
        cache,
    };
};

const applyBlock = ({state}: CachedState, {block}: Op & {type: 'block'}): CachedState | false => {
    const id = lamportToString(block.id);
    const current = state.blocks[id];
    if (current) {
        if (current.meta.ts > block.meta.ts) {
            block = {...block, meta: current.meta};
        }
        if (!blockOrderWins(block.order, current.order)) {
            block = {...block, order: current.order};
        }
        block = {...block, deleted: current.deleted || block.deleted};
    }

    const blocks = {...state.blocks, [id]: block};
    const valid = validateBlockOrderPath(blocks, id, block.order);
    if (valid === false) {
        return false;
    }
    const nextState = {
        ...state,
        blocks,
        maxSeenCount: Math.max(state.maxSeenCount, maxLamportCounterForOp({type: 'block', block})),
    };
    return {
        state: nextState,
        cache: organizeState(nextState.blocks, nextState.chars, nextState.joins),
    };
};

const applyChar = ({state, cache}: CachedState, {char}: Op & {type: 'char'}) => {
    const {chars, blocks, marks, splits, joins, maxSeenCount} = state;
    const charId = lamportToString(char.id);
    const current = state.chars[charId];
    if (current) {
        if (current.text !== char.text) {
            throw new Error(`re-insert of ${charId} and the text is different`);
        }
        if (charParentVersionWins(current.parent.ts, char.parent.ts)) {
            char = {...char, parent: current.parent};
        }
        char = {...char, deleted: current.deleted};
    }
    const parentId = lamportToString(char.parent.id);
    if (!parentExists({state, cache}, char.parent.id)) {
        return false;
    }
    const charContents = {...cache.charContents};
    if (current) {
        const currentParentId = lamportToString(current.parent.id);
        removeFromCache(charContents, currentParentId, charId);
    }
    charContents[parentId] = insertSortedRev(charContents[parentId]?.slice() ?? [], charId);
    return {
        state: {
            blocks,
            chars: {...chars, [charId]: char},
            marks,
            splits,
            joins,
            maxSeenCount: Math.max(maxSeenCount, maxLamportCounterForOp({type: 'char', char})),
        },
        cache: {
            ...cache,
            charContents,
        },
    };
};

const blockOrderWins = (incoming: Block['order'], current: Block['order']) => {
    if (blockOrderVersionWins(incoming.ts, current.ts)) return true;
    if (blockOrderVersionWins(current.ts, incoming.ts)) return false;
    return compareLamports(incoming.id, current.id) < 0;
};

const removeFromCache = (cache: Record<string, string[]>, parentId: string, id: string) => {
    const next = (cache[parentId] ?? []).filter((item) => item !== id);
    if (next.length) {
        cache[parentId] = next;
    } else {
        delete cache[parentId];
    }
};

const insertSortedRev = (array: string[], item: string) => {
    for (let i = 0; i < array.length; i++) {
        if (compareLamportStrings(item, array[i]) > 0) {
            array.splice(i, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
};

const parentExists = (state: CachedState, id: Lamport): boolean => {
    const key = lamportToString(id);
    return Boolean(state.state.blocks[key] || state.state.chars[key] || state.cache.joinSentinels[key]);
};

const missingDependenciesForOp = (state: CachedState, op: Op): Lamport[] => {
    switch (op.type) {
        case 'char':
            return parentExists(state, op.char.parent.id) ? [] : [op.char.parent.id];
        case 'char:move': {
            const missing: Lamport[] = [];
            if (!state.state.chars[lamportToString(op.id)]) {
                missing.push(op.id);
            }
            if (!parentExists(state, op.parent.id)) {
                missing.push(op.parent.id);
            }
            return missing;
        }
        case 'char:delete':
            return state.state.chars[lamportToString(op.id)] ? [] : [op.id];
        case 'block':
            return op.block.order.path.filter((id) => !state.state.blocks[lamportToString(id)] && compareLamports(id, op.block.id) !== 0);
        case 'block:move': {
            const missing = state.state.blocks[lamportToString(op.id)] ? [] : [op.id];
            return [
                ...missing,
                ...op.order.path.filter((id) => !state.state.blocks[lamportToString(id)] && compareLamports(id, op.id) !== 0),
            ];
        }
        case 'block:delete':
        case 'block:meta':
            return state.state.blocks[lamportToString(op.id)] ? [] : [op.id];
        case 'mark': {
            const missing: Lamport[] = [];
            if (!state.state.chars[lamportToString(op.mark.start.id)]) missing.push(op.mark.start.id);
            if (!state.state.chars[lamportToString(op.mark.end.id)]) missing.push(op.mark.end.id);
            for (const split of op.mark.crossedSplits) {
                if (!state.state.splits[lamportToString(split)]) missing.push(split);
            }
            return missing;
        }
        case 'split-record': {
            const missing: Lamport[] = [];
            if (!state.state.chars[lamportToString(op.split.left)]) missing.push(op.split.left);
            if (!state.state.chars[lamportToString(op.split.right)]) missing.push(op.split.right);
            return missing;
        }
        case 'join-record': {
            const missing: Lamport[] = [];
            if (!state.state.blocks[lamportToString(op.join.left)]) missing.push(op.join.left);
            if (!state.state.blocks[lamportToString(op.join.right)]) missing.push(op.join.right);
            if (!parentExists(state, op.join.tail)) missing.push(op.join.tail);
            return missing;
        }
    }
};
