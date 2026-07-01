import {describe, expect, it} from 'vitest';

import {
    applyMany,
    blockContents,
    cachedState,
    insertTextOps,
    markRangeOp,
} from '../block-crdt/index';
import {initialState} from '../block-crdt/initialState';
import {lamportToString} from '../block-crdt/utils';

import {INLINE_EMBED_MARK, INLINE_EMBED_TEXT} from './inlineEmbeds';
import {LINK_MARK, MATH_MARK} from './inlineMarks';
import {singleRetainedSelectionSet} from './selectionSet';
import {convertBlockToTable, insertText} from './blockCommands';
import {caret} from './selectionModel';
import {tableCellsForSelection, tableRowsForSelection} from './selectionModel';
import {
    filterRichClipboardPayloadBlockFeatures,
    filterRichClipboardPayloadInlineFeatures,
    serializeSelectionToClipboardPayload,
    type RichClipboardPayload,
} from './clipboard';
import {createBlockEditorRegistry} from './plugins/registry';
import {tableSelectionPluginBundle} from './tableSelectionPlugin';
import {tablePlugin} from './plugins/table';

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

    it('strips annotation references and body payloads when annotations are disabled', () => {
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'marked',
            html: '',
            fragments: [
                {
                    text: 'marked',
                    meta: {type: 'paragraph', ts: '1'},
                    marks: [
                        {
                            type: 'annotation',
                            startOffset: 0,
                            endOffset: 6,
                            data: {originalId: '1:a', presentation: 'sidebar'},
                        },
                    ],
                },
            ],
            annotations: [
                {
                    originalId: '1:a',
                    presentation: 'sidebar',
                    bodyBlocks: [
                        {
                            text: 'body',
                            meta: {type: 'paragraph', ts: '2'},
                            marks: [
                                {
                                    type: 'annotation',
                                    startOffset: 0,
                                    endOffset: 4,
                                    data: {originalId: '2:a', presentation: 'popover'},
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const filtered = filterRichClipboardPayloadInlineFeatures(payload, {annotations: false});

        expect(filtered.fragments[0].marks).toEqual([]);
        expect(filtered.annotations).toEqual([]);
        expect(payload.fragments[0].marks).toHaveLength(1);
        expect(payload.annotations).toHaveLength(1);
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

describe('clipboard table feature gating', () => {
    it('serializes table TSV only when the table clipboard command is registered', () => {
        const actor = 'alice';
        const nextTs = ts();
        const context = {actor, nextTs};
        const tableBlock = lamportToString([0, 'self']);
        let result = convertBlockToTable(
            cachedState(initialState('self', '00001')),
            caret(tableBlock, 0),
            context,
            {rows: 2, columns: 2},
        );
        const rows = tableRowsForSelection(result.state, tableBlock);
        const cells = rows.flatMap((rowId) => tableCellsForSelection(result.state, rowId));

        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            result = insertText(result.state, caret(cells[index], 0), text, context);
        });

        const selection = singleRetainedSelectionSet(result.state, {
            type: 'table-cells',
            tableId: tableBlock,
            anchorCellId: cells[1],
            focusCellId: cells[2],
        });
        const selectionOnly = createBlockEditorRegistry([tableSelectionPluginBundle]);
        const withTable = createBlockEditorRegistry([tableSelectionPluginBundle, tablePlugin]);

        const withoutTableClipboard = serializeSelectionToClipboardPayload(
            result.state,
            selection,
            [],
            undefined,
            undefined,
            selectionOnly,
        );
        const withTableClipboard = serializeSelectionToClipboardPayload(
            result.state,
            selection,
            [],
            undefined,
            undefined,
            withTable,
        );

        expect(cells.map((cellId) => blockContents(result.state, cellId))).toEqual(['A', 'B', 'C', 'D']);
        expect(withoutTableClipboard).toBeNull();
        expect(withTableClipboard?.sourceSelectionType).toBe('table-cells');
        expect(withTableClipboard?.tsv).toBe('A\tB\nC\tD');
        expect(withTableClipboard?.fragments.map((fragment) => fragment.text)).toEqual(['A', 'B', 'C', 'D']);
    });
});
