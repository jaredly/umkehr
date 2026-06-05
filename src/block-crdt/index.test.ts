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

it('applies block meta by timestamp', () => {
    let state = apply(cachedState(init), {
        type: 'block:meta',
        id: [0, 'self'],
        meta: {type: 'bullets', ts: '00002'},
    }) as CachedState;

    expect(state.state.blocks['0000-self'].meta).toEqual({type: 'bullets', ts: '00002'});
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars));

    state = apply(state, {
        type: 'block:meta',
        id: [0, 'self'],
        meta: {type: 'blockquote', ts: '00001'},
    }) as CachedState;

    expect(state.state.blocks['0000-self'].meta).toEqual({type: 'bullets', ts: '00002'});
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars));
});

it('moves blocks by timestamp and updates child cache', () => {
    let state = apply(cachedState(init), {
        type: 'block',
        block: {
            id: [1, 'self'],
            meta: {type: 'paragraph', ts: '00002'},
            order: {index: '1', ts: '00002', parent: [0, 'root']},
            status: {archived: false, ts: '00002'},
        },
    }) as CachedState;
    state = apply(state, {
        type: 'block',
        block: {
            id: [2, 'self'],
            meta: {type: 'paragraph', ts: '00002'},
            order: {index: '2', ts: '00002', parent: [0, 'root']},
            status: {archived: false, ts: '00002'},
        },
    }) as CachedState;

    state = apply(state, {
        type: 'block:move',
        id: [2, 'self'],
        order: {index: '0', ts: '00003', parent: [1, 'self']},
    }) as CachedState;

    expect(state.state.blocks['0002-self'].order).toEqual({
        index: '0',
        ts: '00003',
        parent: [1, 'self'],
    });
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars));

    state = apply(state, {
        type: 'block:move',
        id: [2, 'self'],
        order: {index: '9', ts: '00002', parent: [0, 'root']},
    }) as CachedState;

    expect(state.state.blocks['0002-self'].order).toEqual({
        index: '0',
        ts: '00003',
        parent: [1, 'self'],
    });
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars));
});
