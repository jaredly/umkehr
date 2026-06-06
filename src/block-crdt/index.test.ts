import {it, expect} from 'vitest';
import {
    stateToString,
    addChars,
    cachedState,
    organizeState,
    charOp,
    apply,
    split,
    applyMany,
    charToString,
    blockContents,
} from './index';
import {Block, CachedState, Lamport} from './types';
import {lamportToString, selPos} from './utils';
import {initialState} from './initialState';
import {LseqId} from './lseq';

const init = initialState('self', '00001');
const initial = cachedState(init);

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

const addAfter = (state: CachedState, text: string, at: number, ts: () => string) => {
    const atPos = selPos(state, [0, 'self'], at);
    return addChars(state, text, atPos!, ts);
};

const run = (state: CachedState, items: [number, string][], ts: () => string) => {
    for (let [pos, text] of items) {
        state = addAfter(state, text, pos, ts);
        expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars));
    }
    return state;
};

const expectCache = (state: CachedState) => {
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars));
};

const block = (id: Lamport, index: number, ts: string, parent: Lamport = [0, 'root']): Block => ({
    id,
    meta: {type: 'paragraph', ts},
    order: {index: lseq(index), ts, parent},
    status: {archived: false, ts},
});

const lseq = (path: number, actorId = 'self', counter = path): LseqId => ({
    path: [path],
    opId: {actorId, counter},
});

it('split', () => {
    const ts = mts();
    let state = initial;
    state = addAfter(state, 'abcdef', 0, ts);
    const ops = split(state, {block: [0, 'self'], char: [4, 'self']}, ts());
    state = applyMany(state, ops);
    expect(stateToString(state)).toBe('0000-self: abc\n0007-self: def');
});

it('selPos maps to the correct char', () => {
    const ts = mts();
    let state = initial;
    state = addAfter(state, 'abcdef', 0, ts);
    for (let i = 1; i < 7; i++) {
        const at = selPos(state, [0, 'self'], i)!;
        expect(state.state.chars[lamportToString(at)].text).toBe('abcdef'[i - 1]);
    }
});

it('selPos maps to the correct char with tree', () => {
    const ts = mts();
    let state = initial;
    state = addAfter(state, 'abcdef', 0, ts);
    state = addAfter(state, 'xyz', 3, ts);
    const blockText = blockContents(state, lamportToString([0, 'self']));
    expect(blockText).toBe('abcxyzdef');
    for (let i = 1; i < blockText.length + 1; i++) {
        const at = selPos(state, [0, 'self'], i)!;
        expect(state.state.chars[lamportToString(at)].text).toBe(blockText[i - 1]);
    }
});

it('split with tree', () => {
    const ts = mts();
    let state = initial;
    state = addAfter(state, 'abcdef', 0, ts);
    state = addAfter(state, 'xyz', 3, ts);
    const blockText = blockContents(state, lamportToString([0, 'self']));
    expect(blockText).toBe('abcxyzdef');

    for (let i = 1; i < 8; i++) {
        const at = selPos(state, [0, 'self'], i)!;

        const ops = split(state, {block: [0, 'self'], char: at}, ts());
        const inner = applyMany(state, ops);
        // at every position yay
        expect(stateToString(inner)).toBe(
            `0000-self: ${blockText.slice(0, i - 1)}\n0010-self: ${blockText.slice(i - 1)}`,
        );
    }
});

it('concurrent edit and split', () => {
    const ts = mts();
    let state = initial;
    const bid: Lamport = [0, 'self'];
    state = addAfter(state, 'abc', 0, ts);
    state = addAfter(state, 'd', 2, ts);
    const blockText = blockContents(state, lamportToString(bid));
    expect(blockText).toBe('abdc');

    const at = selPos(state, bid, 4)!;

    const splitOps = split(state, {block: bid, char: at}, ts());
    const insertOp = charOp(
        'm',
        [state.state.maxSeenCount + 1, 'other'],
        selPos(state, bid, 1)!,
        ts(),
    );

    const one = applyMany(state, splitOps);
    expect(stateToString(one)).toBe(`0000-self: abd\n0005-self: c`);

    const two = applyMany(state, [insertOp]);
    expect(stateToString(two)).toBe(`0000-self: ambdc`);

    const left = applyMany(state, [...splitOps, insertOp]);
    expect(stateToString(left)).toBe(`0000-self: ambd\n0005-self: c`);

    const right = applyMany(state, [insertOp, ...splitOps]);
    expect(stateToString(right)).toBe(`0000-self: ambd\n0005-self: c`);
});

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
    expectCache(state);

    state = apply(state, {
        type: 'block:meta',
        id: [0, 'self'],
        meta: {type: 'blockquote', ts: '00001'},
    }) as CachedState;

    expect(state.state.blocks['0000-self'].meta).toEqual({type: 'bullets', ts: '00002'});
    expectCache(state);
});

it('moves blocks by timestamp and updates child cache', () => {
    let state = apply(cachedState(init), {
        type: 'block',
        block: block([1, 'self'], 1, '00002'),
    }) as CachedState;
    state = apply(state, {
        type: 'block',
        block: block([2, 'self'], 2, '00002'),
    }) as CachedState;

    state = apply(state, {
        type: 'block:move',
        id: [2, 'self'],
        order: {index: lseq(1, 'self', 2), ts: '00003', parent: [1, 'self']},
    }) as CachedState;

    expect(state.state.blocks['0002-self'].order).toEqual({
        index: lseq(1, 'self', 2),
        ts: '00003',
        parent: [1, 'self'],
    });
    expectCache(state);

    state = apply(state, {
        type: 'block:move',
        id: [2, 'self'],
        order: {index: lseq(9), ts: '00002', parent: [0, 'root']},
    }) as CachedState;

    expect(state.state.blocks['0002-self'].order).toEqual({
        index: lseq(1, 'self', 2),
        ts: '00003',
        parent: [1, 'self'],
    });
    expectCache(state);
});

it('returns false for ops that reference missing records', () => {
    const state = cachedState(init);

    expect(apply(state, {type: 'char:delete', id: [9, 'self']})).toBe(false);
    expect(
        apply(state, {
            type: 'char:move',
            id: [9, 'self'],
            parent: {id: [0, 'self'], ts: '00002'},
        }),
    ).toBe(false);
    expect(
        apply(state, {
            type: 'block:status',
            id: [9, 'self'],
            status: {archived: true, ts: '00002'},
        }),
    ).toBe(false);
    expect(
        apply(state, {
            type: 'block:move',
            id: [9, 'self'],
            order: {index: lseq(1), parent: [0, 'root'], ts: '00002'},
        }),
    ).toBe(false);
    expect(
        apply(state, {
            type: 'block:meta',
            id: [9, 'self'],
            meta: {type: 'bullets', ts: '00002'},
        }),
    ).toBe(false);
});

it('deletes chars idempotently and preserves cache consistency', () => {
    let state = addChars(cachedState(init), 'ab', [0, 'self'], mts());

    state = apply(state, {type: 'char:delete', id: [2, 'self']}) as CachedState;
    expect(state.state.chars['0002-self'].deleted).toBe(true);
    expect(state.cache.charContents['0001-self']).toEqual(['0002-self']);
    expect(stateToString(state)).toBe('0000-self: a');
    expectCache(state);

    state = apply(state, {type: 'char:delete', id: [2, 'self']}) as CachedState;
    expect(state.state.chars['0002-self'].deleted).toBe(true);
    expect(state.cache.charContents['0001-self']).toEqual(['0002-self']);
    expect(stateToString(state)).toBe('0000-self: a');
    expectCache(state);
});

it('moves chars by timestamp and ignores stale char inserts', () => {
    let state = addChars(cachedState(init), 'ab', [0, 'self'], mts());

    state = apply(state, {
        type: 'char:move',
        id: [2, 'self'],
        parent: {id: [0, 'self'], ts: '00005'},
    }) as CachedState;
    expect(stateToString(state)).toBe('0000-self: ba');
    expectCache(state);

    state = apply(state, {
        type: 'char:move',
        id: [2, 'self'],
        parent: {id: [1, 'self'], ts: '00004'},
    }) as CachedState;
    state = apply(state, charOp('b', [2, 'self'], [1, 'self'], '00003')) as CachedState;

    expect(stateToString(state)).toBe('0000-self: ba');
    expect(state.cache.charContents['0000-self']).toEqual(['0002-self', '0001-self']);
    expectCache(state);
});

it('rejects char reinserts with different text', () => {
    const state = addChars(cachedState(init), 'a', [0, 'self'], mts());

    expect(() => apply(state, charOp('b', [1, 'self'], [0, 'self'], '00002'))).toThrow(
        're-insert of 0001-self and the text is different',
    );
});

it('merges duplicate block inserts by field timestamps', () => {
    let state = apply(cachedState(init), {
        type: 'block',
        block: block([1, 'self'], 1, '00003'),
    }) as CachedState;

    state = apply(state, {
        type: 'block',
        block: {
            id: [1, 'self'],
            meta: {type: 'blockquote', ts: '00004'},
            order: {index: lseq(9), parent: [0, 'root'], ts: '00002'},
            status: {archived: true, ts: '00002'},
        },
    }) as CachedState;

    expect(state.state.blocks['0001-self']).toEqual({
        id: [1, 'self'],
        meta: {type: 'blockquote', ts: '00004'},
        order: {index: lseq(1), parent: [0, 'root'], ts: '00003'},
        status: {archived: false, ts: '00003'},
    });
    expect(state.cache.blockChildren['0000-root'].filter((id) => id === '0001-self')).toHaveLength(
        1,
    );
    expectCache(state);
});

it('archives and restores blocks by status timestamp', () => {
    let state = apply(cachedState(init), {
        type: 'block',
        block: block([1, 'self'], 1, '00002'),
    }) as CachedState;

    state = apply(state, {
        type: 'block:status',
        id: [1, 'self'],
        status: {archived: true, ts: '00003'},
    }) as CachedState;
    expect(state.state.blocks['0001-self'].status).toEqual({archived: true, ts: '00003'});
    expect(state.cache.blockChildren['0000-root']).toContain('0001-self');
    expect(stateToString(state)).not.toContain('0001-self');
    expectCache(state);

    state = apply(state, {
        type: 'block:status',
        id: [1, 'self'],
        status: {archived: false, ts: '00002'},
    }) as CachedState;
    expect(state.state.blocks['0001-self'].status).toEqual({archived: true, ts: '00003'});
    expect(state.cache.blockChildren['0000-root']).toContain('0001-self');
    expect(stateToString(state)).not.toContain('0001-self');
    expectCache(state);

    state = apply(state, {
        type: 'block:status',
        id: [1, 'self'],
        status: {archived: false, ts: '00004'},
    }) as CachedState;
    expect(state.state.blocks['0001-self'].status).toEqual({archived: false, ts: '00004'});
    expect(state.cache.blockChildren['0000-root']).toContain('0001-self');
    expectCache(state);
});
