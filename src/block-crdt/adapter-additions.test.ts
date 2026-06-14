import {expect, it} from 'vitest';
import {
    apply,
    applyMany,
    applyRemote,
    blockIdAtVisiblePath,
    blockContents,
    cachedState,
    clampBlockPoint,
    deleteBlockOps,
    graphemeLength,
    graphemeOffsetToUtf16Offset,
    insertBlockOps,
    insertTextOps,
    joinBlocksOps,
    markRangesOps,
    markSelectionOps,
    materializeFormattedBlocks,
    resolveSelection,
    retainSelection,
    splitBlockOps,
    utf16OffsetToGraphemeOffset,
    visibleBlockChildren,
    visibleGraphemeIdsForBlock,
    visibleLengthForBlock,
    visiblePathForBlockId,
    visibleSiblingAnchorsForPath,
    visibleTextForBlock,
} from './index';
import {initialState} from './initialState';
import {lamportToString, parseLamportString} from './ids';
import type {CachedState, Lamport, Op} from './types';

const mts = (init = 1) => {
    let i = init;
    return () => (i++).toString().padStart(5, '0');
};

const init = () => cachedState(initialState('self', '00001'));

const rootIds = (state: CachedState) => visibleBlockChildren(state, lamportToString([0, 'root']));

const lines = (state: CachedState) => rootIds(state).map((id) => blockContents(state, id));

const paragraph = (ts: string) => ({type: 'paragraph' as const, ts});

const insertBlock = (
    state: CachedState,
    options: Partial<Parameters<typeof insertBlockOps>[1]> = {},
): CachedState => {
    const roots = rootIds(state);
    const anchors =
        options.before !== undefined || options.after !== undefined
            ? {}
            : roots.length
              ? {before: parseLamportString(roots[roots.length - 1]), after: null}
              : {};
    return applyMany(
        state,
        insertBlockOps(state, {
            actor: 'alice',
            parent: [0, 'root'],
            meta: paragraph('00010'),
            ts: '00010',
            options: {random: () => 0},
            ...anchors,
            ...options,
        }),
    );
};

const insertText = (state: CachedState, block: Lamport, text: string, offset = 0) =>
    applyMany(state, insertTextOps(state, {actor: 'alice', block, offset, text, ts: mts(20)}));

it('inserts public blocks at root positions and rejects invalid anchors', () => {
    let state = init();
    state = insertBlock(state);
    const [initialRoot, firstInserted] = rootIds(state).map(parseLamportString);
    state = insertBlock(state, {before: firstInserted, after: null, meta: paragraph('00011'), ts: '00011'});
    state = insertBlock(state, {before: initialRoot, after: firstInserted, meta: paragraph('00012'), ts: '00012'});

    expect(rootIds(state).map((id) => state.state.blocks[id].meta.ts)).toEqual(['00001', '00012', '00010', '00011']);
    const [a, b, c] = rootIds(state).map(parseLamportString);
    expect(() =>
        insertBlockOps(state, {
            actor: 'alice',
            parent: [0, 'root'],
            before: a,
            after: c,
            meta: paragraph('00013'),
            ts: '00013',
        }),
    ).toThrow('adjacent siblings');
    expect(() =>
        insertBlockOps(state, {
            actor: 'bad-actor',
            parent: [0, 'root'],
            before: a,
            after: b,
            meta: paragraph('00014'),
            ts: '00014',
        }),
    ).toThrow('actor id');
});

it('inserts nested blocks and leaves remote block ops pending until parents arrive', () => {
    let state = init();
    state = insertBlock(state);
    const parent = parseLamportString(rootIds(state)[1]);
    const ops = insertBlockOps(state, {
        actor: 'alice',
        parent,
        meta: paragraph('00011'),
        ts: '00011',
        options: {random: () => 0},
    });
    state = applyMany(state, ops);
    expect(blockIdAtVisiblePath(state, [1, 0])).toBe(visibleBlockChildren(state, rootIds(state)[1])[0]);

    const remoteBase = init();
    const pending = applyRemote(remoteBase, ops[0]);
    expect(pending.status).toBe('pending');
});

it('deletes one block or a visible subtree with documented descendant behavior', () => {
    let state = init();
    state = insertText(state, [0, 'self'], 'root');
    state = applyMany(state, splitBlockOps(state, {actor: 'alice', block: [0, 'self'], offset: 4, ts: '00020'}));
    const [parent, child] = rootIds(state).map(parseLamportString);
    state = applyMany(
        state,
        insertBlockOps(state, {
            actor: 'alice',
            parent,
            meta: paragraph('00021'),
            ts: '00021',
            options: {random: () => 0},
        }),
    );
    const nested = parseLamportString(visibleBlockChildren(state, lamportToString(parent))[0]);

    const blockOnly = applyMany(state, deleteBlockOps(state, {block: parent}));
    expect(new Set(rootIds(blockOnly))).toEqual(new Set([lamportToString(child), lamportToString(nested)]));

    const subtree = applyMany(state, deleteBlockOps(state, {block: parent, mode: 'subtree'}));
    expect(rootIds(subtree)).toEqual([lamportToString(child)]);
    expect(applyRemote(subtree, deleteBlockOps(state, {block: parent})[0]).status).toBe('ignored');
});

it('resolves visible paths and insertion anchors', () => {
    let state = init();
    state = insertBlock(state);
    const first = parseLamportString(rootIds(state)[0]);
    state = applyMany(
        state,
        insertBlockOps(state, {
            actor: 'alice',
            parent: first,
            meta: paragraph('00011'),
            ts: '00011',
            options: {random: () => 0},
        }),
    );
    const nestedId = visibleBlockChildren(state, lamportToString(first))[0];

    expect(blockIdAtVisiblePath(state, [0, 0])).toBe(nestedId);
    expect(visiblePathForBlockId(state, nestedId)).toEqual([0, 0]);
    expect(visibleSiblingAnchorsForPath(state, [0, 1])).toEqual({
        parent: first,
        before: parseLamportString(nestedId),
        after: null,
    });
    expect(blockIdAtVisiblePath(state, [2])).toBeNull();
});

it('retains selections across inserts, deletes, splits, joins, and block moves', () => {
    let state = insertText(init(), [0, 'self'], 'abcd');
    const blockId = rootIds(state)[0];
    const retained = retainSelection(state, {type: 'caret', point: {blockId, offset: 2}});

    state = insertText(state, [0, 'self'], 'X', 0);
    expect(resolveSelection(state, retained)).toEqual({type: 'caret', point: {blockId, offset: 3}});

    state = applyMany(state, [{type: 'char:delete', id: [2, 'alice']} as Op]);
    expect(resolveSelection(state, retained)).toEqual({type: 'caret', point: {blockId, offset: 2}});

    state = insertText(init(), [0, 'self'], 'abcd');
    const splitRetained = retainSelection(state, {type: 'caret', point: {blockId, offset: 4}});
    state = applyMany(state, splitBlockOps(state, {actor: 'alice', block: [0, 'self'], offset: 2, ts: '00030'}));
    const [, right] = rootIds(state).map(parseLamportString);
    expect(resolveSelection(state, splitRetained)).toEqual({type: 'caret', point: {blockId: lamportToString(right), offset: 2}});

    const joined = applyMany(state, joinBlocksOps(state, {actor: 'alice', left: [0, 'self'], right, ts: '00031'}));
    expect(resolveSelection(joined, splitRetained)).toEqual({type: 'caret', point: {blockId, offset: 4}});
});

it('creates mark ops for single and multi-block selections', () => {
    let state = insertText(init(), [0, 'self'], 'abcd');
    state = applyMany(state, splitBlockOps(state, {actor: 'alice', block: [0, 'self'], offset: 2, ts: '00020'}));
    const [leftId, rightId] = rootIds(state);

    const single = markRangesOps(
        state,
        [{start: {block: parseLamportString(leftId), offset: 0}, end: {block: parseLamportString(leftId), offset: 1}}],
        'bold',
        undefined,
        false,
        {actor: 'alice'},
    );
    expect(single).toHaveLength(1);

    state = applyMany(
        state,
        markSelectionOps(
            state,
            {anchor: {blockId: rightId, offset: 1}, focus: {blockId: leftId, offset: 1}},
            'italic',
            undefined,
            false,
            {actor: 'alice'},
        ),
    );
    expect(materializeFormattedBlocks(state).map((block) => block.runs)).toEqual([
        [
            {text: 'a', marks: {}},
            {text: 'b', marks: {italic: true}},
        ],
        [
            {text: 'c', marks: {italic: true}},
            {text: 'd', marks: {}},
        ],
    ]);
});

it('converts grapheme and utf-16 offsets and exposes visible text helpers', () => {
    const text = 'a👩‍💻e\u0301';
    expect(graphemeLength(text)).toBe(3);
    expect(utf16OffsetToGraphemeOffset(text, 3)).toBe(1);
    expect(graphemeOffsetToUtf16Offset(text, 2)).toBe(6);

    const state = insertText(init(), [0, 'self'], text);
    const blockId = rootIds(state)[0];
    expect(visibleTextForBlock(state, blockId)).toBe(text);
    expect(visibleLengthForBlock(state, blockId)).toBe(3);
    expect(visibleGraphemeIdsForBlock(state, blockId)).toHaveLength(3);
    expect(clampBlockPoint(state, {blockId, offset: 99})).toEqual({blockId, offset: 3});
});
