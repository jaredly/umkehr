import {it, expect} from 'vitest';
import fc from 'fast-check';
import {
    addChars,
    apply,
    applyMany,
    blockContents,
    cachedState,
    charOp,
    formattedMarkValues,
    hasJoinStyleParent,
    isDeleted,
    join,
    markBoundaryOp,
    markOp,
    markRange,
    materializeFormattedBlocks,
    orderedCharIdsForBlock,
    split,
    visibleRangesForMark,
} from './index';
import {CachedState, Lamport, Op} from './types';
import {initialState} from './initialState';
import {lamportToString, selPos} from './utils';

const mts = (init = 0) => {
    let i = init;
    return () => (i++).toString().padStart(5, '0');
};

const init = () => cachedState(initialState('self', '00001'));

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

const formatted = (state: CachedState) =>
    materializeFormattedBlocks(state).map((block) => ({
        id: block.id,
        runs: block.runs,
    }));

const formattedRuns = (state: CachedState) =>
    materializeFormattedBlocks(state).map((block) => block.runs);

const add = (state: CachedState, text: string, after: Lamport, ts = mts()) =>
    addChars(state, text, after, ts);

const expectFormattedConverges = (base: CachedState, left: Op[], right: Op[]) => {
    const one = applyMany(base, [...left, ...right]);
    const two = applyMany(base, [...right, ...left]);
    expect(formattedRuns(one)).toEqual(formattedRuns(two));
};

it('uses blank parent timestamps for inserted chars and populated strings for join-style parents', () => {
    const ts = mts();
    let state = add(init(), 'abcd', [0, 'self'], ts);
    expect(state.state.chars['0002-self'].parent.ts).toBe('');
    expect(hasJoinStyleParent(state, '0002-self')).toBe(false);

    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 3)!), ts(), 'self', {
            random: () => 0,
        }),
    );
    const [left, right] = state.cache.blockChildren['0000-root'].map((id) => state.state.blocks[id].id);
    state = applyMany(state, join(state, left, right, ts(), 'self'));

    expect(state.state.chars['0003-self'].parent.ts).not.toBe('');
    expect(hasJoinStyleParent(state, '0003-self')).toBe(true);
});

it('applies mark and split-record ops idempotently and rejects conflicting duplicates', () => {
    let state = add(init(), 'abc', [0, 'self']);
    const mark = markRange(state, [0, 'self'], 0, 2, 'bold', undefined, false, [10, 'self']);

    state = apply(state, mark) as CachedState;
    expect(apply(state, mark)).toEqual(state);
    expect(() =>
        apply(state, {
            type: 'mark',
            mark: {...mark.mark, type: 'italic'},
        } as Op & {type: 'mark'}),
    ).toThrow('re-insert of mark 0010-self');

    const splitRecord: Op = {
        type: 'split-record',
        split: {id: [11, 'self'], left: [1, 'self'], right: [2, 'self']},
    };
    state = apply(state, splitRecord) as CachedState;
    expect(apply(state, splitRecord)).toEqual(state);
    expect(() =>
        apply(state, {
            type: 'split-record',
            split: {id: [11, 'self'], left: [1, 'self'], right: [3, 'self']},
        }),
    ).toThrow('re-insert of split 0011-self');
});

it('materializes simple inline marks into formatted runs', () => {
    let state = add(init(), 'abc', [0, 'self']);
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 2, 'bold', undefined, false, [10, 'self']),
    ) as CachedState;

    expect(formatted(state)[0].runs).toEqual([
        {text: 'a', marks: {}},
        {text: 'b', marks: {bold: true}},
        {text: 'c', marks: {}},
    ]);
});

it('removes marks by highest mark id for the same type', () => {
    let state = add(init(), 'abc', [0, 'self']);
    state = apply(
        state,
        markRange(state, [0, 'self'], 0, 3, 'bold', undefined, false, [10, 'self']),
    ) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 2, 'bold', undefined, true, [11, 'self']),
    ) as CachedState;

    expect(formatted(state)[0].runs).toEqual([
        {text: 'a', marks: {bold: true}},
        {text: 'b', marks: {}},
        {text: 'c', marks: {bold: true}},
    ]);
});

it('later same-type add marks override earlier data', () => {
    let state = add(init(), 'abc', [0, 'self']);
    state = apply(
        state,
        markRange(state, [0, 'self'], 0, 3, 'color', 'red', false, [10, 'self']),
    ) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 2, 'color', 'blue', false, [11, 'self']),
    ) as CachedState;

    expect(formattedRuns(state)[0]).toEqual([
        {text: 'a', marks: {color: 'red'}},
        {text: 'b', marks: {color: 'blue'}},
        {text: 'c', marks: {color: 'red'}},
    ]);
});

it('materializes configured stacking marks without same-type LWW collapse', () => {
    let state = add(init(), 'abc', [0, 'self']);
    state = apply(
        state,
        markRange(state, [0, 'self'], 0, 3, 'annotation', 'first', false, [10, 'self']),
    ) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 2, 'annotation', 'second', false, [11, 'self']),
    ) as CachedState;

    expect(
        materializeFormattedBlocks(state, {markBehavior: {annotation: 'stacking'}})[0].runs,
    ).toEqual([
        {text: 'a', marks: {}, stackedMarks: {annotation: ['first']}},
        {text: 'b', marks: {}, stackedMarks: {annotation: ['first', 'second']}},
        {text: 'c', marks: {}, stackedMarks: {annotation: ['first']}},
    ]);
    expect(materializeFormattedBlocks(state)[0].runs).toEqual([
        {text: 'a', marks: {annotation: 'first'}},
        {text: 'b', marks: {annotation: 'second'}},
        {text: 'c', marks: {annotation: 'first'}},
    ]);
});

it('reads formatted mark values from lww and stacking runs', () => {
    let state = add(init(), 'abc', [0, 'self']);
    state = apply(
        state,
        markRange(state, [0, 'self'], 0, 3, 'color', 'red', false, [10, 'self']),
    ) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 2, 'annotation', 'first', false, [11, 'self']),
    ) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 2, 'annotation', 'second', false, [12, 'self']),
    ) as CachedState;

    const runs = materializeFormattedBlocks(state, {markBehavior: {annotation: 'stacking'}})[0].runs;

    expect(formattedMarkValues(runs[0], 'color')).toEqual(['red']);
    expect(formattedMarkValues(runs[1], 'annotation')).toEqual(['first', 'second']);
    expect(formattedMarkValues(runs[1], 'missing')).toEqual([]);
});

it('removes configured stacking marks by matching data', () => {
    let state = add(init(), 'abc', [0, 'self']);
    state = apply(
        state,
        markRange(state, [0, 'self'], 0, 3, 'annotation', 'first', false, [10, 'self']),
    ) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 2, 'annotation', 'second', false, [11, 'self']),
    ) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 0, 3, 'annotation', 'first', true, [12, 'self']),
    ) as CachedState;

    expect(
        materializeFormattedBlocks(state, {markBehavior: {annotation: 'stacking'}})[0].runs,
    ).toEqual([
        {text: 'a', marks: {}},
        {text: 'b', marks: {}, stackedMarks: {annotation: ['second']}},
        {text: 'c', marks: {}},
    ]);
});

it('returns visible ranges for a mark inside one block', () => {
    let state = add(init(), 'abcd', [0, 'self']);
    const op = markRange(state, [0, 'self'], 1, 3, 'bold', undefined, false, [10, 'self']);
    state = apply(state, op) as CachedState;

    expect(visibleRangesForMark(state, op.mark)).toEqual([
        {blockId: '0000-self', startOffset: 1, endOffset: 3},
    ]);
});

it('supports explicit before-boundary mark ends', () => {
    const ts = mts();
    let state = add(init(), 'abc', [0, 'self'], ts);
    state = apply(
        state,
        markBoundaryOp([10, 'self'], {id: [2, 'self'], at: 'before'}, {id: [3, 'self'], at: 'before'}, 'bold'),
    ) as CachedState;
    state = apply(state, charOp('X', [11, 'other'], [2, 'self'], ts())) as CachedState;

    expect(formattedRuns(state)[0]).toEqual([
        {text: 'a', marks: {}},
        {text: 'bX', marks: {bold: true}},
        {text: 'c', marks: {}},
    ]);
});

it('supports open-ended marks through the end of the start block', () => {
    const ts = mts();
    let state = add(init(), 'abcde', [0, 'self'], ts);
    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 4)!), ts(), 'self', {
            random: () => 0,
        }),
    );
    const [firstBlock, secondBlock] = state.cache.blockChildren['0000-root'];
    state = apply(
        state,
        markBoundaryOp([20, 'self'], {id: [2, 'self'], at: 'before'}, undefined, 'bold'),
    ) as CachedState;

    expect(formattedRuns(state)).toEqual([
        [
            {text: 'a', marks: {}},
            {text: 'bc', marks: {bold: true}},
        ],
        [{text: 'de', marks: {}}],
    ]);
    expect(firstBlock).not.toBe(secondBlock);
});

it('closes an open-ended retained mark with a remove and bounded add', () => {
    const ts = mts();
    let state = add(init(), 'ab', [0, 'self'], ts);
    state = apply(state, charOp('X', [10, 'self'], [1, 'self'], ts())) as CachedState;
    state = apply(state, charOp('Y', [11, 'self'], [10, 'self'], ts())) as CachedState;
    state = apply(
        state,
        markBoundaryOp([20, 'self'], {id: [10, 'self'], at: 'before'}, {id: [2, 'self'], at: 'before'}, 'bold'),
    ) as CachedState;
    state = apply(
        state,
        markBoundaryOp(
            [21, 'self'],
            {id: [10, 'self'], at: 'before'},
            {id: [2, 'self'], at: 'before'},
            'bold',
            undefined,
            true,
        ),
    ) as CachedState;
    state = apply(
        state,
        markBoundaryOp([22, 'self'], {id: [10, 'self'], at: 'before'}, {id: [11, 'self'], at: 'after'}, 'bold'),
    ) as CachedState;

    expect(formattedRuns(state)[0]).toEqual([
        {text: 'a', marks: {}},
        {text: 'XY', marks: {bold: true}},
        {text: 'b', marks: {}},
    ]);
});

it('returns visible ranges for a mark split across blocks', () => {
    const ts = mts();
    let state = add(init(), 'abcdef', [0, 'self'], ts);
    const op = markRange(state, [0, 'self'], 1, 5, 'bold', undefined, false, [20, 'self']);
    state = apply(state, op) as CachedState;
    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 4)!), ts(), 'self', {
            random: () => 0,
        }),
    );

    const blockIds = state.cache.blockChildren['0000-root'];
    expect(visibleRangesForMark(state, op.mark)).toEqual([
        {blockId: blockIds[0], startOffset: 1, endOffset: 3},
        {blockId: blockIds[1], startOffset: 0, endOffset: 2},
    ]);
});

it('deleted chars do not render but still preserve mark anchors', () => {
    let state = add(init(), 'abc', [0, 'self']);
    state = apply(
        state,
        markRange(state, [0, 'self'], 0, 3, 'bold', undefined, false, [10, 'self']),
    ) as CachedState;
    state = apply(state, {type: 'char:delete', id: [2, 'self'], deleted: {value: true, ts: '00010'}}) as CachedState;

    expect(formattedRuns(state)[0]).toEqual([{text: 'ac', marks: {bold: true}}]);
});

it('follows a later split when the mark did not explicitly cross it', () => {
    const ts = mts();
    let state = add(init(), 'abcdef', [0, 'self'], ts);
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 5, 'bold', undefined, false, [20, 'self']),
    ) as CachedState;

    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 4)!), ts(), 'self', {
            random: () => 0,
        }),
    );

    expect(formatted(state).map((block) => block.runs)).toEqual([
        [
            {text: 'a', marks: {}},
            {text: 'bc', marks: {bold: true}},
        ],
        [
            {text: 'de', marks: {bold: true}},
            {text: 'f', marks: {}},
        ],
    ]);
});

it('stores crossed splits for marks created across an existing split', () => {
    const ts = mts();
    let state = add(init(), 'abcdef', [0, 'self'], ts);
    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 4)!), ts(), 'self', {
            random: () => 0,
        }),
    );
    const splitRecord = Object.values(state.state.splits)[0];

    const mark = markOp([20, 'self'], [2, 'self'], [5, 'self'], 'bold', undefined, false, [
        splitRecord.id,
    ]);
    expect(mark.type).toBe('mark');
    expect(mark.mark.crossedSplits).toEqual([splitRecord.id]);
    state = apply(state, mark) as CachedState;

    expect(formattedRuns(state)).toEqual([
        [
            {text: 'a', marks: {}},
            {text: 'bc', marks: {bold: true}},
        ],
        [
            {text: 'de', marks: {bold: true}},
            {text: 'f', marks: {}},
        ],
    ]);
});

it('converges mark and split batches applied in either order', () => {
    const ts = mts();
    const base = add(init(), 'abcdef', [0, 'self'], ts);
    const mark = [markRange(base, [0, 'self'], 1, 5, 'bold', undefined, false, [20, 'self'])];
    const splitOps = split(
        base,
        splitLocation(base, [0, 'self'], selPos(base, [0, 'self'], 4)!),
        ts(),
        'self',
        {random: () => 0},
    );

    expectFormattedConverges(base, mark, splitOps);
});

it('converges mark and join batches applied in either order', () => {
    const ts = mts();
    let base = add(init(), 'abcdef', [0, 'self'], ts);
    base = applyMany(
        base,
        split(base, splitLocation(base, [0, 'self'], selPos(base, [0, 'self'], 4)!), ts(), 'self', {
            random: () => 0,
        }),
    );
    const [left, right] = base.cache.blockChildren['0000-root'].map((id) => base.state.blocks[id].id);
    const splitRecord = Object.values(base.state.splits)[0];
    const mark = [
        markOp([20, 'self'], [2, 'self'], [5, 'self'], 'bold', undefined, false, [
            splitRecord.id,
        ]),
    ];
    const joinOps = join(base, left, right, ts(), 'self');

    expectFormattedConverges(base, mark, joinOps);
});

it('walks the split-left tail before jumping to the split right char', () => {
    const ts = mts();
    let state = add(init(), 'abcdef', [0, 'self'], ts);
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 5, 'bold', undefined, false, [20, 'self']),
    ) as CachedState;
    const splitOps = split(
        state,
        splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 4)!),
        ts(),
        'self',
        {random: () => 0},
    );
    state = applyMany(state, splitOps);
    state = apply(state, charOp('X', [state.state.maxSeenCount + 1, 'other'], [3, 'self'], ts())) as CachedState;

    expect(formatted(state).map((block) => block.runs)).toEqual([
        [
            {text: 'a', marks: {}},
            {text: 'bcX', marks: {bold: true}},
        ],
        [
            {text: 'de', marks: {bold: true}},
            {text: 'f', marks: {}},
        ],
    ]);
});

it('ignores a second split while scanning the tail of the first followed split', () => {
    const ts = mts();
    let state = add(init(), 'abcdef', [0, 'self'], ts);
    state = apply(state, charOp('X', [7, 'other'], [3, 'self'], ts())) as CachedState;
    state = apply(state, charOp('Y', [8, 'other'], [7, 'other'], ts())) as CachedState;
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 7, 'bold', undefined, false, [20, 'self']),
    ) as CachedState;

    state = applyMany(
        state,
        split(
            state,
            {block: [0, 'self'], char: selPos(state, [0, 'self'], 6)!, previous: [3, 'self']},
            ts(),
            'one',
            {random: () => 1},
        ),
    );
    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 5)!), ts(), 'two', {
            random: () => 0,
        }),
    );

    expect(formatted(state).map((block) => block.runs)).toEqual([
        [
            {text: 'a', marks: {}},
            {text: 'bcX', marks: {bold: true}},
        ],
        [{text: 'Y', marks: {}}],
        [
            {text: 'de', marks: {bold: true}},
            {text: 'f', marks: {}},
        ],
    ]);
});

it('jumps early while following a split when the tail scan sees a join-style parent', () => {
    const ts = mts();
    let state = add(init(), 'abcdef', [0, 'self'], ts);
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 5, 'bold', undefined, false, [20, 'self']),
    ) as CachedState;
    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 4)!), ts(), 'self', {
            random: () => 0,
        }),
    );
    const [left, right] = state.cache.blockChildren['0000-root'].map((id) => state.state.blocks[id].id);
    state = applyMany(state, join(state, left, right, ts(), 'self'));

    expect(formatted(state)[0].runs).toEqual([
        {text: 'a', marks: {}},
        {text: 'bcde', marks: {bold: true}},
        {text: 'f', marks: {}},
    ]);
});

it('traverses deleted blocks while omitting them from formatted output', () => {
    const ts = mts();
    let state = add(init(), 'abcdef', [0, 'self'], ts);
    state = apply(
        state,
        markRange(state, [0, 'self'], 1, 5, 'bold', undefined, false, [20, 'self']),
    ) as CachedState;
    state = applyMany(
        state,
        split(state, splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], 4)!), ts(), 'self', {
            random: () => 0,
        }),
    );
    const rightBlock = state.cache.blockChildren['0000-root'][1];
    state = apply(state, {
        type: 'block:delete',
        id: state.state.blocks[rightBlock].id,
        deleted: {value: true, ts: '00020'},
    }) as CachedState;

    expect(formattedRuns(state)).toEqual([
        [
            {text: 'a', marks: {}},
            {text: 'bc', marks: {bold: true}},
        ],
    ]);
});

it('preserves visible text when materializing generated marked documents', () => {
    fc.assert(
        fc.property(
            fc.array(fc.constantFrom('a', 'b', 'c', 'x', 'y'), {minLength: 1, maxLength: 8}),
            fc.integer({min: 0, max: 7}),
            fc.integer({min: 0, max: 7}),
            fc.integer({min: 0, max: 7}),
            (chars, rawStart, rawEnd, rawSplit) => {
                const ts = mts();
                let state = add(init(), chars.join(''), [0, 'self'], ts);
                const start = rawStart % chars.length;
                const end = start + 1 + (rawEnd % (chars.length - start));
                state = apply(
                    state,
                    markRange(state, [0, 'self'], start, end, 'bold', undefined, false, [20, 'self']),
                ) as CachedState;
                if (chars.length > 1) {
                    const splitOffset = 1 + (rawSplit % (chars.length - 1));
                    state = applyMany(
                        state,
                        split(
                            state,
                            splitLocation(state, [0, 'self'], selPos(state, [0, 'self'], splitOffset + 1)!),
                            ts(),
                            'self',
                            {random: () => 0},
                        ),
                    );
                }

                const formattedText = materializeFormattedBlocks(state)
                    .map((block) => block.runs.map((run) => run.text).join(''))
                    .join('\n');
                const visibleText = state.cache.blockChildren['0000-root']
                    .filter((id) => !isDeleted(state.state.blocks[id]))
                    .map((id) => blockContents(state, id))
                    .join('\n');
                expect(formattedText).toBe(visibleText);
            },
        ),
        {numRuns: 100, seed: 52},
    );
});
