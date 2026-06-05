import {State, Lamport, CachedState, Cache, Char, HLC, Block} from './types';
import {lamportToString} from './utils';

export const split = (
    {state, cache}: CachedState,
    bid: Lamport,
    at: Lamport,
    ts: () => HLC,
): CachedState => {
    const {chars, blocks, maxSeenCount} = state;
    const current = blocks[lamportToString(bid)];
    const block: Block = {
        id: [maxSeenCount + 1, 'self'],
        meta: current.meta,
        order: {ts: ts(), parent: current.order.parent, index: current.order.index + 'a'},
        status: {archived: false, ts: '0001'},
    };
    const charId = lamportToString(at);
    const pchar = lamportToString(chars[charId].parent.id);
    return cachedState({
        chars: {...chars, [charId]: {...chars[charId]}},
        blocks: {
            ...blocks,
            [lamportToString(block.id)]: block,
        },
        maxSeenCount: maxSeenCount + 1,
    });
};

type Op =
    | {type: 'char'; char: Char}
    | {type: 'block'; block: Block}
    | {type: 'char:move'; id: Lamport; parent: Char['parent']}
    | {type: 'char:delete'; id: Lamport}
    | {type: 'block:move'; id: Lamport; order: Block['order']}
    | {type: 'block:status'; id: Lamport; status: Block['status']}
    | {type: 'block:meta'; id: Lamport; meta: Block['meta']};

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
        case 'block:meta':
            return state;
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
    const charContents = {...cache.charContents};
    const ppid = lamportToString(current.parent.id);
    charContents[ppid] = charContents[ppid].filter((id) => id !== charId);
    current = {...current, deleted: true};
    return {
        state: {
            chars: {...chars, [charId]: current},
            blocks,
            maxSeenCount: Math.max(maxSeenCount, op.id[0]),
        },
        cache: {
            ...cache,
            charContents,
        },
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
    charContents[ppid] = charContents[ppid].filter((id) => id !== charId);
    current = {...current, parent: op.parent};
    const pid = lamportToString(op.parent.id);
    charContents[pid] = insertSortedRev(charContents[pid].slice(), charId);
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
    const pid = lamportToString(current.order.parent);
    current = {...current};
    const blockChildren = {...state.cache.blockChildren};
    if (op.status.ts > current.status.ts) {
        if (current.status.archived && !op.status.archived) {
            blockChildren[pid] = insertSortedBy(
                blockChildren[pid].slice(),
                id,
                (id) => state.state.blocks[id].order.index,
            );
        }
        if (!current.status.archived && op.status.archived) {
            blockChildren[pid] = blockChildren[pid].slice().filter((d) => d !== id);
        }
        current.status = op.status;
    }
    return {
        state: {
            ...state.state,
            blocks: {...state.state.blocks, [id]: {...current, status: op.status}},
        },
        cache: {...state.cache, blockChildren},
    };
};

const applyBlock = ({state, cache}: CachedState, {block}: Op & {type: 'block'}) => {
    const id = lamportToString(block.id);
    const parentId = lamportToString(block.order.parent);
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
    return {
        state: {
            ...state,
            blocks,
            maxSeenCount: Math.max(state.maxSeenCount, block.id[0], block.order.parent[0]),
        },
        cache: {
            ...cache,
            blockChildren: {
                ...cache.blockChildren,
                [parentId]: insertSortedBy(
                    cache.blockChildren[parentId]?.slice() ?? [],
                    id,
                    (id) => blocks[id].order.index,
                ),
            },
        },
    };
};

const laterTs = (one: Char['parent']['ts'], two: Char['parent']['ts']) => {
    if (typeof one === 'string') {
        if (typeof two === 'string') {
            return one > two;
        }
        return one > two[0];
    }
    if (typeof two === 'string') {
        return one[0] > two;
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
    const parentId = lamportToString(char.parent.id);
    if (state.chars[charId]) {
        const current = state.chars[charId];
        if (current.text !== char.text) {
            throw new Error(`re-insert of ${charId} and the text is different`);
        }
        if (laterTs(current.parent.ts, char.parent.ts)) {
            char = {...char, parent: current.parent};
        }
    }
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
            charContents: {
                ...cache.charContents,
                [parentId]: insertSortedRev(cache.charContents[parentId]?.slice() ?? [], charId),
            },
        },
    };
};

const insertSortedBy = (array: string[], item: string, order: (id: string) => string) => {
    const self = order(item);
    for (let i = 0; i < array.length; i++) {
        if (self < order(array[i])) {
            array.splice(i, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
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

const applyMany = (state: CachedState, ops: Op[]) => {
    ops.forEach((op) => {
        const result = apply(state, op);
        if (result === false) {
            throw new Error(`op was pending`);
        }
        state = result;
    });
    return state;
};

export const charOp = (text: string, id: Lamport, after: Lamport, ts: string): Op => ({
    type: 'char',
    char: {
        text,
        id,
        deleted: false,
        parent: {id: after, ts},
    },
});

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

export const stateToString = (state: CachedState) => {
    const {chars, blocks} = state.state;
    const {blockChildren, charContents} = state.cache;
    const showBlock = (id: string): string[] => {
        const block = blocks[id];
        const symbol = {paragraph: ' ', bullets: '•', checkboxes: '☐', blockquote: '|'}[
            block.meta.type
        ];
        return [
            id + ': ' + charContents[id]?.map(showChar).join(''),
            ...(blockChildren[id]?.flatMap(showBlock).map((line) => symbol + ' ' + line) ?? []),
        ];
    };
    const showChar = (id: string): string => {
        const char = chars[id];
        return char.text + (charContents[id]?.map(showChar).join('') ?? '');
    };
    return blockChildren['0000-root']?.map(showBlock).join('\n');
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
        items.sort((a, b) => blocks[b].order.index.localeCompare(blocks[a].order.index));
    });
    Object.values(charContents).forEach((items) => {
        items.sort((a, b) => b.localeCompare(a));
    });
    return {blockChildren, charContents};
}
