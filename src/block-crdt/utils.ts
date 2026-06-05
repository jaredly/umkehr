import {CachedState, Lamport} from './types';

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

export const lamportToString = (lamport: Lamport) => {
    return `${lamport[0].toString().padStart(4, '0')}-${lamport[1]}`;
};

export const parseLamportString = (raw: string) => {
    const [count, id] = raw.split('-');
    return [parseInt(count), id] as Lamport;
};
