import {describe, expect, it} from 'vitest';
import {blockContents, cachedState, rootBlockIds} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {deleteBackward, insertText, pastePlainText, type CommandContext} from './blockCommands';
import {caret, type EditorSelection} from './selectionModel';
import {
    appendSelection,
    decorationsForSelectionSet,
    dedupeSelectionSet,
    mergeOverlappingRanges,
    primarySelection,
    resolveSelectionSet,
    singleRetainedSelectionSet,
} from './selectionSet';

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

describe('block rich text selection sets', () => {
    it('retains and resolves multiple selections with a primary entry', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abc', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const resolved = resolveSelectionSet(inserted.state, set);

        expect(resolved.primaryId).toBe('second');
        expect(resolved.entries).toEqual([
            {id: 'first', selection: caret(blockId, 1)},
            {id: 'second', selection: caret(blockId, 3)},
        ]);
        expect(primarySelection(resolved)).toEqual(caret(blockId, 3));
    });

    it('deduplicates visible-coincident carets and keeps the logical first retained cursor', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abc', ctx());
        const blockId = onlyBlock(inserted.state);
        const afterB = singleRetainedSelectionSet(inserted.state, caret(blockId, 2), 'after-b');
        const deleted = deleteBackward(inserted.state, caret(blockId, 2), ctx());
        const withCoincidentCaret = appendSelection(deleted.state, afterB, caret(blockId, 1), 'after-a');

        expect(lines(deleted.state)).toEqual(['ac']);
        const deduped = dedupeSelectionSet(deleted.state, withCoincidentCaret);
        const resolved = resolveSelectionSet(deleted.state, deduped);

        expect(resolved.entries).toHaveLength(1);
        expect(resolved.entries[0]).toEqual({id: 'after-a', selection: caret(blockId, 1)});
    });

    it('merges overlapping ranges for command execution', () => {
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

        const merged = resolveSelectionSet(inserted.state, {
            primaryId: 'second',
            entries: mergeOverlappingRanges(inserted.state, set),
        });

        expect(merged.entries).toEqual([
            {
                id: 'second',
                selection: {
                    type: 'range',
                    anchor: {blockId, offset: 1},
                    focus: {blockId, offset: 5},
                },
            },
        ]);
    });

    it('merges overlapping ranges across blocks', () => {
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

        const merged = resolveSelectionSet(pasted.state, {
            primaryId: 'second',
            entries: mergeOverlappingRanges(pasted.state, set),
        });

        expect(merged.entries).toEqual([
            {
                id: 'second',
                selection: {
                    type: 'range',
                    anchor: {blockId: firstBlock, offset: 1},
                    focus: {blockId: thirdBlock, offset: 1},
                },
            },
        ]);
    });

    it('decorates boundary-only ranges with carets on both sides', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = resolveSelectionSet(
            pasted.state,
            singleRetainedSelectionSet(
                pasted.state,
                {
                    type: 'range',
                    anchor: {blockId: firstBlock, offset: 3},
                    focus: {blockId: secondBlock, offset: 0},
                },
                'primary',
            ),
        );

        const decorations = decorationsForSelectionSet(pasted.state, set, {
            includePrimary: false,
            includePrimaryBoundaryCaret: true,
        });

        expect(decorations.get(firstBlock)).toEqual({
            carets: [{id: 'primary', offset: 3, primary: true}],
            segments: [],
        });
        expect(decorations.get(secondBlock)).toEqual({
            carets: [{id: 'primary', offset: 0, primary: true}],
            segments: [],
        });
    });

    it('decorates a cross-block range endpoint just past a boundary', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = resolveSelectionSet(
            pasted.state,
            singleRetainedSelectionSet(
                pasted.state,
                {
                    type: 'range',
                    anchor: {blockId: firstBlock, offset: 1},
                    focus: {blockId: secondBlock, offset: 0},
                },
                'primary',
            ),
        );

        const activeDecorations = decorationsForSelectionSet(pasted.state, set, {
            includePrimary: false,
            includePrimaryBoundaryCaret: true,
        });
        expect(activeDecorations.get(firstBlock)).toBeUndefined();
        expect(activeDecorations.get(secondBlock)).toEqual({
            carets: [{id: 'primary', offset: 0, primary: true}],
            segments: [],
        });

        const inactiveDecorations = decorationsForSelectionSet(pasted.state, set, {
            includePrimary: true,
            includePrimaryBoundaryCaret: true,
        });
        expect(inactiveDecorations.get(firstBlock)).toEqual({
            carets: [],
            segments: [{id: 'primary', startOffset: 1, endOffset: 3, primary: true}],
        });
        expect(inactiveDecorations.get(secondBlock)).toEqual({
            carets: [{id: 'primary', offset: 0, primary: true}],
            segments: [],
        });
    });
});
