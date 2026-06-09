import equal from 'fast-deep-equal';
import {
    State,
    Lamport,
    CachedState,
    Cache,
    Char,
    HLC,
    Block,
    Mark,
    SplitRecord,
    JsonValue,
    JoinRecord,
    TimestampedBlockMeta,
    DefaultBlockMeta,
} from './types';
import {
    compareLamports,
    compareLamportStrings,
    lamportToString,
    parseLamportString,
    validateLamport,
} from './ids';
export {compareLamports, compareLamportStrings} from './ids';
import {compareLseqIds, createLseqIdBetween, LseqOptions} from './lseq';
export {
    blockOrderVersionWins,
    charParentVersionWins,
    compareBlockOrderVersions,
    compareCharParentVersions,
} from './versions';
import {blockOrderVersionWins, charParentVersionWins} from './versions';

export type Op<M extends TimestampedBlockMeta = DefaultBlockMeta> =
    | {type: 'char'; char: Char}
    | {type: 'block'; block: Block<M>}
    | {type: 'char:move'; id: Lamport; parent: Char['parent']}
    | {type: 'char:delete'; id: Lamport}
    | {type: 'block:move'; id: Lamport; order: Block['order']}
    | {type: 'block:delete'; id: Lamport}
    | {type: 'block:meta'; id: Lamport; meta: M}
    | {type: 'mark'; mark: Mark}
    | {type: 'split-record'; split: SplitRecord}
    | {type: 'join-record'; join: JoinRecord};

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

export type ValidationResult =
    | {valid: true}
    | {valid: false; errors: string[]};

export const validateOp = (op: Op): ValidationResult => {
    const errors: string[] = [];
    for (const lamport of lamportsForOp(op)) {
        try {
            validateLamport(lamport);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    if (op.type === 'block' || op.type === 'block:move') {
        const order = op.type === 'block' ? op.block.order : op.order;
        if (!order.path.length) {
            errors.push(`block order path must not be empty`);
        }
        if (order.path.length && compareLamports(order.path[order.path.length - 1], op.type === 'block' ? op.block.id : op.id) !== 0) {
            errors.push(`block order path must end with the block id`);
        }
    }
    return errors.length ? {valid: false, errors} : {valid: true};
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
    if (!laterCharParentTs(op.parent.ts, current.parent.ts)) {
        return {state, cache}; // ignore
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

const laterCharParentTs = charParentVersionWins;

const laterBlockOrderTs = blockOrderVersionWins;

const blockOrderWins = (incoming: Block['order'], current: Block['order']) => {
    if (laterBlockOrderTs(incoming.ts, current.ts)) return true;
    if (laterBlockOrderTs(current.ts, incoming.ts)) return false;
    return compareLamports(incoming.id, current.id) < 0;
};

const validateBlockOrderPath = (
    blocks: Record<string, Block>,
    blockId: string,
    order: Block['order'],
): false | void => {
    if (!order.path.length) {
        throw new Error(`block order path for ${blockId} must not be empty`);
    }
    if (lamportToString(order.path[order.path.length - 1]) !== blockId) {
        throw new Error(`block order path for ${blockId} must end with the block id`);
    }

    const seen = new Set<string>();
    const rootId = lamportToString([0, 'root']);
    for (const item of order.path) {
        const id = lamportToString(item);
        if (id === rootId) {
            throw new Error(`block order path for ${blockId} must omit root`);
        }
        if (seen.has(id)) {
            throw new Error(`block order path for ${blockId} contains duplicate id ${id}`);
        }
        seen.add(id);
        if (!blocks[id]) {
            return false;
        }
    }
};

const applyChar = ({state, cache}: CachedState, {char}: Op & {type: 'char'}) => {
    const {chars, blocks, marks, splits, joins, maxSeenCount} = state;
    const charId = lamportToString(char.id);
    const current = state.chars[charId];
    if (current) {
        if (current.text !== char.text) {
            throw new Error(`re-insert of ${charId} and the text is different`);
        }
        if (laterCharParentTs(current.parent.ts, char.parent.ts)) {
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

const insertSortedBy = <T>(
    array: string[],
    item: string,
    order: (id: string) => T,
    compare: (a: T, b: T) => number,
) => {
    const self = order(item);
    for (let i = 0; i < array.length; i++) {
        if (compare(self, order(array[i])) < 0) {
            array.splice(i, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
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

export const applyMany = (state: CachedState, ops: Op[]) => {
    ops.forEach((op) => {
        state = applyStrict(state, op);
    });
    return state;
};

export const applyManyStrict = applyMany;

export const addChars = (
    state: CachedState,
    text: string,
    after: Lamport,
    ts: () => HLC,
    actor = 'self',
): CachedState => {
    let i = state.state.maxSeenCount + 1;
    const ops: Op[] = [];
    for (let char of new Intl.Segmenter().segment(text)) {
        const id: Lamport = [i, actor];
        ops.push(charOp(char.segment, id, after, ts()));
        after = id;
        i++;
    }
    return applyMany(state, ops);
};

export const cachedState = (state: State): CachedState => ({
    state,
    cache: organizeState(state.blocks, state.chars, state.joins),
});

// root blocks are those whose parent = 'root'

// Blocks ... are created with a single char. but if there happen to be multiple, idk we can handle it.

export const blockContents = (state: CachedState, id: string): string =>
    state.cache.charContents[id]?.map((id) => charToString(state, id)).join('') ?? '';

export const charToString = (state: CachedState, id: string): string => {
    const char = charRecord(state, id);
    if (!char) return '';
    return (
        (char.deleted ? '' : char.text) +
        (state.cache.charContents[id]?.map((id) => charToString(state, id)).join('') ?? '')
    );
};

export const stateToString = (state: CachedState) => {
    const {blocks} = state.state;
    const {blockChildren, charContents} = state.cache;
    const showBlock = (id: string): string[] => {
        const block = blocks[id];
        if (block.deleted) {
            return [];
        }
        const symbol = {paragraph: ' ', bullets: '•', checkboxes: '☐', blockquote: '|'}[
            block.meta.type
        ];
        return [
            id + ': ' + (charContents[id]?.map((id) => charToString(state, id)).join('') ?? ''),
            ...(blockChildren[id]?.flatMap(showBlock).map((line) => symbol + ' ' + line) ?? []),
        ];
    };
    return visibleBlockChildren(state, '0000-root').flatMap(showBlock).join('\n');
};

const stateBlocks = (state: State | CachedState) => ('cache' in state ? state.state.blocks : state.blocks);

export const materializedBlockPaths = (state: State | CachedState): Record<string, Lamport[]> =>
    materializedBlockPathsFromParents(stateBlocks(state), deriveBlockParentsForBlocks(stateBlocks(state)).parents);

export const materializedBlockPath = (state: State | CachedState, blockId: string): Lamport[] => {
    const blocks = stateBlocks(state);
    const parents = deriveBlockParentsForBlocks(blocks).parents;
    return materializedBlockPathFromParents(blocks, parents, blockId);
};

export const materializedBlockParent = (state: State | CachedState, blockId: string): Lamport => {
    const blocks = stateBlocks(state);
    const parent = deriveBlockParentsForBlocks(blocks).parents[blockId];
    if (parent === undefined) {
        throw new Error(`block ${blockId} not found`);
    }
    return parent === ROOT_ID ? [0, 'root'] : blocks[parent].id;
};

type BlockParentDerivation = {
    parents: Record<string, string>;
    rawParents: Record<string, string | null>;
    rejectedRoots: Set<string>;
};

type BlockParentDerivationWithPaths = BlockParentDerivation & {
    paths: Record<string, Lamport[]>;
};

type BlockParentStrategy = {
    name: string;
    derive(blocks: Record<string, Block>): BlockParentDerivation;
};

const ROOT_ID = lamportToString([0, 'root']);

const deriveBlockParentsBaseline = (blocks: Record<string, Block>): BlockParentDerivationWithPaths => {
    const rawParent: Record<string, string | null> = {};
    const rejectedRoot = new Set<string>();

    for (const [id, block] of Object.entries(blocks)) {
        const valid = validateBlockOrderPath(blocks, id, block.order);
        if (valid === false) {
            throw new Error(`block order path for ${id} references a missing block`);
        }
        rawParent[id] =
            block.order.path.length > 1
                ? lamportToString(block.order.path[block.order.path.length - 2])
                : null;
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const id of Object.keys(blocks)) {
            const seen = new Map<string, number>();
            const path: string[] = [];
            let current: string | null | undefined = id;
            while (current && !rejectedRoot.has(current)) {
                const index = seen.get(current);
                if (index !== undefined) {
                    const cycle = path.slice(index);
                    const winner = cycle.reduce((best, item) =>
                        compareLamports(blocks[item].order.id, blocks[best].order.id) < 0 ? item : best,
                    );
                    if (!rejectedRoot.has(winner)) {
                        rejectedRoot.add(winner);
                        changed = true;
                    }
                    break;
                }
                seen.set(current, path.length);
                path.push(current);
                current = rawParent[current];
            }
        }
    }

    const memo: Record<string, Lamport[]> = {};
    const normalize = (id: string): Lamport[] => {
        const existing = memo[id];
        if (existing) return existing;
        const block = blocks[id];
        if (!block) {
            throw new Error(`block ${id} not found while materializing paths`);
        }
        const parent = rejectedRoot.has(id) ? null : rawParent[id];
        const path = parent ? [...normalize(parent), block.id] : [block.id];
        memo[id] = path;
        return path;
    };

    for (const id of Object.keys(blocks)) {
        normalize(id);
    }
    return {
        parents: parentsFromPaths(memo),
        rawParents: rawParent,
        rejectedRoots: rejectedRoot,
        paths: memo,
    };
};

const deriveBlockParentsLinear = (blocks: Record<string, Block>): BlockParentDerivation => {
    const rawParents: Record<string, string | null> = {};
    for (const [id, block] of Object.entries(blocks)) {
        const valid = validateBlockOrderPath(blocks, id, block.order);
        if (valid === false) {
            throw new Error(`block order path for ${id} references a missing block`);
        }
        rawParents[id] =
            block.order.path.length > 1
                ? lamportToString(block.order.path[block.order.path.length - 2])
                : null;
    }
    return parentDerivationFromRawParents(blocks, rawParents);
};

const deriveBlockParentsLinearStringCached = (blocks: Record<string, Block>): BlockParentDerivation => {
    const rawParents: Record<string, string | null> = {};
    const pathIdsByBlock: Record<string, string[]> = {};
    for (const [id, block] of Object.entries(blocks)) {
        const pathIds = block.order.path.map(lamportToString);
        validateBlockOrderPathIds(blocks, id, pathIds);
        pathIdsByBlock[id] = pathIds;
        rawParents[id] = pathIds.length > 1 ? pathIds[pathIds.length - 2] : null;
    }
    return parentDerivationFromRawParents(blocks, rawParents);
};

const deriveBlockParentsLinearSummary = (blocks: Record<string, Block>): BlockParentDerivation => {
    const rawParents: Record<string, string | null> = {};
    for (const [id, block] of Object.entries(blocks)) {
        rawParents[id] = validateBlockOrderPathSummary(blocks, id, block.order.path);
    }
    return parentDerivationFromRawParents(blocks, rawParents);
};

const deriveBlockParentsForBlocks = deriveBlockParentsLinearSummary;

const parentDerivationFromRawParents = (
    blocks: Record<string, Block>,
    rawParents: Record<string, string | null>,
): BlockParentDerivation => {
    const rejectedRoots = rejectedRootsForRawParents(blocks, rawParents);
    const parents: Record<string, string> = {};
    for (const id of Object.keys(blocks)) {
        parents[id] = rejectedRoots.has(id) || rawParents[id] === null ? ROOT_ID : rawParents[id]!;
    }
    return {parents, rawParents, rejectedRoots};
};

const rejectedRootsForRawParents = (
    blocks: Record<string, Block>,
    rawParents: Record<string, string | null>,
): Set<string> => {
    const rejectedRoots = new Set<string>();
    const state: Record<string, 0 | 1 | 2> = {};

    for (const start of Object.keys(blocks)) {
        if (state[start] === 2) continue;

        const stack: string[] = [];
        const stackIndex = new Map<string, number>();
        let current: string | null | undefined = start;

        while (current && !rejectedRoots.has(current)) {
            if (state[current] === 2) break;

            const index = stackIndex.get(current);
            if (index !== undefined) {
                const cycle = stack.slice(index);
                const winner = cycle.reduce((best, item) =>
                    compareLamports(blocks[item].order.id, blocks[best].order.id) < 0 ? item : best,
                );
                rejectedRoots.add(winner);
                break;
            }

            state[current] = 1;
            stackIndex.set(current, stack.length);
            stack.push(current);
            current = rawParents[current];
        }

        for (const item of stack) {
            state[item] = 2;
        }
    }

    return rejectedRoots;
};

const parentsFromPaths = (paths: Record<string, Lamport[]>): Record<string, string> => {
    const parents: Record<string, string> = {};
    for (const [id, path] of Object.entries(paths)) {
        parents[id] = path.length > 1 ? lamportToString(path[path.length - 2]) : ROOT_ID;
    }
    return parents;
};

const materializedBlockPathsFromParents = (
    blocks: Record<string, Block>,
    parents: Record<string, string>,
): Record<string, Lamport[]> => {
    const memo: Record<string, Lamport[]> = {};
    for (const id of Object.keys(blocks)) {
        materializedBlockPathFromParents(blocks, parents, id, memo);
    }
    return memo;
};

const materializedBlockPathFromParents = (
    blocks: Record<string, Block>,
    parents: Record<string, string>,
    blockId: string,
    memo: Record<string, Lamport[]> = {},
): Lamport[] => {
    const existing = memo[blockId];
    if (existing) return existing;
    const block = blocks[blockId];
    if (!block) {
        throw new Error(`block ${blockId} not found`);
    }
    const parent = parents[blockId];
    if (parent === undefined) {
        throw new Error(`materialized parent for ${blockId} not found`);
    }
    const path = parent === ROOT_ID ? [block.id] : [...materializedBlockPathFromParents(blocks, parents, parent, memo), block.id];
    memo[blockId] = path;
    return path;
};

const validateBlockOrderPathIds = (
    blocks: Record<string, Block>,
    blockId: string,
    pathIds: string[],
) => {
    if (!pathIds.length) {
        throw new Error(`block order path for ${blockId} must not be empty`);
    }
    if (pathIds[pathIds.length - 1] !== blockId) {
        throw new Error(`block order path for ${blockId} must end with the block id`);
    }
    const seen = new Set<string>();
    for (const id of pathIds) {
        if (id === ROOT_ID) {
            throw new Error(`block order path for ${blockId} must omit root`);
        }
        if (seen.has(id)) {
            throw new Error(`block order path for ${blockId} contains duplicate id ${id}`);
        }
        seen.add(id);
        if (!blocks[id]) {
            throw new Error(`block order path for ${blockId} references a missing block`);
        }
    }
};

const validateBlockOrderPathSummary = (
    blocks: Record<string, Block>,
    blockId: string,
    path: Lamport[],
): string | null => {
    if (!path.length) {
        throw new Error(`block order path for ${blockId} must not be empty`);
    }
    const seen = new Set<string>();
    let previous: string | null = null;
    let current = '';
    for (const item of path) {
        current = lamportToString(item);
        if (current === ROOT_ID) {
            throw new Error(`block order path for ${blockId} must omit root`);
        }
        if (seen.has(current)) {
            throw new Error(`block order path for ${blockId} contains duplicate id ${current}`);
        }
        seen.add(current);
        if (!blocks[current]) {
            throw new Error(`block order path for ${blockId} references a missing block`);
        }
        if (current !== blockId) {
            previous = current;
        }
    }
    if (current !== blockId) {
        throw new Error(`block order path for ${blockId} must end with the block id`);
    }
    return previous;
};

export const blockParentStrategiesForStress: BlockParentStrategy[] = [
    {name: 'baseline', derive: deriveBlockParentsBaseline},
    {name: 'linear', derive: deriveBlockParentsLinear},
    {name: 'string-cached', derive: deriveBlockParentsLinearStringCached},
    {name: 'summary', derive: deriveBlockParentsLinearSummary},
];

export function organizeState(
    blocks: Record<string, Block>,
    chars: Record<string, Char>,
    joins: Record<string, JoinRecord> = {},
): Cache {
    const blockChildren: Record<string, string[]> = {};
    const {parents} = deriveBlockParentsForBlocks(blocks);
    for (const [id, block] of Object.entries(blocks)) {
        const pid = parents[id];
        if (!blockChildren[pid]) {
            blockChildren[pid] = [];
        }
        blockChildren[pid].push(id);
    }
    const charContents: Record<string, string[]> = {};
    for (const [id, char] of Object.entries(chars)) {
        const pid = lamportToString(char.parent.id);
        if (!charContents[pid]) {
            charContents[pid] = [];
        }
        charContents[pid].push(id);
    }
    Object.values(blockChildren).forEach((items) => {
        items.sort((a, b) => compareLseqIds(blocks[a].order.index, blocks[b].order.index));
    });
    Object.values(charContents).forEach((items) => {
        items.sort((a, b) => compareLamportStrings(b, a));
    });

    const joinSentinels: Record<string, JoinRecord> = {};
    const joinedBlocks: Record<string, JoinRecord> = {};
    for (const join of activeJoinRecords(joins)) {
        const rightId = lamportToString(join.right);
        const tailId = lamportToString(join.tail);
        joinSentinels[rightId] = join;
        joinedBlocks[rightId] = join;
        charContents[tailId] = insertSortedRev(charContents[tailId]?.slice() ?? [], rightId);
    }

    return {blockChildren, charContents, joinSentinels, joinedBlocks};
}

export const findTail = (char: string, contents: Cache['charContents']) => {
    const seen = new Set<string>();
    while (contents[char]?.length) {
        if (seen.has(char)) {
            throw new Error(`char traversal cycle at ${char}`);
        }
        seen.add(char);
        char = contents[char][contents[char].length - 1];
    }
    return char;
};

export const maxLamportCounterForOp = (op: Op): number => {
    switch (op.type) {
        case 'char':
            return Math.max(
                op.char.id[0],
                op.char.parent.id[0],
                ...lamportsInCharParentTs(op.char.parent.ts).map((id) => id[0]),
            );
        case 'block':
            return Math.max(op.block.id[0], op.block.order.id[0], ...op.block.order.path.map((id) => id[0]));
        case 'char:move':
            return Math.max(
                op.id[0],
                op.parent.id[0],
                ...lamportsInCharParentTs(op.parent.ts).map((id) => id[0]),
            );
        case 'char:delete':
        case 'block:delete':
        case 'block:meta':
            return op.id[0];
        case 'block:move':
            return Math.max(op.id[0], op.order.id[0], ...op.order.path.map((id) => id[0]));
        case 'mark':
            return Math.max(
                op.mark.id[0],
                op.mark.start.id[0],
                op.mark.end.id[0],
                ...op.mark.crossedSplits.map((id) => id[0]),
            );
        case 'split-record':
            return Math.max(op.split.id[0], op.split.left[0], op.split.right[0]);
        case 'join-record':
            return Math.max(op.join.id[0], op.join.left[0], op.join.right[0], op.join.tail[0]);
    }
};

const lamportsInCharParentTs = (ts: Char['parent']['ts']): Lamport[] =>
    Array.isArray(ts) ? ts[1] : [];

const lamportsForOp = (op: Op): Lamport[] => {
    switch (op.type) {
        case 'char':
            return [op.char.id, op.char.parent.id, ...lamportsInCharParentTs(op.char.parent.ts)];
        case 'block':
            return [op.block.id, op.block.order.id, ...op.block.order.path];
        case 'char:move':
            return [op.id, op.parent.id, ...lamportsInCharParentTs(op.parent.ts)];
        case 'char:delete':
        case 'block:delete':
        case 'block:meta':
            return [op.id];
        case 'block:move':
            return [op.id, op.order.id, ...op.order.path];
        case 'mark':
            return [
                op.mark.id,
                op.mark.start.id,
                op.mark.end.id,
                ...op.mark.crossedSplits,
            ];
        case 'split-record':
            return [op.split.id, op.split.left, op.split.right];
        case 'join-record':
            return [op.join.id, op.join.left, op.join.right, op.join.tail];
    }
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

export const activeJoinRecords = (joins: Record<string, JoinRecord>): JoinRecord[] => {
    const active: JoinRecord[] = [];
    const edges: Record<string, string> = {};
    const byId = Object.values(joins).sort((a, b) => compareLamports(a.id, b.id));

    for (const join of byId) {
        const right = lamportToString(join.right);
        const left = lamportToString(join.left);
        if (edges[right]) {
            continue;
        }
        if (joinPathExists(edges, left, right)) {
            continue;
        }
        edges[right] = left;
        active.push(join);
    }

    return active;
};

const joinPathExists = (edges: Record<string, string>, from: string, to: string): boolean => {
    const seen = new Set<string>();
    let current: string | undefined = from;
    while (current) {
        if (current === to) return true;
        if (seen.has(current)) return false;
        seen.add(current);
        current = edges[current];
    }
    return false;
};

export const activeJoinByRightBlock = (
    state: State | CachedState,
): Record<string, JoinRecord> => {
    const joins = 'cache' in state ? state.cache.joinedBlocks : state.joins;
    if ('cache' in state) return joins;
    const result: Record<string, JoinRecord> = {};
    for (const join of activeJoinRecords(joins)) {
        result[lamportToString(join.right)] = join;
    }
    return result;
};

export const joinedBlockIds = (state: State | CachedState): Set<string> =>
    new Set(Object.keys(activeJoinByRightBlock(state)));

const charRecord = (
    state: CachedState,
    id: string,
): Pick<Char, 'id' | 'text' | 'deleted' | 'parent'> | undefined => {
    const char = state.state.chars[id];
    if (char) return char;
    const join = state.cache.joinSentinels[id];
    if (!join) return undefined;
    return {
        id: join.right,
        text: '',
        deleted: true,
        parent: {id: join.tail, ts: join.ts},
    };
};

const visibleBlock = (state: CachedState, id: string): boolean => {
    const block = state.state.blocks[id];
    return Boolean(block && !block.deleted && !state.cache.joinedBlocks[id]);
};

export const visibleBlockChildren = (state: CachedState, parent: string): string[] => {
    const result: string[] = [];
    const visitChildren = (pid: string, seen: Set<string>) => {
        if (seen.has(pid)) {
            throw new Error(`block traversal cycle at ${pid}`);
        }
        seen.add(pid);
        for (const child of state.cache.blockChildren[pid] ?? []) {
            if (visibleBlock(state, child)) {
                result.push(child);
            } else {
                visitChildren(child, new Set(seen));
            }
        }
    };
    visitChildren(parent, new Set());
    return result;
};

export type VisibleBlockOutlineEntry = {
    id: string;
    depth: number;
    parentId: string;
};

export const visibleBlockOutline = (state: CachedState): VisibleBlockOutlineEntry[] => {
    const result: VisibleBlockOutlineEntry[] = [];
    const rootId = lamportToString([0, 'root']);

    const visitChildren = (
        pid: string,
        depth: number,
        visibleParentId: string,
        seen: Set<string>,
    ) => {
        if (seen.has(pid)) {
            throw new Error(`block traversal cycle at ${pid}`);
        }
        seen.add(pid);
        for (const child of state.cache.blockChildren[pid] ?? []) {
            if (visibleBlock(state, child)) {
                result.push({id: child, depth, parentId: visibleParentId});
                visitChildren(child, depth + 1, child, new Set(seen));
            } else {
                visitChildren(child, depth, visibleParentId, new Set(seen));
            }
        }
    };

    visitChildren(rootId, 0, rootId, new Set());
    return result;
};

export const orderedCharIdsForBlock = (
    state: CachedState,
    blockId: string,
    options: {visibleOnly?: boolean} = {},
): string[] => {
    const result: string[] = [];
    const visit = (id: string) => {
        const char = charRecord(state, id);
        if (!char) return;
        if (!options.visibleOnly || !char.deleted) {
            result.push(id);
        }
        for (const child of state.cache.charContents[id] ?? []) {
            visit(child);
        }
    };
    for (const id of state.cache.charContents[blockId] ?? []) {
        visit(id);
    }
    return result;
};

export const rootBlockIds = (state: CachedState, includeDeleted = false): string[] =>
    includeDeleted
        ? state.cache.blockChildren[lamportToString([0, 'root'])] ?? []
        : visibleBlockChildren(state, lamportToString([0, 'root']));

export const hasJoinStyleParent = (state: CachedState, charId: string): boolean => {
    if (state.cache.joinSentinels[charId]) {
        return true;
    }
    const char = state.state.chars[charId];
    if (!char) return false;
    const parentId = lamportToString(char.parent.id);
    return (
        (parentId in state.state.chars || parentId in state.cache.joinSentinels) &&
        typeof char.parent.ts === 'string' &&
        char.parent.ts !== ''
    );
};

export const splitRecordsByLeft = (state: CachedState): Record<string, SplitRecord[]> => {
    const result: Record<string, SplitRecord[]> = {};
    for (const split of Object.values(state.state.splits)) {
        const left = lamportToString(split.left);
        result[left] = result[left] ?? [];
        result[left].push(split);
    }
    for (const splits of Object.values(result)) {
        splits.sort((a, b) => compareLamports(a.right, b.right) || compareLamports(a.id, b.id));
    }
    return result;
};

export type FormattedRun = {
    text: string;
    marks: Record<string, JsonValue | true>;
};

export type FormattedBlock = {
    id: string;
    block: Block;
    runs: FormattedRun[];
    depth: number;
    parentId: string;
};

export const markOp = (
    id: Lamport,
    start: Lamport,
    end: Lamport,
    type: string,
    data?: JsonValue,
    remove = false,
    crossedSplits: Lamport[] = [],
): Op => ({
    type: 'mark',
    mark: {
        id,
        start: {id: start, at: 'before'},
        end: {id: end, at: 'after'},
        remove,
        type,
        data,
        crossedSplits,
    },
});

export const markRange = (
    state: CachedState,
    block: Lamport,
    startOffset: number,
    endOffset: number,
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    id: Lamport,
): Op => {
    if (startOffset >= endOffset) {
        throw new Error(`mark range must not be empty`);
    }
    const start = charAtVisibleOffset(state, block, startOffset);
    const end = charAtVisibleOffset(state, block, endOffset - 1);
    if (!start || !end) {
        throw new Error(`mark range must anchor to characters`);
    }
    return markOp(id, start, end, type, data, remove, crossedSplitsBetween(state, start, end));
};

export const insertTextOps = (
    state: CachedState,
    {
        actor,
        block,
        offset,
        text,
        ts,
    }: {
        actor: string;
        block: Lamport;
        offset: number;
        text: string;
        ts: () => HLC;
    },
): Op[] => {
    let after = insertionParentAtVisibleOffset(state, block, offset);
    let next = state.state.maxSeenCount + 1;
    const ops: Op[] = [];
    for (const char of new Intl.Segmenter().segment(text)) {
        const id: Lamport = [next++, actor];
        ops.push(charOp(char.segment, id, after, ts()));
        after = id;
    }
    return ops;
};

export const deleteRangeOps = (
    state: CachedState,
    {block, startOffset, endOffset}: {block: Lamport; startOffset: number; endOffset: number},
): Op[] => {
    if (startOffset > endOffset) {
        throw new Error(`delete range start must be <= end`);
    }
    const ops: Op[] = [];
    for (let offset = startOffset; offset < endOffset; offset++) {
        const id = charAtVisibleOffset(state, block, offset);
        if (!id) {
            throw new Error(`delete range out of bounds`);
        }
        ops.push({type: 'char:delete', id});
    }
    return ops;
};

export const splitBlockOps = (
    state: CachedState,
    {
        actor,
        block,
        offset,
        ts,
        options,
    }: {
        actor: string;
        block: Lamport;
        offset: number;
        ts: HLC;
        options?: LseqOptions;
    },
): Op[] => {
    const blockId = lamportToString(block);
    const chars = orderedCharIdsForBlock(state, blockId, {visibleOnly: true});
    if (offset < 0 || offset > chars.length) {
        throw new Error(`split offset out of bounds`);
    }
    const char =
        offset === 0
            ? block
            : offset === chars.length
              ? null
              : state.state.chars[chars[offset]].id;
    const previous =
        char === null
            ? chars.length
                ? state.state.chars[chars[chars.length - 1]].id
                : null
            : offset > 0
              ? state.state.chars[chars[offset - 1]].id
              : null;
    return split(state, {block, char, previous}, ts, actor, options);
};

export const joinBlocksOps = (
    state: CachedState,
    {actor, left, right, ts}: {actor: string; left: Lamport; right: Lamport; ts: HLC},
): Op[] => join(state, left, right, ts, actor);

export const setBlockMetaOps = (
    _state: CachedState,
    {block, meta}: {block: Lamport; meta: Block['meta']},
): Op[] => [{type: 'block:meta', id: block, meta}];

export const markRangeOp = markRange;

const insertionParentAtVisibleOffset = (
    state: CachedState,
    block: Lamport,
    offset: number,
): Lamport => {
    if (offset < 0) {
        throw new Error(`insert offset out of bounds`);
    }
    if (offset === 0) {
        return block;
    }
    const id = charAtVisibleOffset(state, block, offset - 1);
    if (!id) {
        throw new Error(`insert offset out of bounds`);
    }
    return id;
};

export const materializeFormattedBlocks = (state: CachedState): FormattedBlock[] => {
    const coveredByMark: Record<string, Mark[]> = {};
    const marks = Object.values(state.state.marks).sort((a, b) => compareLamports(a.id, b.id));
    for (const mark of marks) {
        for (const charId of coveredCharIdsForMark(state, mark)) {
            coveredByMark[charId] = coveredByMark[charId] ?? [];
            coveredByMark[charId].push(mark);
        }
    }

    return visibleBlockOutline(state).map(({id, depth, parentId}) => {
        const runs: FormattedRun[] = [];
        for (const charId of orderedCharIdsForBlock(state, id, {visibleOnly: true})) {
            const char = charRecord(state, charId);
            if (!char) continue;
            const marks = resolveMarks(coveredByMark[charId] ?? []);
            const last = runs[runs.length - 1];
            if (last && equal(last.marks, marks)) {
                last.text += char.text;
            } else {
                runs.push({text: char.text, marks});
            }
        }
        return {id, block: state.state.blocks[id], runs, depth, parentId};
    });
};

const charAtVisibleOffset = (state: CachedState, block: Lamport, offset: number): Lamport | null => {
    const id = orderedCharIdsForBlock(state, lamportToString(block), {visibleOnly: true})[offset];
    return id ? state.state.chars[id].id : null;
};

const crossedSplitsBetween = (state: CachedState, start: Lamport, end: Lamport): Lamport[] => {
    const splitRecords = splitRecordsByLeft(state);
    const sequence = allCharIds(state);
    const nextById = nextIdMap(sequence);
    const crossed: Lamport[] = [];
    let current: string | undefined = lamportToString(start);
    const endId = lamportToString(end);
    let stop = sequence.length + Object.keys(state.state.splits).length + 1;
    while (current && stop-- > 0) {
        const split = splitRecords[current]?.[0];
        if (split) {
            crossed.push(split.id);
        }
        if (current === endId) {
            break;
        }
        current = nextById[current];
    }
    return crossed;
};

const coveredCharIdsForMark = (state: CachedState, mark: Mark): string[] => {
    const sequence = allCharIds(state);
    const nextById = nextIdMap(sequence);
    const splitRecords = splitRecordsByLeft(state);
    const crossed = new Set(mark.crossedSplits.map(lamportToString));
    const covered: string[] = [];
    const forcedNext: Record<string, string> = {};
    let current =
        mark.start.at === 'before'
            ? lamportToString(mark.start.id)
            : nextById[lamportToString(mark.start.id)];
    const end = lamportToString(mark.end.id);
    let stop = sequence.length + Object.keys(state.state.splits).length * 20 + 20;

    while (current && stop-- > 0) {
        if (mark.end.at === 'before' && current === end) {
            break;
        }
        covered.push(current);
        if (mark.end.at === 'after' && current === end) {
            break;
        }
        if (forcedNext[current]) {
            current = forcedNext[current];
            continue;
        }
        const split = splitRecords[current]?.find((split) => !crossed.has(lamportToString(split.id)));
        if (split) {
            const path = pathForFollowedSplit(state, split);
            for (let i = 0; i < path.length - 1; i++) {
                forcedNext[path[i]] = path[i + 1];
            }
            current = forcedNext[current] ?? lamportToString(split.right);
            continue;
        }
        current = nextById[current];
    }
    if (stop <= 0) {
        throw new Error(`mark traversal exceeded safety limit`);
    }
    return covered;
};

const allCharIds = (state: CachedState): string[] =>
    visibleBlockOutline(state).flatMap(({id}) => orderedCharIdsForBlock(state, id));

const nextIdMap = (sequence: string[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (let i = 0; i < sequence.length - 1; i++) {
        result[sequence[i]] = sequence[i + 1];
    }
    return result;
};

const pathForFollowedSplit = (state: CachedState, split: SplitRecord): string[] => {
    const left = lamportToString(split.left);
    const right = lamportToString(split.right);
    const tail = tailAfterSplitLeft(state, left);
    if (tail[tail.length - 1] === right) {
        return [left, ...tail];
    }
    return [left, ...tail, right];
};

const tailAfterSplitLeft = (state: CachedState, left: string): string[] => {
    const result: string[] = [];
    const visit = (id: string): boolean => {
        result.push(id);
        if (hasJoinStyleParent(state, id)) {
            return true;
        }
        for (const child of state.cache.charContents[id] ?? []) {
            if (visit(child)) {
                return true;
            }
        }
        return false;
    };
    for (const child of state.cache.charContents[left] ?? []) {
        if (visit(child)) {
            break;
        }
    }
    return result;
};

const resolveMarks = (marks: Mark[]): Record<string, JsonValue | true> => {
    const winning: Record<string, Mark> = {};
    for (const mark of marks) {
        const current = winning[mark.type];
        if (!current || compareLamports(current.id, mark.id) < 0) {
            winning[mark.type] = mark;
        }
    }
    const result: Record<string, JsonValue | true> = {};
    for (const mark of Object.values(winning)) {
        if (!mark.remove) {
            result[mark.type] = mark.data ?? true;
        }
    }
    return result;
};

export const split = (
    {state, cache}: CachedState,
    at: {block: Lamport; char: Lamport | null; previous: Lamport | null},
    ts: string,
    actor: string,
    options?: LseqOptions,
): Op[] => {
    const {chars, blocks, maxSeenCount} = state;
    const bid = lamportToString(at.block);
    const current = blocks[bid];
    const parent = materializedBlockParent({state, cache}, bid);
    const parentPath = materializedBlockPath({state, cache}, bid).slice(0, -1);
    const siblings = cache.blockChildren[lamportToString(parent)] ?? [];
    const index = siblings.indexOf(bid);
    const previousId = siblings[index - 1];
    const nextId = siblings[index + 1];
    if (at.char === null) {
        const id: Lamport = [maxSeenCount + 1, actor];
        return [
            {
                type: 'block',
                block: blockBetween(
                    id,
                    current.meta,
                    parentPath,
                    current.order.index,
                    nextId ? blocks[nextId].order.index : null,
                    ts,
                    actor,
                    options,
                ),
            },
        ];
    }
    if (bid === lamportToString(at.char)) {
        const id: Lamport = [maxSeenCount + 1, actor];
        return [
            {
                type: 'block',
                block: blockBetween(
                    id,
                    current.meta,
                    parentPath,
                    previousId ? blocks[previousId].order.index : null,
                    current.order.index,
                    ts,
                    actor,
                    options,
                ),
            },
        ];
    }
    const after = nextId ? blocks[nextId].order.index : null;
    const block: Block = {
        id: [maxSeenCount + 1, actor],
        meta: current.meta,
        order: {
            id: [maxSeenCount + 1, actor],
            ts,
            path: [...parentPath, [maxSeenCount + 1, actor]],
            index: createLseqIdBetween(
                current.order.index,
                after,
                {
                    actorId: actor,
                    counter: maxSeenCount + 1,
                },
                options,
            ),
        },
        deleted: false,
    };
    const ops: Op[] = [{type: 'block', block}];

    if (at.previous && at.char) {
        ops.push({
            type: 'split-record',
            split: {
                id: block.id,
                left: at.previous,
                right: at.char,
            },
        });
    }

    ops.push({
        type: 'char:move',
        id: at.char,
        parent: {
            ts: ts,
            id: block.id,
        },
    });

    const ancestryPath: Lamport[] = [];
    const initialTail = charRecord({state, cache}, findTail(lamportToString(at.char), cache.charContents));
    if (!initialTail) {
        throw new Error(`split tail not found`);
    }
    let tail = initialTail.id;
    let cid = lamportToString(at.char);
    let stop = 1000;
    while (cid !== bid) {
        if (stop-- < 0) throw new Error(`Too deep`);
        ancestryPath.unshift(parseLamportString(cid));

        const currentChar = charRecord({state, cache}, cid);
        if (!currentChar) {
            throw new Error(`split char not found`);
        }
        const pid = lamportToString(currentChar.parent.id);
        const children = cache.charContents[pid] ?? [];
        for (let at = children.indexOf(cid) + 1; at < children.length; at++) {
            const id = children[at];
            const char = chars[id];
            const tailChar = charRecord({state, cache}, findTail(id, cache.charContents));
            if (!tailChar) {
                throw new Error(`split sibling tail not found`);
            }
            if (!char) {
                tail = tailChar.id;
                continue;
            }
            ops.push({
                type: 'char:move',
                id: char.id,
                parent: {
                    ts: [lastMoveTs(char.parent.ts), ancestryPath, ts],
                    id: tail,
                },
            });
            tail = tailChar.id;
        }
        cid = pid;
    }

    return ops;
};

export const join = (
    {state, cache}: CachedState,
    left: Lamport,
    right: Lamport,
    ts: string,
    actor: string,
): Op[] => {
    const {blocks} = state;
    const leftId = lamportToString(left);
    const rightId = lamportToString(right);
    if (!blocks[leftId] || !blocks[rightId]) {
        throw new Error(`join block not found`);
    }
    if (blocks[leftId].deleted || blocks[rightId].deleted) {
        throw new Error(`join block deleted`);
    }
    if (cache.joinedBlocks[leftId] || cache.joinedBlocks[rightId]) {
        throw new Error(`join block deleted`);
    }

    const leftRoots = cache.charContents[leftId] ?? [];
    const tail = leftRoots.length
        ? parseLamportString(findTail(leftRoots[leftRoots.length - 1], cache.charContents))
        : left;

    return [
        {
            type: 'join-record',
            join: {
                id: [state.maxSeenCount + 1, actor],
                left,
                right,
                tail,
                ts,
            },
        },
    ];
};

const blockBetween = (
    id: Lamport,
    meta: Block['meta'],
    parentPath: Lamport[],
    before: Block['order']['index'] | null,
    after: Block['order']['index'] | null,
    ts: string,
    actor: string,
    options?: LseqOptions,
): Block => ({
    id,
    meta,
    order: {
        id,
        ts,
        path: [...parentPath, id],
        index: createLseqIdBetween(
            before,
            after,
            {
                actorId: actor,
                counter: id[0],
            },
            options,
        ),
    },
    deleted: false,
});

const lastMoveTs = (ts: Char['parent']['ts']) => (typeof ts === 'string' ? ts : ts[2]);
