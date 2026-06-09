import {CachedState, Lamport} from './types';
import {lamportToString} from './ids';

export {assertActorId, lamportToString, parseLamportString, validateLamport} from './ids';

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

    const stack = (charContents[lamportToString(block)] ?? []).slice().reverse();
    while (stack.length) {
        const id = stack.pop()!;
        const char = chars[id];
        const children = charContents[id];
        if (children) {
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
        if (!char || char.deleted) {
            continue;
        }
        selection--;
        if (selection === 0) {
            return chars[id].id;
        }
    }
    throw new Error('selection out of bounds');
};
