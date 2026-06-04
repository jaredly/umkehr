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
        },
    },
    maxSeenCount: 0,
};

export const addChar = (
    {state, cache}: CachedState,
    text: string,
    after: Lamport,
    ts: () => HLC,
): CachedState => {
    const {chars, blocks, maxSeenCount} = state;
    const id = maxSeenCount + 1;
    const charId = lamportToString([id, 'self']);
    const newChar: Char = {
        text,
        id: [id, 'self'],
        deleted: false,
        parent: {id: after, ts: ts()},
    };
    const parentId = lamportToString(after);
    return {
        state: {
            chars: {...chars, [charId]: newChar},
            blocks,
            maxSeenCount: id,
        },
        cache: {
            ...cache,
            charContents: {
                ...cache.charContents,
                [parentId]: [charId, ...(cache.charContents[parentId] ?? [])],
            },
        },
    };
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
    const head = charContents[lamportToString(block)].toSorted((a, b) => b.localeCompare(a));
    selection--;

    const charStack: string[][] = [head.slice()];
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
            charStack.unshift(charContents[id].toSorted((a, b) => b.localeCompare(a)));
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

export const lamportFromString = (raw: string) => {
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
            id +
                ': ' +
                charContents[id]
                    ?.sort((a, b) => b.localeCompare(a))
                    .map(showChar)
                    .join(''),
            ...(blockChildren[id]
                ?.sort((a, b) => blocks[a].order.index.localeCompare(blocks[b].order.index))
                .flatMap(showBlock)
                .map((line) => symbol + ' ' + line) ?? []),
        ];
    };
    const showChar = (id: string): string => {
        const char = chars[id];
        return (
            char.text +
            (charContents[id]
                ?.sort((a, b) => b.localeCompare(a))
                .map(showChar)
                .join('') ?? '')
        );
    };
    return blockChildren['0000-root']
        ?.sort((a, b) => blocks[a].order.index.localeCompare(blocks[b].order.index))
        .map(showBlock)
        .join('\n');
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

// type CRDTUpdate =
//     | {
//           type: 'create';
//           char: Char;
//       }
//     | {
//           type: 'move';
//           id: Lamport;
//       };

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
    Object.values(charContents).forEach((items) => {
        items.sort((a, b) => b.localeCompare(a));
    });
    return {blockChildren, charContents};
}
