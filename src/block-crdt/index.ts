type Lamport = [number, string];
type HLC = string;

export type Char = {
    id: Lamport;
    text: string;
    deleted: boolean;
    parent:
        | {
              type: 'char';
              ts: HLC | [HLC, Lamport[], HLC];
              id: Lamport;
          }
        | {type: 'block'; id: string; ts: HLC};
    // NOTE: getting formatting to be happy will have some 'markOpsBefore/markOpsAfter' stuff going on.
    // as well as privenance for splits or somehting like that
};

export type Block = {
    id: string;
    meta:
        | {type: 'paragraph'; ts: HLC}
        | {type: 'blockquote'; ts: HLC}
        | {type: 'bullets'; ts: HLC}
        | {type: 'checkboxes'; ts: HLC; checked: Record<string, {ts: HLC; checked: boolean}>};
    order: {index: string; ts: HLC; parent: string}; // fractional index
};

export type State = {
    chars: Record<string, Char>;
    blocks: Record<string, Block>;
    maxSeenCount: number;
};

export const initialState: State = {
    chars: {
        '0-self': {
            text: 'A',
            id: [0, 'self'],
            deleted: false,
            parent: {type: 'block', id: 'a', ts: '0001'},
        },
    },
    blocks: {
        a: {
            id: 'a',
            meta: {type: 'paragraph', ts: '0001'},
            order: {index: '0', ts: '0001', parent: 'root'},
        },
    },
    maxSeenCount: 0,
};

export const addChar = (state: State, text: string, after: Lamport, ts: () => HLC): State => {
    const {chars, blocks, maxSeenCount} = state;
    const id = maxSeenCount + 1;
    const charId = lamportToString([id, 'self']);
    const newChar: Char = {
        text,
        id: [id, 'self'],
        deleted: false,
        parent: {type: 'char', id: after, ts: ts()},
    };
    return {
        chars: {...chars, [charId]: newChar},
        blocks,
        maxSeenCount: id,
    };
};

export const selPos = (state: State, block: string, selection: number): Lamport | null => {
    const {chars, blocks} = state;
    const {charContents, blockContents} = organizeState(blocks, chars);
    const head = blockContents[block];
    if (head.length !== 1) throw new Error('multiple block children');
    if (selection === 1) {
        return chars[head[0]].id;
    }
    const sorted = charContents[head[0]].sort((a, b) => b.localeCompare(a));
    return sorted[selection] ? chars[sorted[selection]].id : null;
};

export const addChars = (state: State, text: string, after: Lamport, ts: () => HLC): State => {
    for (let char of new Intl.Segmenter().segment(text)) {
        const newState = addChar(state, char.segment, after, ts);
        state = newState;
        after = newState.chars[lamportToString([newState.maxSeenCount, 'self'])].id;
    }
    return state;
};

export const lamportToString = (lamport: Lamport) => {
    return `${lamport[0]}-${lamport[1]}`;
};

// root blocks are those whose parent = 'root'

// Blocks ... are created with a single char. but if there happen to be multiple, idk we can handle it.

export const stateToString = (state: State) => {
    const {chars, blocks} = state;
    const {blockChildren, charContents, blockContents} = organizeState(blocks, chars);
    console.log(charContents);
    const showBlock = (id: string): string[] => {
        const block = blocks[id];
        const symbol = {paragraph: ' ', bullets: '•', checkboxes: '☐', blockquote: '|'}[
            block.meta.type
        ];
        return [
            id + ': ' + blockContents[id].map(showChar).join(''),
            ...(blockChildren[id]
                ?.sort((a, b) => blocks[a].order.index.localeCompare(blocks[b].order.index))
                .flatMap(showBlock)
                .map((line) => symbol + ' ' + line) ?? []),
        ];
    };
    const showChar = (id: string): string => {
        const char = chars[id];
        return (
            char.text + (charContents[id]?.sort((a, b) => b.localeCompare(a)).map(showChar) ?? '')
        );
    };
    return blockChildren.root.map(showBlock).join('\n');
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


*/

type CRDTUpdate =
    | {
          type: 'create';
          char: Char;
      }
    | {
          type: 'move';
          id: Lamport;
      };

function organizeState(blocks: Record<string, Block>, chars: Record<string, Char>) {
    const blockChildren: Record<string, string[]> = {};
    for (const [id, block] of Object.entries(blocks)) {
        if (!blockChildren[block.order.parent]) {
            blockChildren[block.order.parent] = [];
        }
        blockChildren[block.order.parent].push(id);
    }
    const charContents: Record<string, string[]> = {};
    const blockContents: Record<string, string[]> = {};
    for (const [id, char] of Object.entries(chars)) {
        if (char.parent.type === 'block') {
            if (!blockContents[char.parent.id]) {
                blockContents[char.parent.id] = [];
            }
            blockContents[char.parent.id].push(id);
        } else {
            const pid = lamportToString(char.parent.id);
            if (!charContents[pid]) {
                charContents[pid] = [];
            }
            charContents[pid].push(id);
        }
    }
    return {blockChildren, charContents, blockContents};
}
