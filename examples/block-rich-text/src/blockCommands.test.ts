import {describe, expect, it} from 'vitest';
import {
    applyMany,
    blockContents,
    cachedState,
    materializeFormattedBlocks,
    organizeState,
    rootBlockIds,
    visibleBlockOutline,
} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {
    deleteBackward,
    deleteForward,
    indentBlock,
    insertText,
    moveBlock,
    pastePlainText,
    splitBlock,
    toggleMark,
    unindentBlock,
    type CommandContext,
} from './blockCommands';
import {applyLocalChange, createDemoState, makeCommandContext, toggleOnline} from './blockEditorRuntime';
import {retainSelection} from './retainedSelection';
import {caret, type EditorSelection} from './selectionModel';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => `${actor}-${String(i++).padStart(5, '0')}`,
    };
};

const init = () => cachedState(initialState('doc', '00000'));

const onlyBlock = (state: CachedState) => rootBlockIds(state)[0];

const lines = (state: CachedState) => rootBlockIds(state).map((id) => blockContents(state, id));

const outline = (state: CachedState) =>
    materializeFormattedBlocks(state).map((block) => ({
        text: blockContents(state, block.id),
        depth: block.depth,
    }));

const expectCache = (state: CachedState) => {
    expect(state.cache).toEqual(organizeState(state.state.blocks, state.state.chars, state.state.joins));
};

describe('block rich text commands', () => {
    it('inserts text and deletes ordinary backspace inside a block', () => {
        let state = init();
        const blockId = onlyBlock(state);
        const context = ctx();
        let result = insertText(state, caret(blockId, 0), 'abc', context);
        expect(lines(result.state)).toEqual(['abc']);
        expect(result.selection).toEqual(caret(blockId, 3));

        result = deleteBackward(result.state, caret(blockId, 2), context);
        expect(lines(result.state)).toEqual(['ac']);
        expect(result.selection).toEqual(caret(blockId, 1));
        expectCache(result.state);
    });

    it('calculates middle Backspace deletion and caret shift without DOM state', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(result.state);

        result = deleteBackward(result.state, caret(blockId, 2), context);

        expect(lines(result.state)).toEqual(['acd']);
        expect(result.selection).toEqual(caret(blockId, 1));

        result = insertText(result.state, result.selection, 'X', context);

        expect(lines(result.state)).toEqual(['aXcd']);
        expect(result.selection).toEqual(caret(blockId, 2));
        expectCache(result.state);
    });

    it('calculates middle Delete deletion without moving the caret', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(result.state);

        result = deleteForward(result.state, caret(blockId, 2), context);

        expect(lines(result.state)).toEqual(['abd']);
        expect(result.selection).toEqual(caret(blockId, 2));
        expectCache(result.state);
    });

    it('splits at start, middle, and end', () => {
        const context = ctx();
        let result = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', context);
        const blockId = onlyBlock(result.state);

        result = splitBlock(result.state, caret(blockId, 3), context);
        expect(lines(result.state)).toEqual(['abc', 'def']);

        const first = rootBlockIds(result.state)[0];
        result = splitBlock(result.state, caret(first, 0), context);
        expect(lines(result.state)).toEqual(['', 'abc', 'def']);

        const last = rootBlockIds(result.state)[2];
        result = splitBlock(result.state, caret(last, 3), context);
        expect(lines(result.state)).toEqual(['', 'abc', 'def', '']);
        expectCache(result.state);
    });

    it('joins with the previous block on backspace at block start', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        expect(lines(result.state)).toEqual(['one', 'two']);
        const second = rootBlockIds(result.state)[1];

        result = deleteBackward(result.state, caret(second, 0), context);
        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(rootBlockIds(result.state)[0], 3));
        expectCache(result.state);
    });

    it('joins with the next block on Delete at block end', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', context);
        expect(lines(result.state)).toEqual(['one', 'two']);
        const first = rootBlockIds(result.state)[0];

        result = deleteForward(result.state, caret(first, 3), context);

        expect(lines(result.state)).toEqual(['onetwo']);
        expect(result.selection).toEqual(caret(first, 3));
        expectCache(result.state);
    });

    it('splits pasted newlines into blocks', () => {
        const state = init();
        const result = pastePlainText(state, caret(onlyBlock(state), 0), 'a\nb\n', ctx());

        expect(lines(result.state)).toEqual(['a', 'b', '']);
        expectCache(result.state);
    });

    it('toggles bold over a multi-block selection using per-block marks', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', context);
        const [first, second] = rootBlockIds(result.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: first, offset: 0},
            focus: {blockId: second, offset: 2},
        };

        result = toggleMark(result.state, selection, 'bold', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {bold: true}}],
            [{text: 'cd', marks: {bold: true}}],
        ]);

        result = toggleMark(result.state, selection, 'bold', context);
        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {}}],
            [{text: 'cd', marks: {}}],
        ]);
        expectCache(result.state);
    });

    it('moves root blocks with a block:move op', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [first, , third] = rootBlockIds(result.state);

        result = moveBlock(result.state, first, {targetBlockId: third, after: true}, context);
        expect(lines(result.state)).toEqual(['b', 'c', 'a']);
        expectCache(result.state);
    });

    it('indents a block under its previous visible sibling', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc', context);
        const [, second] = rootBlockIds(result.state);

        result = indentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 0},
        ]);
        expect(result.selection).toEqual(caret(second, 0));
        expectCache(result.state);
    });

    it('does not indent the first sibling', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const first = rootBlockIds(result.state)[0];

        result = indentBlock(result.state, first, context);

        expect(result.ops).toEqual([]);
        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
        ]);
        expectCache(result.state);
    });

    it('unindents a block and reparents following siblings under it', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, second, third, fourth] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);
        result = indentBlock(result.state, third, context);
        result = indentBlock(result.state, fourth, context);

        result = unindentBlock(result.state, second, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
            {text: 'c', depth: 1},
            {text: 'd', depth: 1},
        ]);
        expect(result.selection).toEqual(caret(second, 0));
        expectCache(result.state);
    });

    it('converges concurrent unindents by source sibling order', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, second, third, fourth] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);
        result = indentBlock(result.state, third, context);
        result = indentBlock(result.state, fourth, context);
        const base = result.state;

        const left = unindentBlock(base, second, ctx('left')).ops;
        const right = unindentBlock(base, third, ctx('right')).ops;
        const one = applyMany(base, [...left, ...right]);
        const two = applyMany(base, [...right, ...left]);

        expect(one.state.blocks[fourth].order.parent).toEqual(one.state.blocks[third].id);
        expect(two.state.blocks[fourth].order.parent).toEqual(two.state.blocks[third].id);
        expect(visibleBlockOutline(one).map(({id, depth}) => ({id, depth}))).toEqual(
            visibleBlockOutline(two).map(({id, depth}) => ({id, depth})),
        );
        expectCache(one);
        expectCache(two);
    });

    it('joins using visible adjacency across nesting', () => {
        const context = ctx();
        let result = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb', context);
        const [, second] = rootBlockIds(result.state);
        result = indentBlock(result.state, second, context);

        result = deleteForward(result.state, caret(rootBlockIds(result.state)[0], 1), context);

        expect(outline(result.state)).toEqual([{text: 'ab', depth: 0}]);
        expectCache(result.state);
    });
});

describe('block rich text runtime', () => {
    it('queues offline local changes and flushes them on reconnect', () => {
        let demo = createDemoState();
        demo = toggleOnline(demo, 'left');
        const leftBlock = rootBlockIds(demo.left.state)[0];
        const context = makeCommandContext(demo.left);
        const result = insertText(demo.left.state, caret(leftBlock, 0), 'offline', context);

        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: result.state,
            selection: retainSelection(result.state, result.selection),
            ops: result.ops,
        });

        expect(lines(demo.left.state)).toEqual(['offline']);
        expect(lines(demo.right.state)).toEqual(['']);
        expect(demo.left.queue).toHaveLength(1);

        demo = toggleOnline(demo, 'left');
        expect(lines(demo.right.state)).toEqual(['offline']);
        expect(demo.left.queue).toHaveLength(0);
    });
});
