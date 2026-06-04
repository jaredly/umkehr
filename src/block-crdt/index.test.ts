import {it, expect} from 'vitest';
import {initialState, stateToString, addChars, selPos} from './index';

it('basic test', () => {
    const state = initialState;
    const str = stateToString(state);
    expect(str).toBe('0000-self: A');
});

const mts = (init = 0) => {
    let i = init;
    return () => (i++).toString().padStart(5, '0');
};

it('add chars', () => {
    let state = initialState;
    const ts = mts();
    const at = selPos(state, [0, 'self'], 1);
    expect(at).toBeTruthy();
    state = addChars(state, 'bcde', at!, ts);
    const str = stateToString(state);
    expect(str).toBe('0000-self: Abcde');
});
