import equal from 'fast-deep-equal';
import {validateBlockOrderPath, virtualParentOwners, type VirtualBlockParentConfig} from './blocks.js';
import {organizeState} from './cache.js';
import {compareLamports, compareLamportStrings, lamportToString} from './ids.js';
import {maxLamportCounterForOp} from './ops.js';
import {Block, CachedState, DefaultBlockMeta, Lamport, Op, TimestampedBlockMeta} from './types.js';
import {blockOrderVersionWins, charParentVersionWins} from './versions.js';

export type ApplyResult<M extends TimestampedBlockMeta = DefaultBlockMeta> =
    | {status: 'applied'; state: CachedState<M>}
    | {status: 'ignored'; state: CachedState<M>; reason: 'stale' | 'duplicate'}
    | {status: 'pending'; state: CachedState<M>; missing: Lamport[]}
    | {status: 'invalid'; state: CachedState<M>; error: Error};

export const charOp = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    text: string,
    id: Lamport,
    after: Lamport,
    ts: string,
): Op<M> => ({
    type: 'char',
    char: {text, id, deleted: false, parent: {id: after, ts: ''}},
});

export const applyRemote = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    op: Op<M>,
    config: VirtualBlockParentConfig<M> = {},
): ApplyResult<M> => {
    try {
        const result = apply(state, op, config);
        if (result === false) {
            return {status: 'pending', state, missing: missingDependenciesForOp(state, op, config)};
        }
        return result === state
            ? {status: 'ignored', state, reason: 'duplicate'}
            : {status: 'applied', state: result};
    } catch (error) {
        return {status: 'invalid', state, error: error instanceof Error ? error : new Error(String(error))};
    }
};

export const applyRemoteMany = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    ops: Op<M>[],
    config: VirtualBlockParentConfig<M> = {},
) => {
    const applied: Op<M>[] = [];
    const ignored: {op: Op<M>; reason: 'stale' | 'duplicate'}[] = [];
    const pending: {op: Op<M>; missing: Lamport[]}[] = [];
    const invalid: {op: Op<M>; error: Error}[] = [];

    for (const op of ops) {
        const result = applyRemote(state, op, config);
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

export const assertCacheConsistent = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
) => {
    const expected = organizeState(state.state.blocks, state.state.chars, state.state.joins, config);
    if (!equal(state.cache, expected)) {
        throw new Error(`cached state is inconsistent`);
    }
};

export const applyStrict = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    op: Op<M>,
    config: VirtualBlockParentConfig<M> = {},
): CachedState<M> => {
    const result = apply(state, op, config);
    if (result === false) {
        throw new Error(`op was pending`);
    }
    return result;
};

export const apply = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    op: Op<M>,
    config: VirtualBlockParentConfig<M> = {},
): CachedState<M> | false => {
    switch (op.type) {
        case 'char':
            return applyChar(state, op);
        case 'block':
            return applyBlock(state, op, config);
        case 'block:delete':
            return applyBlockDelete(state, op);
        case 'char:move':
            return applyCharMove(state, op);
        case 'char:delete':
            return applyCharDelete(state, op);
        case 'block:move':
            return applyBlockMove(state, op, config);
        case 'block:meta':
            return applyBlockMeta(state, op, config);
        case 'mark':
            return applyMark(state, op);
        case 'split-record':
            return applySplitRecord(state, op);
        case 'join-record':
            return applyJoinRecord(state, op);
    }
};

export const applyMany = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    ops: Op<M>[],
    config: VirtualBlockParentConfig<M> = {},
) => {
    ops.forEach((op) => {
        state = applyStrict(state, op, config);
    });
    return state;
};

export const applyManyStrict = applyMany;

const applyMark = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    op: Op<M> & {type: 'mark'},
): CachedState<M> | false => {
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

const applySplitRecord = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    op: Op<M> & {type: 'split-record'},
): CachedState<M> | false => {
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

const applyJoinRecord = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    op: Op<M> & {type: 'join-record'},
): CachedState<M> | false => {
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

const applyCharDelete = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    op: Op<M> & {type: 'char:delete'},
): CachedState<M> | false => {
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

const applyCharMove = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    op: Op<M> & {type: 'char:move'},
): CachedState<M> | false => {
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

const applyBlockDelete = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    op: Op<M> & {type: 'block:delete'},
): CachedState<M> | false => {
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

const applyBlockMove = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    op: Op<M> & {type: 'block:move'},
    config: VirtualBlockParentConfig<M>,
): CachedState<M> | false => {
    const id = lamportToString(op.id);
    const current = state.blocks[id];
    if (!current) {
        return false;
    }
    const valid = validateBlockOrderPath(state.blocks, id, op.order, config);
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
        cache: organizeState(nextState.blocks, nextState.chars, nextState.joins, config),
    };
};

const applyBlockMeta = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    op: Op<M> & {type: 'block:meta'},
    config: VirtualBlockParentConfig<M>,
): CachedState<M> | false => {
    const id = lamportToString(op.id);
    const current = state.blocks[id];
    if (!current) {
        return false;
    }
    if (op.meta.ts <= current.meta.ts) {
        return {state, cache};
    }
    const nextState = {
        ...state,
        blocks: {...state.blocks, [id]: {...current, meta: op.meta}},
        maxSeenCount: Math.max(state.maxSeenCount, maxLamportCounterForOp(op)),
    };
    return {
        state: nextState,
        cache: config.virtualParents ? organizeState(nextState.blocks, nextState.chars, nextState.joins, config) : cache,
    };
};

const applyBlock = <M extends TimestampedBlockMeta>(
    {state}: CachedState<M>,
    {block}: Op<M> & {type: 'block'},
    config: VirtualBlockParentConfig<M>,
): CachedState<M> | false => {
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
    const valid = validateBlockOrderPath(blocks, id, block.order, config);
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
        cache: organizeState(nextState.blocks, nextState.chars, nextState.joins, config),
    };
};

const applyChar = <M extends TimestampedBlockMeta>(
    {state, cache}: CachedState<M>,
    {char}: Op<M> & {type: 'char'},
): CachedState<M> | false => {
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

const parentExists = <M extends TimestampedBlockMeta>(state: CachedState<M>, id: Lamport): boolean => {
    const key = lamportToString(id);
    return Boolean(state.state.blocks[key] || state.state.chars[key] || state.cache.joinSentinels[key]);
};

const missingDependenciesForOp = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    op: Op<M>,
    config: VirtualBlockParentConfig<M> = {},
): Lamport[] => {
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
            return missingBlockPathDependencies(state, op.block.order.path, op.block.id, config);
        case 'block:move': {
            const missing = state.state.blocks[lamportToString(op.id)] ? [] : [op.id];
            return [
                ...missing,
                ...missingBlockPathDependencies(state, op.order.path, op.id, config),
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

const missingBlockPathDependencies = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    path: Lamport[],
    self: Lamport,
    config: VirtualBlockParentConfig<M>,
): Lamport[] => {
    const virtualOwners = virtualParentOwners(state.state.blocks, config);
    const missing: Lamport[] = [];
    for (const id of path) {
        const key = lamportToString(id);
        if (compareLamports(id, self) === 0) continue;
        if (state.state.blocks[key]) continue;
        const owner = virtualOwners[key];
        if (owner && state.state.blocks[owner]) continue;
        missing.push(id);
    }
    return missing;
};
