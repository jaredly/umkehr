import {it, expect} from 'vitest';
import fc from 'fast-check';
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
    findTail,
    join,
    Op,
    activeJoinRecords,
    orderedCharIdsForBlock,
    visibleBlockChildren,
} from './index';
import {Block, CachedState, Lamport} from './types';
import {lamportToString, parseLamportString, selPos} from './utils';
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
        expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars, state.state.joins));
    }
    return state;
};

const expectCache = (state: CachedState) => {
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars, state.state.joins));
};

const block = (id: Lamport, index: number, ts: string, parent: Lamport = [0, 'root']): Block => ({
    id,
    meta: {type: 'paragraph', ts},
    order: {index: lseq(index), ts, parent},
    deleted: false,
});

const lseq = (path: number, actorId = 'self', counter = path): LseqId => ({
    path: [path],
    opId: {actorId, counter},
});

it('split', () => {
    const ts = mts();
    let state = initial;
    state = addAfter(state, 'abcdef', 0, ts);
    const ops = split(state, splitLocation(state, [0, 'self'], [4, 'self']), ts(), 'self');
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

        const ops = split(state, splitLocation(state, [0, 'self'], at), ts(), 'self', {});
        const inner = applyMany(state, ops);
        // at every position yay
        expect(stateToString(inner)).toBe(
            `0000-self: ${blockText.slice(0, i - 1)}\n0010-self: ${blockText.slice(i - 1)}`,
        );
    }
});

const blockLines = (state: CachedState) =>
    rootBlockIds(state).map((child) => blockContents(state, child));

const rootBlockIds = (state: CachedState) =>
    visibleBlockChildren(state, lamportToString([0, 'root']));

const blockLength = (state: CachedState, blockId: string) => blockContents(state, blockId).length;

const splitLocation = (state: CachedState, block: Lamport, char: Lamport | null) => {
    if (char === null || lamportToString(char) === lamportToString(block)) {
        return {block, char, previous: char === null ? lastCharInBlock(state, block) : null};
    }
    const chars = orderedCharIdsForBlock(state, lamportToString(block), {visibleOnly: true});
    const index = chars.indexOf(lamportToString(char));
    return {
        block,
        char,
        previous: index > 0 ? state.state.chars[chars[index - 1]].id : null,
    };
};

const lastCharInBlock = (state: CachedState, block: Lamport): Lamport | null => {
    const chars = orderedCharIdsForBlock(state, lamportToString(block), {visibleOnly: true});
    const id = chars[chars.length - 1];
    return id ? state.state.chars[id].id : null;
};

const insertOps = (
    state: CachedState,
    actor: string,
    blockIndex: number,
    offset: number,
    text: string,
    ts: () => string,
): Op[] => {
    const bid = parseLamportString(rootBlockIds(state)[blockIndex]);
    let after = selPos(state, bid, offset)!;
    let next = state.state.maxSeenCount + 1;
    const ops: Op[] = [];
    for (const char of new Intl.Segmenter().segment(text)) {
        const id: Lamport = [next++, actor];
        ops.push(charOp(char.segment, id, after, ts()));
        after = id;
    }
    return ops;
};

class EditorHarness {
    state = cachedState(initialState('self', '00001'));

    constructor(readonly ts = mts()) {}

    blockIds() {
        return rootBlockIds(this.state);
    }

    lines() {
        return blockLines(this.state);
    }

    serialized() {
        return stateToString(this.state);
    }

    expectCache() {
        expectCache(this.state);
    }

    apply(ops: Op[]) {
        this.state = applyMany(this.state, ops);
        this.expectCache();
        return ops;
    }

    insert(actor: string, blockIndex: number, offset: number, text: string) {
        return this.apply(insertOps(this.state, actor, blockIndex, offset, text, this.ts));
    }

    split(actor: string, blockIndex: number, offset: number, options = {}) {
        const id = this.blockIds()[blockIndex];
        const bid = parseLamportString(id);
        const length = blockLength(this.state, id);
        const char = offset === 0 ? bid : offset >= length ? null : selPos(this.state, bid, offset + 1)!;
        return this.apply(split(this.state, splitLocation(this.state, bid, char), this.ts(), actor, options));
    }

    join(actor: string, leftIndex: number, rightIndex: number) {
        const ids = this.blockIds();
        return this.apply(
            join(
                this.state,
                parseLamportString(ids[leftIndex]),
                parseLamportString(ids[rightIndex]),
                this.ts(),
                actor,
            ),
        );
    }

    deleteRange(blockIndex: number, start: number, end: number) {
        const bid = parseLamportString(this.blockIds()[blockIndex]);
        const ops: Op[] = [];
        for (let offset = start + 1; offset <= end; offset++) {
            ops.push({type: 'char:delete', id: selPos(this.state, bid, offset)!});
        }
        return this.apply(ops);
    }
}

const expectConverges = (
    state: CachedState,
    left: Op[],
    right: Op[],
    expected: string[],
) => {
    const one = applyMany(state, [...left, ...right]);
    const two = applyMany(state, [...right, ...left]);
    expect(blockLines(one)).toEqual(expected);
    expect(blockLines(two)).toEqual(expected);
    expectCache(one);
    expectCache(two);
};

it('split, move, and join', () => {
    const ts = mts();
    let state = initial;
    const bid: Lamport = [0, 'self'];
    state = addAfter(state, 'abcdef', 0, ts);
    const first = selPos(state, bid, 3)!;
    const second = selPos(state, bid, 5)!;

    const splitFirst = split(state, splitLocation(state, bid, first), ts(), 'one', {random: () => 0});
    const splitSecond = split(state, splitLocation(state, bid, second), ts(), 'two', {
        random: () => 1,
    });
    state = applyMany(state, [...splitFirst, ...splitSecond]);
    expect(blockLines(state)).toEqual(['ab', 'cd', 'ef']);

    const blocks = state.cache.blockChildren[lamportToString([0, 'root'])];
    const firstTail = findTail(state.cache.charContents[blocks[0]][0], state.cache.charContents);
    const thirdTail = findTail(state.cache.charContents[blocks[2]][0], state.cache.charContents);
    state = applyMany(state, [
        {
            type: 'char:move',
            id: parseLamportString(state.cache.charContents[blocks[2]][0]),
            parent: {
                id: parseLamportString(firstTail),
                ts: ts(),
            },
        },
        {
            type: 'char:move',
            id: parseLamportString(state.cache.charContents[blocks[1]][0]),
            parent: {
                id: parseLamportString(thirdTail),
                ts: ts(),
            },
        },
        {
            type: 'block:delete',
            id: parseLamportString(blocks[1]),
        },
        {
            type: 'block:delete',
            id: parseLamportString(blocks[2]),
        },
    ]);

    expect(blockLines(state)).toEqual(['abefcd']);
});

it('concurrent tree split', () => {
    const ts = mts();
    let state = initial;
    const bid: Lamport = [0, 'self'];
    state = addAfter(state, 'abcdef', 0, ts);
    state = addAfter(state, 'xyz', 3, ts);
    const first = selPos(state, bid, 3)!;
    const second = selPos(state, bid, 5)!;

    const splitSecond = split(state, splitLocation(state, bid, second), ts(), 'two', {
        random: () => 1,
    });
    const splitFirst = split(state, splitLocation(state, bid, first), ts(), 'one', {random: () => 0});

    expect(blockLines(applyMany(state, splitFirst))).toEqual(['ab', 'cxyzdef']);
    expect(blockLines(applyMany(state, splitSecond))).toEqual(['abcx', 'yzdef']);

    expect(blockLines(applyMany(state, [...splitFirst, ...splitSecond]))).toEqual([
        'ab',
        'cx',
        'yzdef',
    ]);

    expect(blockLines(applyMany(state, [...splitSecond, ...splitFirst]))).toEqual([
        'ab',
        'cx',
        'yzdef',
    ]);
});

it('concurrent split and split', () => {
    const ts = mts();
    let state = initial;
    const bid: Lamport = [0, 'self'];
    state = addAfter(state, 'abcdef', 0, ts);
    const first = selPos(state, bid, 3)!;
    const second = selPos(state, bid, 5)!;

    const splitFirst = split(state, splitLocation(state, bid, first), ts(), 'one', {random: () => 0});
    const splitSecond = split(state, splitLocation(state, bid, second), ts(), 'two', {
        random: () => 1,
    });

    expect(blockLines(applyMany(state, splitFirst))).toEqual(['ab', 'cdef']);
    expect(blockLines(applyMany(state, splitSecond))).toEqual(['abcd', 'ef']);

    expect(blockLines(applyMany(state, [...splitFirst, ...splitSecond]))).toEqual([
        'ab',
        'cd',
        'ef',
    ]);
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

    const splitOps = split(state, splitLocation(state, bid, at), ts(), 'self', {});
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
            type: 'block:delete',
            id: [9, 'self'],
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
            deleted: true,
        },
    }) as CachedState;

    expect(state.state.blocks['0001-self']).toEqual({
        id: [1, 'self'],
        meta: {type: 'blockquote', ts: '00004'},
        order: {index: lseq(1), parent: [0, 'root'], ts: '00003'},
        deleted: true,
    });
    expect(state.cache.blockChildren['0000-root'].filter((id) => id === '0001-self')).toHaveLength(
        1,
    );
    expectCache(state);
});

it('deletes blocks irreversibly and preserves cache consistency', () => {
    let state = apply(cachedState(init), {
        type: 'block',
        block: block([1, 'self'], 1, '00002'),
    }) as CachedState;

    state = apply(state, {
        type: 'block:delete',
        id: [1, 'self'],
    }) as CachedState;
    expect(state.state.blocks['0001-self'].deleted).toBe(true);
    expect(state.cache.blockChildren['0000-root']).toContain('0001-self');
    expect(stateToString(state)).not.toContain('0001-self');
    expectCache(state);

    state = apply(state, {
        type: 'block:delete',
        id: [1, 'self'],
    }) as CachedState;
    expect(state.state.blocks['0001-self'].deleted).toBe(true);
    expect(state.cache.blockChildren['0000-root']).toContain('0001-self');
    expect(stateToString(state)).not.toContain('0001-self');
    expectCache(state);

    state = apply(state, {
        type: 'block',
        block: block([1, 'self'], 9, '00004'),
    }) as CachedState;
    expect(state.state.blocks['0001-self'].deleted).toBe(true);
    expect(state.cache.blockChildren['0000-root']).toContain('0001-self');
    expect(stateToString(state)).not.toContain('0001-self');
    expectCache(state);
});

it('harness inserts at start, middle, and end with multiple actors', () => {
    const editor = new EditorHarness();

    editor.insert('alice', 0, 0, 'ac');
    editor.insert('bob', 0, 1, 'b');
    editor.insert('alice', 0, 3, 'd');

    expect(editor.lines()).toEqual(['abcd']);
    expect(editor.serialized()).toBe('0000-self: abcd');
});

it('inserts grapheme clusters as visible text', () => {
    const editor = new EditorHarness();

    editor.insert('alice', 0, 0, 'a👩‍💻b');

    expect(editor.lines()).toEqual(['a👩‍💻b']);
});

it('splits at start, middle, and end using user offsets', () => {
    const editor = new EditorHarness();

    editor.insert('alice', 0, 0, 'abcd');
    editor.split('alice', 0, 0, {random: () => 0});
    expect(editor.lines()).toEqual(['', 'abcd']);

    editor.split('alice', 1, 2, {random: () => 0});
    expect(editor.lines()).toEqual(['', 'ab', 'cd']);

    editor.split('alice', 2, 2, {random: () => 0});
    expect(editor.lines()).toEqual(['', 'ab', 'cd', '']);
});

it('joins adjacent blocks including empty blocks', () => {
    const editor = new EditorHarness();

    editor.insert('alice', 0, 0, 'abcd');
    editor.split('alice', 0, 2, {random: () => 0});
    editor.join('alice', 0, 1);
    expect(editor.lines()).toEqual(['abcd']);

    editor.split('alice', 0, 0, {random: () => 0});
    editor.join('alice', 0, 1);
    expect(editor.lines()).toEqual(['abcd']);

    editor.split('alice', 0, 4, {random: () => 0});
    editor.join('alice', 0, 1);
    expect(editor.lines()).toEqual(['abcd']);
});

it('joins tree-shaped block contents', () => {
    const editor = new EditorHarness();

    editor.insert('alice', 0, 0, 'abcdef');
    editor.insert('alice', 0, 3, 'xyz');
    expect(editor.lines()).toEqual(['abcxyzdef']);

    editor.split('alice', 0, 3, {random: () => 0});
    expect(editor.lines()).toEqual(['abc', 'xyzdef']);

    editor.join('alice', 0, 1);
    expect(editor.lines()).toEqual(['abcxyzdef']);
});

it('deletes ranges while keeping deleted chars with descendants valid', () => {
    const editor = new EditorHarness();

    editor.insert('alice', 0, 0, 'abc');
    editor.insert('alice', 0, 2, 'x');
    expect(editor.lines()).toEqual(['abxc']);

    editor.deleteRange(0, 1, 3);
    expect(editor.lines()).toEqual(['ac']);

    editor.expectCache();
});

it('allows char moves to point at missing parents', () => {
    let state = addChars(cachedState(init), 'ab', [0, 'self'], mts());

    state = apply(state, {
        type: 'char:move',
        id: [2, 'self'],
        parent: {id: [99, 'missing'], ts: '00005'},
    }) as CachedState;

    expect(state.state.chars['0002-self'].parent.id).toEqual([99, 'missing']);
    expectCache(state);
});

it('converges concurrent inserts at the same position', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abc', ts));

    const left = insertOps(state, 'alice', 0, 1, 'X', ts);
    const right = insertOps(state, 'bob', 0, 1, 'Y', ts);

    expectConverges(state, left, right, ['aYXbc']);
});

it('converges insert before and after a concurrent split point', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcd', ts));
    const bid = parseLamportString(rootBlockIds(state)[0]);

    expectConverges(
        state,
        split(state, splitLocation(state, bid, selPos(state, bid, 3)!), ts(), 'alice', {
            random: () => 0,
        }),
        insertOps(state, 'bob', 0, 1, 'X', ts),
        ['aXb', 'cd'],
    );

    expectConverges(
        state,
        split(state, splitLocation(state, bid, selPos(state, bid, 3)!), ts(), 'alice', {
            random: () => 0,
        }),
        insertOps(state, 'bob', 0, 3, 'X', ts),
        ['ab', 'cXd'],
    );
});

it('converges join with concurrent inserts into either side', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcd', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);

    expectConverges(
        state,
        join(state, leftBlock, rightBlock, ts(), 'alice'),
        insertOps(state, 'bob', 0, 1, 'X', ts),
        ['aXbcd'],
    );

    expectConverges(
        state,
        join(state, leftBlock, rightBlock, ts(), 'alice'),
        insertOps(state, 'bob', 1, 1, 'X', ts),
        ['abcXd'],
    );
});

it('converges join with concurrent insert at start of joined right block', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcd', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);

    expectConverges(
        state,
        join(state, leftBlock, rightBlock, ts(), 'alice'),
        insertOps(state, 'bob', 1, 0, 'X', ts),
        ['abXcd'],
    );
});

it('derives join sentinel chars from join records', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcd', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);
    const [leftId, rightId] = rootBlockIds(state);

    state = applyMany(state, join(state, leftBlock, rightBlock, ts(), 'alice'));

    expect(state.state.blocks[rightId].deleted).toBe(false);
    expect(state.state.chars[rightId]).toBeUndefined();
    expect(state.state.joins['0006-alice']).toEqual({
        id: [6, 'alice'],
        left: leftBlock,
        right: rightBlock,
        tail: [2, 'self'],
        ts: '00005',
    });
    expect(state.cache.joinSentinels[rightId]).toEqual(state.state.joins['0006-alice']);
    expect(state.cache.joinedBlocks[rightId]).toEqual(state.state.joins['0006-alice']);
    expect(orderedCharIdsForBlock(state, leftId)).toContain(rightId);
    expect(orderedCharIdsForBlock(state, leftId, {visibleOnly: true})).not.toContain(rightId);
    expect(blockLines(state)).toEqual(['abcd']);
    expectCache(state);
});

it('keeps start-of-joined-block inserts in both explicit op orders', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcd', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);
    const joinOps = join(state, leftBlock, rightBlock, ts(), 'alice');
    const insert = insertOps(state, 'bob', 1, 0, 'X', ts);

    expect(blockLines(applyMany(state, [...joinOps, ...insert]))).toEqual(['abXcd']);
    expect(blockLines(applyMany(state, [...insert, ...joinOps]))).toEqual(['abXcd']);
});

it('converges join with multi-character insert at start of joined right block', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcd', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);

    expectConverges(
        state,
        join(state, leftBlock, rightBlock, ts(), 'alice'),
        insertOps(state, 'bob', 1, 0, 'XY', ts),
        ['abXYcd'],
    );
});

it('converges join with concurrent insert into an empty right block', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'ab', ts));
    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], null), ts(), 'self', {
            random: () => 0,
        }),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);

    expectConverges(
        state,
        join(state, leftBlock, rightBlock, ts(), 'alice'),
        insertOps(state, 'bob', 1, 0, 'X', ts),
        ['abX'],
    );
});

it('joins a non-empty right block into an empty left block through a sentinel', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'cd', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], [0, 'self']),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);

    state = applyMany(state, join(state, leftBlock, rightBlock, ts(), 'alice'));

    expect(blockLines(state)).toEqual(['cd']);
    expect(state.cache.joinSentinels[lamportToString(rightBlock)].tail).toEqual(leftBlock);
    expectCache(state);
});

it('keeps inserted text visible across chained joins', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcdef', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    state = applyMany(
        state,
        split(
            state,
            splitLocation(
                state,
                parseLamportString(rootBlockIds(state)[1]),
                selPos(state, parseLamportString(rootBlockIds(state)[1]), 3)!,
            ),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [first, second, third] = rootBlockIds(state).map(parseLamportString);
    state = applyMany(state, insertOps(state, 'bob', 1, 0, 'X', ts));
    state = applyMany(state, join(state, first, second, ts(), 'alice'));
    state = applyMany(state, join(state, first, third, ts(), 'alice'));

    expect(blockLines(state)).toEqual(['abXcdef']);
    expectCache(state);
});

it('converges join with concurrent splits of either joined block', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcdef', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 5)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);

    expectConverges(
        state,
        join(state, leftBlock, rightBlock, ts(), 'alice'),
        split(state, splitLocation(state, leftBlock, selPos(state, leftBlock, 3)!), ts(), 'bob', {
            random: () => 0,
        }),
        ['ab', 'cdef'],
    );

    expectConverges(
        state,
        join(state, leftBlock, rightBlock, ts(), 'alice'),
        split(state, splitLocation(state, rightBlock, selPos(state, rightBlock, 2)!), ts(), 'bob', {
            random: () => 0,
        }),
        ['abcde', 'f'],
    );
});

it('resolves reciprocal concurrent joins by lower join id without tombstoning both blocks', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcd', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [leftBlock, rightBlock] = rootBlockIds(state).map(parseLamportString);
    const [leftId, rightId] = rootBlockIds(state);

    const leftWins = join(state, leftBlock, rightBlock, ts(), 'alice');
    const rightLoses = join(state, rightBlock, leftBlock, ts(), 'bob');

    const one = applyMany(state, [...leftWins, ...rightLoses]);
    const two = applyMany(state, [...rightLoses, ...leftWins]);

    expect(blockLines(one)).toEqual(['abcd']);
    expect(blockLines(two)).toEqual(['abcd']);
    expect(rootBlockIds(one)).toEqual([leftId]);
    expect(rootBlockIds(two)).toEqual([leftId]);
    expect(one.state.blocks[leftId].deleted).toBe(false);
    expect(one.state.blocks[rightId].deleted).toBe(false);
    expect(Object.keys(one.cache.joinedBlocks)).toEqual([rightId]);
    expect(one.cache.joinSentinels[rightId]).toEqual(one.state.joins['0006-alice']);
    expect(one.cache.joinSentinels[leftId]).toBeUndefined();
    expectCache(one);
    expectCache(two);
});

it('resolves a three-block join cycle and preserves joined text', () => {
    const ts = mts();
    let state = cachedState(initialState('self', '00001'));
    state = applyMany(state, insertOps(state, 'self', 0, 0, 'abcdef', ts));
    state = applyMany(
        state,
        split(
            state,
            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    state = applyMany(
        state,
        split(
            state,
            splitLocation(
                state,
                parseLamportString(rootBlockIds(state)[1]),
                selPos(state, parseLamportString(rootBlockIds(state)[1]), 3)!,
            ),
            ts(),
            'self',
            {random: () => 0},
        ),
    );
    const [first, second, third] = rootBlockIds(state).map(parseLamportString);
    const [firstId, secondId, thirdId] = rootBlockIds(state);

    const firstJoin = join(state, first, second, ts(), 'alice');
    const secondJoin = join(state, second, third, ts(), 'bob');
    const cycleJoin = join(state, third, first, ts(), 'cara');
    state = applyMany(state, [...cycleJoin, ...secondJoin, ...firstJoin]);

    expect(activeJoinRecords(state.state.joins).map((join) => lamportToString(join.id))).toEqual([
        '0009-alice',
        '0009-bob',
    ]);
    expect(rootBlockIds(state)).toEqual([firstId]);
    expect(Object.keys(state.cache.joinedBlocks).sort()).toEqual([secondId, thirdId].sort());
    expect(state.cache.joinedBlocks[firstId]).toBeUndefined();
    expect(blockLines(state)).toEqual(['abcdef']);
    expectCache(state);
});

it('preserves cache and serialization invariants across generated editing scripts', () => {
    type Command =
        | {type: 'insert'; actor: string; block: number; offset: number; text: string}
        | {type: 'split'; actor: string; block: number; offset: number}
        | {type: 'join'; actor: string; block: number}
        | {type: 'delete'; block: number; offset: number};

    const command = fc.oneof<Command>(
        fc.record({
            type: fc.constant('insert'),
            actor: fc.constantFrom('alice', 'bob', 'cara'),
            block: fc.integer({min: 0, max: 3}),
            offset: fc.integer({min: 0, max: 12}),
            text: fc.constantFrom('a', 'b', 'xy'),
        }),
        fc.record({
            type: fc.constant('split'),
            actor: fc.constantFrom('alice', 'bob', 'cara'),
            block: fc.integer({min: 0, max: 3}),
            offset: fc.integer({min: 0, max: 12}),
        }),
        fc.record({
            type: fc.constant('join'),
            actor: fc.constantFrom('alice', 'bob', 'cara'),
            block: fc.integer({min: 0, max: 3}),
        }),
        fc.record({
            type: fc.constant('delete'),
            block: fc.integer({min: 0, max: 3}),
            offset: fc.integer({min: 0, max: 12}),
        }),
    );

    fc.assert(
        fc.property(fc.array(command, {minLength: 1, maxLength: 20}), (commands) => {
            const editor = new EditorHarness();
            for (const command of commands) {
                const blocks = editor.blockIds();
                const blockCount = blocks.length;
                if (command.type === 'insert') {
                    const block = command.block % blockCount;
                    const offset = Math.min(command.offset, blockLength(editor.state, blocks[block]));
                    editor.insert(command.actor, block, offset, command.text);
                } else if (command.type === 'split') {
                    const block = command.block % blockCount;
                    const offset = Math.min(command.offset, blockLength(editor.state, blocks[block]));
                    editor.split(command.actor, block, offset, {random: () => 0});
                } else if (command.type === 'join') {
                    if (blockCount < 2) continue;
                    const block = command.block % (blockCount - 1);
                    editor.join(command.actor, block, block + 1);
                } else {
                    const block = command.block % blockCount;
                    const length = blockLength(editor.state, blocks[block]);
                    if (length === 0) continue;
                    const offset = command.offset % length;
                    editor.deleteRange(block, offset, offset + 1);
                }

                editor.expectCache();
                expect(editor.serialized()).toBe(stateToString(cachedState(editor.state.state)));
            }
        }),
        {numRuns: 100, seed: 51},
    );
});
