import {State, Lamport, CachedState, Cache, Char, HLC, Block} from './types';
import {lamportToString, parseLamportString} from './utils';
import {compareLseqIds, createLseqIdBetween} from './lseq';

type Op =
    | {type: 'char'; char: Char}
    | {type: 'block'; block: Block}
    | {type: 'char:move'; id: Lamport; parent: Char['parent']}
    | {type: 'char:delete'; id: Lamport}
    | {type: 'block:move'; id: Lamport; order: Block['order']}
    | {type: 'block:status'; id: Lamport; status: Block['status']}
    | {type: 'block:meta'; id: Lamport; meta: Block['meta']};

export const charOp = (text: string, id: Lamport, after: Lamport, ts: string): Op => ({
    type: 'char',
    char: {text, id, deleted: false, parent: {id: after, ts}},
});

export const apply = (state: CachedState, op: Op): CachedState | false => {
    switch (op.type) {
        case 'char':
            return applyChar(state, op);
        case 'block':
            return applyBlock(state, op);
        case 'block:status':
            return applyBlockStatus(state, op);
        case 'char:move':
            return applyCharMove(state, op);
        case 'char:delete':
            return applyCharDelete(state, op);
        case 'block:move':
            return applyBlockMove(state, op);
        case 'block:meta':
            return applyBlockMeta(state, op);
    }
};

const applyCharDelete = (
    {state, cache}: CachedState,
    op: Op & {type: 'char:delete'},
): CachedState | false => {
    const {chars, blocks, maxSeenCount} = state;
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
            chars: {...chars, [charId]: current},
            blocks,
            maxSeenCount: Math.max(maxSeenCount, op.id[0]),
        },
        cache,
    };
};

const applyCharMove = (
    {state, cache}: CachedState,
    op: Op & {type: 'char:move'},
): CachedState | false => {
    const {chars, blocks, maxSeenCount} = state;
    const charId = lamportToString(op.id);
    let current = state.chars[charId];
    if (!current) {
        return false;
    }
    if (!laterTs(op.parent.ts, current.parent.ts)) {
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
            chars: {...chars, [charId]: current},
            blocks,
            maxSeenCount: Math.max(maxSeenCount, op.parent.id[0]),
        },
        cache: {
            ...cache,
            charContents,
        },
    };
};

const applyBlockStatus = (
    state: CachedState,
    op: Op & {type: 'block:status'},
): CachedState | false => {
    const id = lamportToString(op.id);
    let current = state.state.blocks[id];
    if (!current) {
        return false;
    }
    current = {...current};
    if (op.status.ts > current.status.ts) {
        current.status = op.status;
    }
    return {
        state: {
            ...state.state,
            blocks: {...state.state.blocks, [id]: current},
        },
        cache: state.cache,
    };
};

const applyBlockMove = (
    {state, cache}: CachedState,
    op: Op & {type: 'block:move'},
): CachedState | false => {
    const id = lamportToString(op.id);
    let current = state.blocks[id];
    if (!current) {
        return false;
    }
    if (!laterTs(op.order.ts, current.order.ts)) {
        return {state, cache};
    }

    const blockChildren = {...cache.blockChildren};
    const oldParentId = lamportToString(current.order.parent);
    removeFromCache(blockChildren, oldParentId, id);

    const newParentId = lamportToString(op.order.parent);
    const blocks = {...state.blocks, [id]: {...current, order: op.order}};
    blockChildren[newParentId] = insertSortedBy(
        (blockChildren[newParentId] ?? []).slice(),
        id,
        (id) => blocks[id].order.index,
        compareLseqIds,
    );

    current = {...current, order: op.order};
    return {
        state: {
            ...state,
            blocks: {...state.blocks, [id]: current},
            maxSeenCount: Math.max(state.maxSeenCount, op.id[0], op.order.parent[0]),
        },
        cache: {...cache, blockChildren},
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
    if (!laterTs(op.meta.ts, current.meta.ts)) {
        return {state, cache};
    }
    return {
        state: {
            ...state,
            blocks: {...state.blocks, [id]: {...current, meta: op.meta}},
            maxSeenCount: Math.max(state.maxSeenCount, op.id[0]),
        },
        cache,
    };
};

const applyBlock = ({state, cache}: CachedState, {block}: Op & {type: 'block'}) => {
    const id = lamportToString(block.id);
    const current = state.blocks[id];
    if (current) {
        if (current.meta.ts > block.meta.ts) {
            block = {...block, meta: current.meta};
        }
        if (current.order.ts > block.order.ts) {
            block = {...block, order: current.order};
        }
        if (current.status.ts > block.status.ts) {
            block = {...block, status: current.status};
        }
    }

    const blocks = {...state.blocks, [id]: block};
    const parentId = lamportToString(block.order.parent);
    const blockChildren = {...cache.blockChildren};
    if (current) {
        const currentParentId = lamportToString(current.order.parent);
        removeFromCache(blockChildren, currentParentId, id);
    }
    blockChildren[parentId] = insertSortedBy(
        (blockChildren[parentId] ?? []).slice(),
        id,
        (id) => blocks[id].order.index,
        compareLseqIds,
    );
    return {
        state: {
            ...state,
            blocks,
            maxSeenCount: Math.max(state.maxSeenCount, block.id[0], block.order.parent[0]),
        },
        cache: {
            ...cache,
            blockChildren,
        },
    };
};

const laterTs = (one: Char['parent']['ts'], two: Char['parent']['ts']) => {
    if (typeof one === 'string') {
        if (typeof two === 'string') {
            return one > two;
        }
        return one === two[0] ? false : one > two[0];
    }
    if (typeof two === 'string') {
        return one[0] === two ? true : one[0] > two;
    }
    if (one[0] !== two[0]) return one[0] > two[0];
    for (let i = 0; i < one[1].length && i < two[1].length; i++) {
        if (one[1][i] !== two[1][i]) {
            return one[1][i] > two[1][i];
        }
    }
    return one[2] > two[2];
};

const applyChar = ({state, cache}: CachedState, {char}: Op & {type: 'char'}) => {
    const {chars, blocks, maxSeenCount} = state;
    const charId = lamportToString(char.id);
    const current = state.chars[charId];
    if (current) {
        if (current.text !== char.text) {
            throw new Error(`re-insert of ${charId} and the text is different`);
        }
        if (laterTs(current.parent.ts, char.parent.ts)) {
            char = {...char, parent: current.parent};
        }
        char = {...char, deleted: current.deleted};
    }
    const parentId = lamportToString(char.parent.id);
    const charContents = {...cache.charContents};
    if (current) {
        const currentParentId = lamportToString(current.parent.id);
        removeFromCache(charContents, currentParentId, charId);
    }
    charContents[parentId] = insertSortedRev(charContents[parentId]?.slice() ?? [], charId);
    return {
        state: {
            chars: {...chars, [charId]: char},
            blocks,
            maxSeenCount: Math.max(
                maxSeenCount,
                char.id[0],
                char.parent.id[0],
                ...(Array.isArray(char.parent.ts) ? char.parent.ts[1].map((id) => id[0]) : []),
            ),
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
        if (item > array[i]) {
            array.splice(i, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
};

export const applyMany = (state: CachedState, ops: Op[]) => {
    ops.forEach((op) => {
        const result = apply(state, op);
        if (result === false) {
            throw new Error(`op was pending`);
        }
        state = result;
    });
    return state;
};

export const addChars = (
    state: CachedState,
    text: string,
    after: Lamport,
    ts: () => HLC,
): CachedState => {
    let i = state.state.maxSeenCount + 1;
    const ops: Op[] = [];
    for (let char of new Intl.Segmenter().segment(text)) {
        const id: Lamport = [i, 'self'];
        ops.push(charOp(char.segment, id, after, ts()));
        after = id;
        i++;
    }
    return applyMany(state, ops);
};

export const cachedState = (state: State): CachedState => ({
    state,
    cache: organizeState(state.blocks, state.chars),
});

// root blocks are those whose parent = 'root'

// Blocks ... are created with a single char. but if there happen to be multiple, idk we can handle it.

export const blockContents = (state: CachedState, id: string): string =>
    state.cache.charContents[id].map((id) => charToString(state, id)).join('');

export const charToString = (state: CachedState, id: string): string => {
    const char = state.state.chars[id];
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
        if (block.status.archived) {
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
    return blockChildren['0000-root']?.flatMap(showBlock).join('\n');
};

export function organizeState(blocks: Record<string, Block>, chars: Record<string, Char>): Cache {
    const blockChildren: Record<string, string[]> = {};
    for (const [id, block] of Object.entries(blocks)) {
        const pid = lamportToString(block.order.parent);
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
        items.sort((a, b) => b.localeCompare(a));
    });
    return {blockChildren, charContents};
}

const findTail = (char: string, contents: Cache['charContents']) => {
    while (contents[char]?.length) {
        char = contents[char][contents[char].length - 1];
    }
    return char;
};

export const split = (
    {state, cache}: CachedState,
    at: {block: Lamport; char: Lamport},
    ts: string,
): Op[] => {
    const {chars, blocks, maxSeenCount} = state;
    const bid = lamportToString(at.block);
    if (bid === lamportToString(at.char)) {
        // in this case we should create a new empty *previous sibling* block
        throw new Error(`not implemented yet`);
    }
    const current = blocks[bid];
    const siblings = cache.blockChildren[lamportToString(current.order.parent)];
    const afterId = siblings[siblings.indexOf(bid) + 1];
    const after = afterId ? blocks[afterId].order.index : null;
    const block: Block = {
        id: [maxSeenCount + 1, 'self'],
        meta: current.meta,
        order: {
            ts,
            parent: current.order.parent,
            index: createLseqIdBetween(current.order.index, after, {
                actorId: 'self',
                counter: maxSeenCount + 1,
            }),
        },
        status: {archived: false, ts},
    };
    const ops: Op[] = [{type: 'block', block}];

    ops.push({
        type: 'char:move',
        id: at.char,
        parent: {
            ts: ts,
            id: block.id,
        },
    });

    const ancestryPath: Lamport[] = [];
    let tail = chars[findTail(lamportToString(at.char), cache.charContents)].id;
    let cid = lamportToString(at.char);
    let stop = 1000;
    while (cid !== bid) {
        if (stop-- < 0) throw new Error(`Too deep`);
        ancestryPath.unshift(parseLamportString(cid));

        const pid = lamportToString(chars[cid].parent.id);
        const children = cache.charContents[pid];
        for (let at = children.indexOf(cid) + 1; at < children.length; at++) {
            const id = children[at];
            ops.push({
                type: 'char:move',
                id: chars[id].id,
                parent: {
                    ts: [lastMoveTs(chars[id].parent.ts), ancestryPath, ts],
                    id: tail,
                },
            });
            tail = chars[findTail(id, cache.charContents)].id;
        }
        cid = pid;
    }

    return ops;
};

const lastMoveTs = (ts: Char['parent']['ts']) => (typeof ts === 'string' ? ts : ts[2]);
