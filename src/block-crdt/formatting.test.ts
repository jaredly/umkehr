import {it, expect} from 'vitest';
import fc from 'fast-check';
import {
    addChars,
    apply,
    applyMany,
    blockContents,
    cachedState,
    charOp,
    hasJoinStyleParent,
    join,
    markRange,
    materializeFormattedBlocks,
    orderedCharIdsForBlock,
    split,
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

const add = (state: CachedState, text: string, after: Lamport, ts = mts()) =>
    addChars(state, text, after, ts);

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
                    .filter((id) => !state.state.blocks[id].status.archived)
                    .map((id) => blockContents(state, id))
                    .join('\n');
                expect(formattedText).toBe(visibleText);
            },
        ),
        {numRuns: 100, seed: 52},
    );
});
