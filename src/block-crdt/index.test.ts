import {it, expect} from 'vitest';
import {initialState, stateToString, addChars, selPos} from './index';

it('basic test', () => {
    const state = initialState;
    const str = stateToString(state);
    expect(str).toBe('a: A');
});

const ts = () => {
    let i = 0;
    return () => (i++).toString().padStart(5, '0');
};

it('add chars', () => {
    let state = initialState;
    const at = selPos(state, 'a', 1);
    expect(at).toBeTruthy();
    state = addChars(state, 'bcde', at!, ts());
    const str = stateToString(state);
    console.log(JSON.stringify(state.chars, null, 2));
    expect(str).toBe('a: Abcde');
});
