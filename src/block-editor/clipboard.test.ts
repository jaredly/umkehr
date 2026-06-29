import {describe, expect, it} from 'vitest';

import {
    applyMany,
    cachedState,
    insertTextOps,
    markRangeOp,
} from '../block-crdt/index';
import {initialState} from '../block-crdt/initialState';
import {lamportToString} from '../block-crdt/utils';

import {INLINE_EMBED_MARK, INLINE_EMBED_TEXT} from './inlineEmbeds';
import {LINK_MARK, MATH_MARK} from './inlineMarks';
import {singleRetainedSelectionSet} from './selectionSet';
import {serializeSelectionToClipboardPayload} from './clipboard';

const ts = () => {
    let next = 2;
    return () => String(next++).padStart(5, '0');
};

describe('clipboard inline feature filtering', () => {
    it('filters inline marks and embeds by enabled features', () => {
        const block = [0, 'self'] as const;
        const blockId = lamportToString(block);
        let state = cachedState(initialState('self', '00001'));
        state = applyMany(
            state,
            insertTextOps(state, {
                actor: 'alice',
                block,
                offset: 0,
                text: `abc${INLINE_EMBED_TEXT}`,
                ts: ts(),
            }),
        );
        state = applyMany(state, [
            markRangeOp(state, block, 0, 4, 'bold', undefined, false, [10, 'alice']),
            markRangeOp(state, block, 0, 4, LINK_MARK, 'https://example.com', false, [11, 'alice']),
            markRangeOp(state, block, 0, 3, MATH_MARK, true, false, [12, 'alice']),
            markRangeOp(
                state,
                block,
                3,
                4,
                INLINE_EMBED_MARK,
                {type: 'date', value: '2026-06-28'},
                false,
                [13, 'alice'],
            ),
        ]);

        const selection = singleRetainedSelectionSet(state, {
            type: 'range',
            anchor: {blockId, offset: 0},
            focus: {blockId, offset: 4},
        });

        const full = serializeSelectionToClipboardPayload(state, selection);
        expect(new Set(full?.fragments[0]?.marks.map((mark) => mark.type))).toEqual(new Set([
            'bold',
            'link',
            'math',
            'embed',
        ]));
        expect(full?.html).toContain('https://example.com');
        expect(full?.html).toContain('data-umkehr-math-display');
        expect(full?.html).toContain('data-umkehr-embed-type');

        const filtered = serializeSelectionToClipboardPayload(state, selection, [], {
            booleanMarks: new Set(),
            links: false,
            math: false,
            inlineEmbeds: new Set(),
        });
        expect(filtered?.fragments[0]?.marks).toEqual([]);
        expect(filtered?.html).not.toContain('https://example.com');
        expect(filtered?.html).not.toContain('data-umkehr-math-display');
        expect(filtered?.html).not.toContain('data-umkehr-embed-type');
    });
});
