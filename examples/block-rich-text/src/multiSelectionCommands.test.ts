import {describe, expect, it} from 'vitest';
import {blockContents, cachedState, materializeFormattedBlocks, rootBlockIds} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {insertText, pastePlainText, setBlockType, type CommandContext} from './blockCommands';
import {createDemoState} from './blockEditorRuntime';
import {caret, type EditorSelection} from './selectionModel';
import {
    deleteBackwardEverywhere,
    deleteForwardEverywhere,
    extendSelectionsHorizontally,
    extendSelectionsVertically,
    indentSelections,
    insertTextEverywhere,
    insertTextWithMarksEverywhere,
    insertTextWithRetainedMarksEverywhere,
    moveSelectionsHorizontally,
    moveSelectionsVertically,
    pastePlainTextWithMarkdownShortcutsEverywhere,
    setLinkMarkEverywhere,
    splitBlockEverywhere,
    toggleMarkEverywhere,
    unindentSelections,
    closeRetainedInlineMarkSessionsEverywhere,
} from './multiSelectionCommands';
import {appendSelection, resolveSelectionSet, singleRetainedSelectionSet} from './selectionSet';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
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

describe('block rich text multi-selection commands', () => {
    it('inserts text at two carets in one block', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = insertTextEverywhere(inserted.state, set, 'X', ctx());

        expect(lines(result.state)).toEqual(['aXbcXd']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 2),
            caret(blockId, 5),
        ]);
    });

    it('inserts text at carets in different blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 1), 'first'),
            caret(secondBlock, 1),
            'second',
        );

        const result = insertTextEverywhere(pasted.state, set, 'X', ctx());

        expect(lines(result.state)).toEqual(['aXb', 'cXd']);
    });

    it('pastes markdown shortcuts at multiple carets', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), '\n', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 0), 'first'),
            caret(secondBlock, 0),
            'second',
        );

        const result = pastePlainTextWithMarkdownShortcutsEverywhere(pasted.state, set, '- item', ctx());
        const ids = rootBlockIds(result.state);

        expect(lines(result.state)).toEqual(['item', 'item']);
        expect(result.state.state.blocks[ids[0]].meta).toMatchObject({type: 'list_item', kind: 'unordered'});
        expect(result.state.state.blocks[ids[1]].meta).toMatchObject({type: 'list_item', kind: 'unordered'});
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(ids[0], 4),
            caret(ids[1], 4),
        ]);
    });

    it('inserts marked text at selected carets', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = insertTextWithMarksEverywhere(inserted.state, set, 'X', ['bold'], ctx());

        expect(materializeFormattedBlocks(result.state)[0].runs).toEqual([
            {text: 'a', marks: {}},
            {text: 'X', marks: {bold: true}},
            {text: 'bc', marks: {}},
            {text: 'X', marks: {bold: true}},
            {text: 'd', marks: {}},
        ]);
    });

    it('uses retained marks independently at multiple carets', () => {
        const context = ctx();
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const first = insertTextWithRetainedMarksEverywhere(inserted.state, set, 'X', ['bold'], {}, context);
        const second = insertTextWithRetainedMarksEverywhere(
            first.state,
            first.selection,
            'Y',
            ['bold'],
            first.retainedMarks,
            context,
        );
        const closed = closeRetainedInlineMarkSessionsEverywhere(
            second.state,
            second.selection,
            second.retainedMarks,
            'bold',
            context,
        );

        expect(first.ops.filter((op) => op.type === 'mark')).toHaveLength(2);
        expect(second.ops.filter((op) => op.type === 'mark')).toHaveLength(0);
        expect(closed.ops.filter((op) => op.type === 'mark')).toHaveLength(4);
        expect(materializeFormattedBlocks(closed.state)[0].runs).toEqual([
            {text: 'a', marks: {}},
            {text: 'XY', marks: {bold: true}},
            {text: 'bc', marks: {}},
            {text: 'XY', marks: {bold: true}},
            {text: 'd', marks: {}},
        ]);
    });

    it('moves every selected caret horizontally', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = moveSelectionsHorizontally(inserted.state, set, 'right');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 2),
            caret(blockId, 4),
        ]);
    });

    it('moves every selected caret to block boundaries', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const left = moveSelectionsHorizontally(inserted.state, set, 'left', 'block');
        const right = moveSelectionsHorizontally(inserted.state, set, 'right', 'block');

        expect(resolveSelectionSet(left.state, left.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 0),
        ]);
        expect(resolveSelectionSet(right.state, right.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 4),
        ]);
    });

    it('moves every selected caret by word', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'one two three', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 5),
            'second',
        );

        const result = moveSelectionsHorizontally(inserted.state, set, 'right', 'word');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 3),
            caret(blockId, 7),
        ]);
    });

    it('moves every selected caret across block boundaries', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 2), 'first'),
            caret(secondBlock, 0),
            'second',
        );

        const result = moveSelectionsHorizontally(pasted.state, set, 'right');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 0),
            caret(secondBlock, 1),
        ]);
    });

    it('moves every selected caret vertically to adjacent blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncdef\nx', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 2), 'first'),
            caret(secondBlock, 3),
            'second',
        );

        const result = moveSelectionsVertically(pasted.state, set, 'down');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 2),
            caret(thirdBlock, 1),
        ]);
    });

    it('extends every selected caret horizontally', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = extendSelectionsHorizontally(inserted.state, set, 'right');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            {
                type: 'range',
                anchor: {blockId, offset: 1},
                focus: {blockId, offset: 2},
            },
            {
                type: 'range',
                anchor: {blockId, offset: 3},
                focus: {blockId, offset: 4},
            },
        ]);
    });

    it('extends every selected caret vertically', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncdef\nx', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 2), 'first'),
            caret(secondBlock, 3),
            'second',
        );

        const result = extendSelectionsVertically(pasted.state, set, 'down');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            {
                type: 'range',
                anchor: {blockId: firstBlock, offset: 2},
                focus: {blockId: secondBlock, offset: 2},
            },
            {
                type: 'range',
                anchor: {blockId: secondBlock, offset: 3},
                focus: {blockId: thirdBlock, offset: 1},
            },
        ]);
    });

    it('indents adjacent selected caret blocks without cascading them', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(secondBlock, 1), 'first'),
            caret(thirdBlock, 1),
            'second',
        );

        const result = indentSelections(pasted.state, set, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
            {text: 'd', depth: 0},
        ]);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 1),
            caret(thirdBlock, 1),
        ]);
    });

    it('indents every block touched by a cross-block selection', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = singleRetainedSelectionSet(
            pasted.state,
            {
                type: 'range',
                anchor: {blockId: secondBlock, offset: 1},
                focus: {blockId: thirdBlock, offset: 1},
            },
            'range',
        );

        const result = indentSelections(pasted.state, set, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
            {text: 'd', depth: 0},
        ]);
    });

    it('unindents adjacent selected caret blocks without nesting them under each other', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const indented = indentSelections(
            pasted.state,
            appendSelection(
                pasted.state,
                singleRetainedSelectionSet(pasted.state, caret(secondBlock, 1), 'first'),
                caret(thirdBlock, 1),
                'second',
            ),
            context,
        );

        const result = unindentSelections(indented.state, indented.selection, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
            {text: 'c', depth: 0},
            {text: 'd', depth: 0},
        ]);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 1),
            caret(thirdBlock, 1),
        ]);
    });

    it('replaces overlapping ranges once after merging', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', ctx());
        const blockId = onlyBlock(inserted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 1},
            focus: {blockId, offset: 4},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 3},
            focus: {blockId, offset: 5},
        };
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, first, 'first'),
            second,
            'second',
        );

        const result = insertTextEverywhere(inserted.state, set, 'X', ctx());

        expect(lines(result.state)).toEqual(['aXf']);
    });

    it('deletes backward from adjacent same-block carets', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 2), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = deleteBackwardEverywhere(inserted.state, set, ctx());

        expect(lines(result.state)).toEqual(['ad']);
    });

    it('deletes a single retained cross-block range by joining blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 2},
            focus: {blockId: secondBlock, offset: 1},
        };
        const set = singleRetainedSelectionSet(pasted.state, selection, 'primary');

        const result = deleteBackwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['onwo']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(firstBlock, 2),
        ]);
    });

    it('deletes a boundary-only retained cross-block range by joining blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 3},
            focus: {blockId: secondBlock, offset: 0},
        };
        const set = singleRetainedSelectionSet(pasted.state, selection, 'primary');

        const result = deleteBackwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['onetwo']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(firstBlock, 3),
        ]);
    });

    it('deletes a single retained cross-block range forward by joining blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 2},
            focus: {blockId: secondBlock, offset: 1},
        };
        const set = singleRetainedSelectionSet(pasted.state, selection, 'primary');

        const result = deleteForwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['onwo']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(firstBlock, 2),
        ]);
    });

    it('merges overlapping cross-block ranges before deleting', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd\nef', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 1},
            focus: {blockId: secondBlock, offset: 1},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId: secondBlock, offset: 0},
            focus: {blockId: thirdBlock, offset: 1},
        };
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, first, 'first'),
            second,
            'second',
        );

        const result = deleteBackwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['af']);
    });

    it('splits at two carets in one block', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 2), 'first'),
            caret(blockId, 4),
            'second',
        );

        const result = splitBlockEverywhere(inserted.state, set, ctx());

        expect(lines(result.state)).toEqual(['ab', 'cd', 'ef']);
    });

    it('toggles marks on all selected ranges and ignores carets', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 0},
            focus: {blockId: firstBlock, offset: 2},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId: secondBlock, offset: 0},
            focus: {blockId: secondBlock, offset: 2},
        };
        const withRange = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, first, 'first'),
            second,
            'second',
        );
        const withCaret = appendSelection(pasted.state, withRange, caret(firstBlock, 1), 'caret');

        const result = toggleMarkEverywhere(pasted.state, withCaret, 'bold', ctx());

        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {bold: true}}],
            [{text: 'cd', marks: {bold: true}}],
        ]);
    });

    it('sets links on all selected ranges and ignores carets', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 0},
            focus: {blockId: firstBlock, offset: 2},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId: secondBlock, offset: 0},
            focus: {blockId: secondBlock, offset: 2},
        };
        const withRange = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, first, 'first'),
            second,
            'second',
        );
        const withCaret = appendSelection(pasted.state, withRange, caret(firstBlock, 1), 'caret');

        const result = setLinkMarkEverywhere(pasted.state, withCaret, 'https://example.test', ctx());

        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {link: 'https://example.test'}}],
            [{text: 'cd', marks: {link: 'https://example.test'}}],
        ]);
    });

    it('moves horizontally through editable table row headers', () => {
        const context = ctx();
        const demo = createDemoState();
        let result = pastePlainText(demo.left.state, caret(rootBlockIds(demo.left.state)[0], 0), 'a\nrow\nb', context);
        const [first, row, third] = rootBlockIds(result.state);
        result = setBlockType(result.state, row, {type: 'table_row', ts: '0005-left'});

        let moved = moveSelectionsHorizontally(
            result.state,
            singleRetainedSelectionSet(result.state, caret(first, 1)),
            'right',
        );
        expect(resolveSelectionSet(moved.state, moved.selection).entries[0].selection).toEqual(caret(row, 0));

        moved = moveSelectionsHorizontally(
            result.state,
            singleRetainedSelectionSet(result.state, caret(third, 0)),
            'left',
        );
        expect(resolveSelectionSet(moved.state, moved.selection).entries[0].selection).toEqual(caret(row, 3));
    });
});
