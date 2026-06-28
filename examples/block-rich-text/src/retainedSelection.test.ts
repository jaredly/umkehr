import {describe, expect, it} from 'vitest';
import {blockContents, cachedState, rootBlockIds} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import {
    deleteBackward,
    insertText,
    moveBlock,
    pastePlainText,
    splitBlock,
    type CommandContext,
} from 'umkehr/block-editor';
import {caret} from 'umkehr/block-editor';
import {resolveSelection, retainSelection} from 'umkehr/block-editor';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => `${actor}-${String(i++).padStart(5, '0')}`,
    };
};

const init = () => cachedState(initialState('doc', '00000'));

const onlyBlock = (state: ReturnType<typeof init>) => rootBlockIds(state)[0];

const lines = (state: ReturnType<typeof init>) => rootBlockIds(state).map((id) => blockContents(state, id));

describe('retained block rich text selections', () => {
    it('retains the start of a block as after the block boundary', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const retained = retainSelection(state, caret(blockId, 0));

        expect(retained).toEqual({
            type: 'caret',
            point: {blockId, charId: null, affinity: 'after'},
        });
        expect(resolveSelection(state, retained)).toEqual(caret(blockId, 0));
    });

    it('resolves a caret after a visible character', () => {
        const context = ctx();
        const result = insertText(init(), caret(onlyBlock(init()), 0), 'abc', context);
        const blockId = onlyBlock(result.state);
        const retained = retainSelection(result.state, caret(blockId, 2));

        expect(resolveSelection(result.state, retained)).toEqual(caret(blockId, 2));
    });

    it('keeps a caret with its anchor after concurrent text is inserted before it', () => {
        const initial = insertText(init(), caret(onlyBlock(init()), 0), 'abc', ctx('left'));
        const blockId = onlyBlock(initial.state);
        const retained = retainSelection(initial.state, caret(blockId, 2));

        const insertedBefore = insertText(initial.state, caret(blockId, 0), 'X', ctx('right'));

        expect(lines(insertedBefore.state)).toEqual(['Xabc']);
        expect(resolveSelection(insertedBefore.state, retained)).toEqual(caret(blockId, 3));
    });

    it('keeps a caret anchored to the logical position of a deleted character', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abc', ctx());
        const blockId = onlyBlock(inserted.state);
        const retained = retainSelection(inserted.state, caret(blockId, 2));

        const deleted = deleteBackward(inserted.state, caret(blockId, 2), ctx());

        expect(lines(deleted.state)).toEqual(['ac']);
        expect(resolveSelection(deleted.state, retained)).toEqual(caret(blockId, 1));
    });

    it('shifts a retained range when text is inserted before it', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abc', ctx('left'));
        const blockId = onlyBlock(inserted.state);
        const retained = retainSelection(inserted.state, {
            type: 'range',
            anchor: {blockId, offset: 1},
            focus: {blockId, offset: 3},
        });

        const insertedBefore = insertText(inserted.state, caret(blockId, 0), 'X', ctx('right'));

        expect(resolveSelection(insertedBefore.state, retained)).toEqual({
            type: 'range',
            anchor: {blockId, offset: 2},
            focus: {blockId, offset: 4},
        });
    });

    it('collapses a retained range to a caret when the selected text is deleted', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx('left'));
        const blockId = onlyBlock(inserted.state);
        const retained = retainSelection(inserted.state, {
            type: 'range',
            anchor: {blockId, offset: 1},
            focus: {blockId, offset: 3},
        });

        const deleted = deleteBackward(inserted.state, {
            type: 'range',
            anchor: {blockId, offset: 1},
            focus: {blockId, offset: 3},
        }, ctx('right'));

        expect(lines(deleted.state)).toEqual(['ad']);
        expect(resolveSelection(deleted.state, retained)).toEqual(caret(blockId, 1));
    });

    it('keeps a selection inside a moved block', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nbc', context);
        const [, second] = rootBlockIds(pasted.state);
        const retained = retainSelection(pasted.state, caret(second, 1));

        const moved = moveBlock(
            pasted.state,
            second,
            {type: 'before', targetBlockId: rootBlockIds(pasted.state)[0]},
            context,
        );

        expect(lines(moved.state)).toEqual(['bc', 'a']);
        expect(resolveSelection(moved.state, retained)).toEqual(caret(second, 1));
    });

    it('follows characters moved into a new block by split', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const retained = retainSelection(inserted.state, caret(blockId, 4));

        const split = splitBlock(inserted.state, caret(blockId, 2), ctx());
        const [, second] = rootBlockIds(split.state);

        expect(lines(split.state)).toEqual(['ab', 'cd']);
        expect(resolveSelection(split.state, retained)).toEqual(caret(second, 2));
    });

    it('resolves joined-block selections inside the surviving block', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nbc', context);
        const [, second] = rootBlockIds(pasted.state);
        const retained = retainSelection(pasted.state, caret(second, 1));

        const joined = deleteBackward(pasted.state, caret(second, 0), context);
        const first = rootBlockIds(joined.state)[0];

        expect(lines(joined.state)).toEqual(['abc']);
        expect(resolveSelection(joined.state, retained)).toEqual(caret(first, 2));
    });
});
