import {describe, expect, it} from 'vitest';
import {cachedState, rootBlockIds} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import {insertText, pastePlainText, toggleMark, type CommandContext} from 'umkehr/block-editor';
import {caret} from 'umkehr/block-editor';
import {findWordOccurrences, wordAtPoint} from 'umkehr/block-editor';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => `${actor}-${String(i++).padStart(5, '0')}`,
    };
};

const init = () => cachedState(initialState('doc', '00000'));

const onlyBlock = (state: ReturnType<typeof init>) => rootBlockIds(state)[0];

describe('block rich text word occurrences', () => {
    it('finds exact case-sensitive word occurrences across visible blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one two\none One', ctx());
        const [first, second] = rootBlockIds(pasted.state);

        expect(findWordOccurrences(pasted.state, 'one')).toEqual([
            {type: 'range', anchor: {blockId: first, offset: 0}, focus: {blockId: first, offset: 3}},
            {type: 'range', anchor: {blockId: second, offset: 0}, focus: {blockId: second, offset: 3}},
        ]);
    });

    it('finds the clicked word at a block point', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'alpha beta', ctx());
        const blockId = onlyBlock(inserted.state);

        expect(wordAtPoint(inserted.state, {blockId, offset: 7})).toEqual({
            text: 'beta',
            selection: {
                type: 'range',
                anchor: {blockId, offset: 6},
                focus: {blockId, offset: 10},
            },
        });
    });

    it('searches across formatted run boundaries', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'hello hello', ctx());
        const blockId = onlyBlock(inserted.state);
        const marked = toggleMark(
            inserted.state,
            {type: 'range', anchor: {blockId, offset: 0}, focus: {blockId, offset: 2}},
            'bold',
            ctx(),
        );

        expect(findWordOccurrences(marked.state, 'hello')).toEqual([
            {type: 'range', anchor: {blockId, offset: 0}, focus: {blockId, offset: 5}},
            {type: 'range', anchor: {blockId, offset: 6}, focus: {blockId, offset: 11}},
        ]);
    });
});
