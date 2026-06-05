import {it, expect} from 'vitest';
import {stateToString, addChars, cachedState, organizeState, charOp, apply} from './index';
import {CachedState} from './types';
import {selPos} from './utils';
import {initialState} from './initialState';

const init = initialState('self', '00001');

it('basic test', () => {
    const state = apply(
        cachedState(init),
        charOp('A', [1, 'self'], [0, 'self'], mts()()),
    ) as CachedState;
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
        expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars));
    }
    return state;
};

it('add chars', () => {
    let state = run(
        cachedState(init),
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
        cachedState(init),
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
