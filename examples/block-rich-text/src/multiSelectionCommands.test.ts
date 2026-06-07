import {describe, expect, it} from 'vitest';
import {blockContents, cachedState, materializeFormattedBlocks, rootBlockIds} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {insertText, pastePlainText, type CommandContext} from './blockCommands';
import {caret, type EditorSelection} from './selectionModel';
import {
    deleteBackwardEverywhere,
    insertTextEverywhere,
    splitBlockEverywhere,
    toggleMarkEverywhere,
} from './multiSelectionCommands';
import {appendSelection, resolveSelectionSet, singleRetainedSelectionSet} from './selectionSet';

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
});
