import {it, expect} from 'vitest';
import {
    initialState,
    stateToString,
    addChars,
    selPos,
    addChar,
    cachedState,
    CachedState,
} from './index';

it('basic test', () => {
    const state = addChar(cachedState(initialState), 'A', [0, 'self'], mts());
    const str = stateToString(state);
    expect(str).toBe('0000-self: A');
});

const mts = (init = 0) => {
    let i = init;
    return () => (i++).toString().padStart(5, '0');
};

const run = (state: CachedState, items: [number, string][], ts: () => string) => {
    for (let [pos, text] of items) {
        const at = selPos(state, [0, 'self'], pos);
        state = addChars(state, text, at!, ts);
    }
    return state;
};

it('add chars', () => {
    let state = run(
        cachedState(initialState),
        [
            [0, 'bcde'],
            [0, 'xyz'],
        ],
        mts(),
    );
    const str = stateToString(state);
    expect(str).toBe('0000-self: xyzbcde');
});

it('single chars', () => {
    let state = run(
        cachedState(initialState),
        [
            [0, 'a'],
            [1, 'b'],
            [2, 'c'],
            [0, 'xyz'],
        ],
        mts(),
    );
    const str = stateToString(state);
    expect(str).toBe('0000-self: xyzabc');
});
