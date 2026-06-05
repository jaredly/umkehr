type Lamport = [number, string];
type HLC = string;

export type Char = {
    id: Lamport;
    text: string;
    deleted: boolean;
    parent: {
        ts: HLC | [HLC, Lamport[], HLC];
        id: Lamport;
    };
    // NOTE: getting formatting to be happy will have some 'markOpsBefore/markOpsAfter' stuff going on.
    // as well as privenance for splits or somehting like that
};

export type Block = {
    id: Lamport;
    meta:
        | {type: 'paragraph'; ts: HLC}
        | {type: 'blockquote'; ts: HLC}
        | {type: 'bullets'; ts: HLC}
        | {type: 'checkboxes'; ts: HLC; checked: Record<string, {ts: HLC; checked: boolean}>};
    order: {index: string; ts: HLC; parent: Lamport}; // fractional index
    status: {archived: boolean; ts: HLC};
};

export type State = {
    chars: Record<string, Char>;
    blocks: Record<string, Block>;
    maxSeenCount: number;
};

export type Cache = {
    blockChildren: Record<string, string[]>;
    charContents: Record<string, string[]>;
};

export type CachedState = {state: State; cache: Cache};

export const initialState: State = {
    chars: {},
    blocks: {
        '0000-self': {
            id: [0, 'self'],
            meta: {type: 'paragraph', ts: '0001'},
            order: {index: '0', ts: '0001', parent: [0, 'root']},
            status: {archived: false, ts: '0001'},
        },
    },
    maxSeenCount: 0,
};

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
    // return {
    //     state: {
    //         chars: {...chars, [charId]: {...chars[charId]}},
    //         blocks: {
    //             ...blocks,
    //             [lamportToString(block.id)]: block,
    //         },
    //         maxSeenCount: maxSeenCount + 1,
    //     },
    //     cache: {
    //         ...cache,
    //         blockChildren: {
    //             ...cache.blockChildren,
    //             [lamportToString(bid)]: [lamportToString(block.id)],
    //         },
    //         charContents: {
    //             ...cache.charContents,
    //             [pchar]: cache.charContents[pchar].filter((id) => id !== charId),
    //             [charId]: [lamportToString(block.id)],
    //         },
    //     },
    // };
};

type Op =
    | {type: 'char'; char: Char}
    | {type: 'block'; block: Block}
    | {type: 'char:move'; id: Lamport; parent: Char['parent']}
    | {type: 'char:delete'; id: Lamport}
    | {type: 'block:move'; id: Lamport; order: Block['order']}
    | {type: 'block:status'; id: Lamport; status: Block['status']}
    | {type: 'block:meta'; id: Lamport; meta: Block['meta']};

export const apply = (state: CachedState, op: Op): CachedState => {
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
            return state;
        case 'block:move':
        case 'block:meta':
            return state;
    }
};

const applyCharMove = ({state, cache}: CachedState, op: Op & {type: 'char:move'}) => {
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

const applyBlockStatus = (state: CachedState, op: Op & {type: 'block:status'}) => {
    const id = lamportToString(op.id);
    let current = state.state.blocks[id];
    if (!current) {
        throw new Error(`no current block`);
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

export const addChar = (
    {state, cache}: CachedState,
    text: string,
    after: Lamport,
    ts: () => HLC,
): CachedState => {
    const newChar: Char = {
        text,
        id: [state.maxSeenCount + 1, 'self'],
        deleted: false,
        parent: {id: after, ts: ts()},
    };
    return applyChar({state, cache}, {type: 'char', char: newChar});
};

export const selPos = (
    {state, cache}: CachedState,
    block: Lamport,
    selection: number,
): Lamport | null => {
    const {chars} = state;
    const {charContents} = cache;
    if (selection === 0) {
        return block;
    }
    selection--;

    const charStack: string[][] = [charContents[lamportToString(block)].slice()];
    while (charStack.length) {
        if (!charStack[0].length) {
            charStack.shift();
            continue;
        }
        const id = charStack[0].pop()!;
        if (selection === 0) {
            return chars[id].id;
        }
        selection--;
        if (charContents[id]) {
            charStack.unshift(charContents[id].slice());
        }
    }
    throw new Error('selection out of bounds');
};

export const addChars = (
    state: CachedState,
    text: string,
    after: Lamport,
    ts: () => HLC,
): CachedState => {
    for (let char of new Intl.Segmenter().segment(text)) {
        const newState = addChar(state, char.segment, after, ts);
        state = newState;
        after = [newState.state.maxSeenCount, 'self'];
    }
    return state;
};

export const cachedState = (state: State): CachedState => ({
    state,
    cache: organizeState(state.blocks, state.chars),
});

export const lamportToString = (lamport: Lamport) => {
    return `${lamport[0].toString().padStart(4, '0')}-${lamport[1]}`;
};

export const parseLamportString = (raw: string) => {
    const [count, id] = raw.split('-');
    return [parseInt(count), id] as Lamport;
};

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

/*

Can we try to do a little:





realization comes from walking the tree
also, like let's do smark cache updates


*/

/*

In a fight between:
"reparent for a split from ts X (new ts Y)"
"reparent for a split from ts X (new ts Z)"
we ignore new ts, and instead compare ancestry.
if "from ts X" differs, we use that.
if ancestry is the same, we use "new ts"

In a fight between:
"char" vs "block", it's the block's ts vs the char's 'from ts'


IF it's not for a split, but rather for an internal move, then we do normal ts resolution probably.
yeahhh I think that's right.
SO
now let's make it an easy lexical comparison.

[parent ts, parent ancestry path, new ts]

block:

[block ts]

creation:

[creation ts]

AND: the "from ts" is the "char's toplevel ts" before it was moved.
I think that does the trick?

Ancestry path comparison ... might be like a 'lower wins' instead of a 'higher wins'???? yes because 'lower means later' which is what we want to privilege.



big news question:
if I am going to ... insert text at the start of a block
wait what if I just have an empty-string char be the child of the block.
that is to say, the block gets a 'char id' lamport number.
and then insertion is normal

yeah I like that.



*/

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
