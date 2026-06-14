import {compareLamports, lamportToString, parseLamportString} from './ids.js';
import {compareLseqIds} from './lseq.js';
import {Block, CachedState, Char, Lamport, Mark, State, TimestampedBlockMeta} from './types.js';

export type BlockParentDerivation = {
    parents: Record<string, string>;
    rawParents: Record<string, string | null>;
    rejectedRoots: Set<string>;
};

export type VirtualBlockParentConfig<M extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    virtualParents?: (block: Block<M>) => Lamport[];
    markVirtualParents?: (mark: Mark) => Lamport[];
};

type BlockParentDerivationWithPaths = BlockParentDerivation & {
    paths: Record<string, Lamport[]>;
};

type BlockParentStrategy = {
    name: string;
    derive(blocks: Record<string, Block>): BlockParentDerivation;
};

export const ROOT_ID = lamportToString([0, 'root']);

const stateBlocks = <M extends TimestampedBlockMeta>(
    state: Record<string, Block<M>> | State<M> | CachedState<M>,
): Record<string, Block<M>> => {
    const value = state as State<M> | CachedState<M>;
    if ('cache' in value) return value.state.blocks;
    if ('blocks' in value) return value.blocks;
    return state as Record<string, Block<M>>;
};

export const materializedBlockPaths = <M extends TimestampedBlockMeta>(
    state: State<M> | CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
): Record<string, Lamport[]> =>
    materializedBlockPathsFromParents(
        stateBlocks(state),
        deriveBlockParentsForBlocks(stateBlocks(state), config).parents,
        virtualParentOwners(state, config),
    );

export const materializedBlockPath = <M extends TimestampedBlockMeta>(
    state: State<M> | CachedState<M>,
    blockId: string,
    config: VirtualBlockParentConfig<M> = {},
): Lamport[] => {
    const blocks = stateBlocks(state);
    const parents = deriveBlockParentsForBlocks(blocks, config).parents;
    return materializedBlockPathFromParents(blocks, parents, blockId, undefined, virtualParentOwners(state, config));
};

export const materializedBlockParent = <M extends TimestampedBlockMeta>(
    state: State<M> | CachedState<M>,
    blockId: string,
    config: VirtualBlockParentConfig<M> = {},
): Lamport => {
    const blocks = stateBlocks(state);
    const parent = deriveBlockParentsForBlocks(blocks, config).parents[blockId];
    if (parent === undefined) {
        throw new Error(`block ${blockId} not found`);
    }
    if (parent === ROOT_ID) return [0, 'root'];
    return blocks[parent]?.id ?? parseVirtualParentId(parent);
};

const deriveBlockParentsBaseline = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
): BlockParentDerivationWithPaths => {
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

const deriveBlockParentsLinear = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
): BlockParentDerivation => {
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

const deriveBlockParentsLinearStringCached = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
): BlockParentDerivation => {
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

const deriveBlockParentsLinearSummary = <M extends TimestampedBlockMeta>(
    source: Record<string, Block<M>> | State<M> | CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
): BlockParentDerivation => {
    const blocks = stateBlocks(source);
    const rawParents: Record<string, string | null> = {};
    const virtualOwners = virtualParentOwners(source, config);
    for (const [id, block] of Object.entries(blocks)) {
        rawParents[id] = validateBlockOrderPathSummary(blocks, id, block.order.path, virtualOwners);
    }
    return parentDerivationFromRawParents(blocks, rawParents, virtualOwners);
};

export const deriveBlockParentsForBlocks = deriveBlockParentsLinearSummary;

const parentDerivationFromRawParents = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
    rawParents: Record<string, string | null>,
    virtualOwners: Record<string, string> = {},
): BlockParentDerivation => {
    const rejectedRoots = rejectedRootsForRawParents(blocks, rawParents, virtualOwners);
    const parents: Record<string, string> = {};
    for (const id of Object.keys(blocks)) {
        parents[id] = rejectedRoots.has(id) || rawParents[id] === null ? ROOT_ID : rawParents[id]!;
    }
    return {parents, rawParents, rejectedRoots};
};

const rejectedRootsForRawParents = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
    rawParents: Record<string, string | null>,
    virtualOwners: Record<string, string> = {},
): Set<string> => {
    const rejectedRoots = new Set<string>();
    const state: Record<string, 0 | 1 | 2> = {};

    for (const start of Object.keys(blocks)) {
        if (state[start] === 2) continue;

        const stack: string[] = [];
        const stackIndex = new Map<string, number>();
        let current: string | null | undefined = start;

        while (current && !rejectedRoots.has(current)) {
            if (!blocks[current]) {
                current = virtualOwners[current];
                continue;
            }
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
            const rawParent: string | null | undefined = rawParents[current];
            current = rawParent && !blocks[rawParent] ? virtualOwners[rawParent] : rawParent;
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

const materializedBlockPathsFromParents = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
    parents: Record<string, string>,
    virtualOwners: Record<string, string> = {},
): Record<string, Lamport[]> => {
    const memo: Record<string, Lamport[]> = {};
    for (const id of Object.keys(blocks)) {
        materializedBlockPathFromParents(blocks, parents, id, memo, virtualOwners);
    }
    return memo;
};

const materializedBlockPathFromParents = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
    parents: Record<string, string>,
    blockId: string,
    memo: Record<string, Lamport[]> = {},
    virtualOwners: Record<string, string> = {},
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
    let path: Lamport[];
    if (parent === ROOT_ID) {
        path = [block.id];
    } else if (blocks[parent]) {
        path = [...materializedBlockPathFromParents(blocks, parents, parent, memo, virtualOwners), block.id];
    } else {
        const owner = virtualOwners[parent];
        if (!owner) throw new Error(`virtual parent ${parent} not found`);
        path = [
            ...materializedBlockPathFromParents(blocks, parents, owner, memo, virtualOwners),
            parseVirtualParentId(parent),
            block.id,
        ];
    }
    memo[blockId] = path;
    return path;
};

const validateBlockOrderPathIds = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
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

const validateBlockOrderPathSummary = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
    blockId: string,
    path: Lamport[],
    virtualOwners: Record<string, string> = {},
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
        if (!blocks[current] && !virtualOwners[current]) {
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

export const validateBlockOrderPath = <M extends TimestampedBlockMeta>(
    source: Record<string, Block<M>> | State<M> | CachedState<M>,
    blockId: string,
    order: Block['order'],
    config: VirtualBlockParentConfig<M> = {},
): false | void => {
    const blocks = stateBlocks(source);
    const virtualOwners = virtualParentOwners(source, config);
    if (!order.path.length) {
        throw new Error(`block order path for ${blockId} must not be empty`);
    }
    if (lamportToString(order.path[order.path.length - 1]) !== blockId) {
        throw new Error(`block order path for ${blockId} must end with the block id`);
    }

    const seen = new Set<string>();
    for (const item of order.path) {
        const id = lamportToString(item);
        if (id === ROOT_ID) {
            throw new Error(`block order path for ${blockId} must omit root`);
        }
        if (seen.has(id)) {
            throw new Error(`block order path for ${blockId} contains duplicate id ${id}`);
        }
        seen.add(id);
        if (!blocks[id] && !virtualOwners[id]) {
            return false;
        }
    }
};

export const virtualParentOwners = <M extends TimestampedBlockMeta>(
    source: Record<string, Block<M>> | State<M> | CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
): Record<string, string> => {
    const blocks = stateBlocks(source);
    const owners: Record<string, string> = {};
    if (config.virtualParents) {
        for (const [id, block] of Object.entries(blocks)) {
            for (const parent of config.virtualParents(block)) {
                owners[lamportToString(parent)] = id;
            }
        }
    }
    const marks = stateMarks(source);
    const chars = stateChars(source);
    if (marks && chars && config.markVirtualParents) {
        for (const mark of Object.values(marks)) {
            const owner = blockContainingChar(blocks, chars, lamportToString(mark.start.id));
            if (!owner) continue;
            for (const parent of config.markVirtualParents(mark)) {
                owners[lamportToString(parent)] = owner;
            }
        }
    }
    return owners;
};

export const virtualParentOwner = <M extends TimestampedBlockMeta>(
    source: Record<string, Block<M>> | State<M> | CachedState<M>,
    parentId: string,
    config: VirtualBlockParentConfig<M> = {},
): string | null => virtualParentOwners(source, config)[parentId] ?? null;

const stateMarks = <M extends TimestampedBlockMeta>(
    state: Record<string, Block<M>> | State<M> | CachedState<M>,
): Record<string, Mark> | null => {
    const value = state as State<M> | CachedState<M>;
    if ('cache' in value) return value.state.marks;
    return 'blocks' in value ? value.marks : null;
};

const stateChars = <M extends TimestampedBlockMeta>(
    state: Record<string, Block<M>> | State<M> | CachedState<M>,
): Record<string, Char> | null => {
    const value = state as State<M> | CachedState<M>;
    if ('cache' in value) return value.state.chars;
    return 'blocks' in value ? value.chars : null;
};

const blockContainingChar = <M extends TimestampedBlockMeta>(
    blocks: Record<string, Block<M>>,
    chars: Record<string, Char>,
    charId: string,
): string | null => {
    const seen = new Set<string>();
    let current: string | undefined = charId;
    while (current && !seen.has(current)) {
        seen.add(current);
        const char = chars[current];
        if (!char) return null;
        const parentId = lamportToString(char.parent.id);
        if (blocks[parentId]) return parentId;
        current = parentId;
    }
    return null;
};

const parseVirtualParentId = (id: string): Lamport => parseLamportString(id);

export const blockParentStrategiesForStress: BlockParentStrategy[] = [
    {name: 'baseline', derive: deriveBlockParentsBaseline},
    {name: 'linear', derive: deriveBlockParentsLinear},
    {name: 'string-cached', derive: deriveBlockParentsLinearStringCached},
    {name: 'summary', derive: deriveBlockParentsLinearSummary},
];
