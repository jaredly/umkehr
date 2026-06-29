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
import {
    filterRichClipboardPayloadBlockFeatures,
    filterRichClipboardPayloadInlineFeatures,
    serializeSelectionToClipboardPayload,
    type RichClipboardPayload,
} from './clipboard';

const ts = () => {
    let next = 2;
    return () => String(next++).padStart(5, '0');
};

describe('clipboard inline feature filtering', () => {
    const clipboardFixture = () => {
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

        return {state, selection};
    };

    it('filters copied inline marks and embeds by enabled features', () => {
        const {state, selection} = clipboardFixture();
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

    it('filters pasted rich clipboard marks without mutating the source payload', () => {
        const {state, selection} = clipboardFixture();
        const full = serializeSelectionToClipboardPayload(state, selection);
        expect(full).not.toBeNull();

        const filtered = filterRichClipboardPayloadInlineFeatures(full!, {
            booleanMarks: new Set(),
            links: false,
            math: false,
            inlineEmbeds: new Set(),
        });
        expect(filtered?.fragments[0]?.marks).toEqual([]);
        expect(filtered?.html).not.toContain('https://example.com');
        expect(filtered?.html).not.toContain('data-umkehr-math-display');
        expect(filtered?.html).not.toContain('data-umkehr-embed-type');
        expect(new Set(full?.fragments[0]?.marks.map((mark) => mark.type))).toEqual(new Set([
            'bold',
            'link',
            'math',
            'embed',
        ]));
    });
});

describe('clipboard block feature filtering', () => {
    it('degrades unsupported block metadata and strips orphaned attachments', () => {
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'Caption\nExample',
            html: '',
            fragments: [
                {
                    text: 'Caption',
                    meta: {type: 'image', attachmentId: 'image-1', size: 'medium', ts: '1'},
                    marks: [],
                },
                {
                    text: 'Example',
                    meta: {type: 'preview', url: 'https://example.com', preview: null, ts: '2'},
                    marks: [],
                },
            ],
            annotations: [],
            attachments: [{id: 'image-1', name: 'image.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,a'}],
        };

        const filtered = filterRichClipboardPayloadBlockFeatures(payload, {blockTypes: new Set(['preview'])});

        expect(filtered.fragments.map((fragment) => fragment.meta)).toEqual([
            {type: 'paragraph', ts: '1'},
            {type: 'preview', url: 'https://example.com', preview: null, ts: '2'},
        ]);
        expect(filtered.attachments).toBeUndefined();
    });
});
