import {describe, expect, it} from 'vitest';
import {blockContents, materializeFormattedBlocks, rootBlockIds} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {
    BLOCK_RICH_TEXT_MIME,
    fragmentsToHtml,
    htmlWithClipboardPayload,
    parseBlockRichTextClipboardHtml,
    parseBlockRichTextClipboardPayload,
    serializeSelectionToClipboardPayload,
    type RichClipboardPayload,
} from './clipboard';
import {createDemoState, makeCommandContext} from './blockEditorRuntime';
import {createAnnotation, setAnnotationBodyText} from './annotations';
import {
    convertBlockToTable,
    insertInlineEmbed,
    insertText,
    pastePlainText,
    setBlockMeta,
    setLinkMark,
    setMathMark,
    splitBlock,
    toggleMark,
    type CommandContext,
} from './blockCommands';
import {paragraphMeta} from './blockMeta';
import {singleRetainedSelectionSet} from './selectionSet';
import {
    caret,
    tableCellsForSelection,
    tableRowsForSelection,
    type EditorSelection,
} from './selectionModel';
import {INLINE_EMBED_TEXT} from './inlineEmbeds';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
    };
};

const payload = (overrides: Partial<RichClipboardPayload> = {}): RichClipboardPayload => ({
    version: 1,
    plainText: 'hello',
    html: '<p>hello</p>',
    fragments: [
        {
            text: 'hello',
            meta: {type: 'paragraph', ts: '001-test'},
            marks: [{type: 'bold', startOffset: 0, endOffset: 5}],
        },
    ],
    annotations: [],
    ...overrides,
});

describe('block rich text clipboard payload parser', () => {
    it('uses a stable custom MIME type', () => {
        expect(BLOCK_RICH_TEXT_MIME).toBe('application/x-umkehr-block-rich-text+json');
    });

    it('parses a valid payload', () => {
        expect(parseBlockRichTextClipboardPayload(JSON.stringify(payload()))).toEqual(payload());
    });

    it('parses a payload embedded in an HTML comment', () => {
        const html = htmlWithClipboardPayload(payload());

        expect(html).toContain('<p>hello</p>');
        expect(html).toContain('<!--umkehr-block-rich-text:');
        expect(parseBlockRichTextClipboardHtml(html)).toEqual(payload());
    });

    it('returns null for missing or malformed HTML payload comments', () => {
        expect(parseBlockRichTextClipboardHtml('<p>hello</p>')).toBeNull();
        expect(parseBlockRichTextClipboardHtml('<!--umkehr-block-rich-text:%E0%A4%A-->')).toBeNull();
    });

    it('returns null for malformed JSON and unknown versions', () => {
        expect(parseBlockRichTextClipboardPayload('{')).toBeNull();
        expect(parseBlockRichTextClipboardPayload(JSON.stringify({...payload(), version: 2}))).toBeNull();
    });

    it('returns null for invalid mark ranges', () => {
        expect(
            parseBlockRichTextClipboardPayload(
                JSON.stringify(
                    payload({
                        fragments: [
                            {
                                text: 'hello',
                                meta: {type: 'paragraph', ts: '001-test'},
                                marks: [{type: 'bold', startOffset: 4, endOffset: 6}],
                            },
                        ],
                    }),
                ),
            ),
        ).toBeNull();
    });

    it('parses preview block metadata', () => {
        const previewPayload = payload({
            fragments: [
                {
                    text: 'Subtitle',
                    meta: {
                        type: 'preview',
                        url: 'https://example.test',
                        preview: {title: 'Example', imageUrl: 'https://example.test/image.png'},
                        ts: 'preview-ts',
                    },
                    marks: [],
                },
            ],
        });

        expect(parseBlockRichTextClipboardPayload(JSON.stringify(previewPayload))).toEqual(previewPayload);
    });

    it('parses recipe ingredient block metadata', () => {
        const ingredientPayload = payload({
            fragments: [
                {
                    text: '1 cup flour',
                    meta: {type: 'recipe_ingredient', ts: 'ingredient-ts'},
                    marks: [],
                },
            ],
        });

        expect(parseBlockRichTextClipboardPayload(JSON.stringify(ingredientPayload))).toEqual(ingredientPayload);
    });

    it('parses kanban block metadata', () => {
        const kanbanPayload = payload({
            fragments: [
                {
                    text: 'Project board',
                    meta: {type: 'kanban', ts: 'kanban-ts'},
                    marks: [],
                },
            ],
        });

        expect(parseBlockRichTextClipboardPayload(JSON.stringify(kanbanPayload))).toEqual(kanbanPayload);
    });

    it('returns null for invalid annotation entries', () => {
        expect(
            parseBlockRichTextClipboardPayload(
                JSON.stringify({
                    ...payload(),
                    annotations: [
                        {
                            originalId: '001-left',
                            presentation: 'sidebar',
                            bodyBlocks: [
                                {
                                    text: 'body',
                                    meta: {type: 'paragraph', ts: '001-test'},
                                    marks: [],
                                },
                            ],
                        },
                        {
                            originalId: '001-left',
                            presentation: 'sidebar',
                            bodyBlocks: [],
                        },
                    ],
                }),
            ),
        ).toBeNull();
    });

    it('requires typed data for link and annotation marks', () => {
        expect(
            parseBlockRichTextClipboardPayload(
                JSON.stringify(
                    payload({
                        fragments: [
                            {
                                text: 'hello',
                                meta: {type: 'paragraph', ts: '001-test'},
                                marks: [{type: 'link', startOffset: 0, endOffset: 5}],
                            },
                        ],
                    }),
                ),
            ),
        ).toBeNull();
        expect(
            parseBlockRichTextClipboardPayload(
                JSON.stringify(
                    payload({
                        fragments: [
                            {
                                text: 'hello',
                                meta: {type: 'paragraph', ts: '001-test'},
                                marks: [
                                    {
                                        type: 'annotation',
                                        startOffset: 0,
                                        endOffset: 5,
                                        data: {originalId: '', presentation: 'sidebar'},
                                    },
                                ],
                            },
                        ],
                    }),
                ),
            ),
        ).toBeNull();
    });
});

describe('block rich text clipboard serialization', () => {
    it('serializes boolean marks, links, plain text, and HTML', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'hello link', ctx());
        result = toggleMark(result.state, range(blockId, 0, 5), 'bold', ctx());
        result = setLinkMark(result.state, range(blockId, 6, 10), 'https://example.test', ctx());

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 0, 10)),
        );

        expect(payload?.plainText).toBe('hello link');
        expect(payload?.fragments).toEqual([
            {
                text: 'hello link',
                meta: result.state.state.blocks[blockId].meta,
                marks: [
                    {type: 'bold', startOffset: 0, endOffset: 5},
                    {type: 'link', startOffset: 6, endOffset: 10, data: 'https://example.test'},
                ],
            },
        ]);
        expect(payload?.html).toContain('<strong>hello</strong>');
        expect(payload?.html).toContain('<a href="https://example.test">link</a>');
    });

    it('serializes inline and display math marks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'x y', ctx());
        result = setMathMark(result.state, range(blockId, 0, 1), 'inline', ctx());
        result = setMathMark(result.state, range(blockId, 2, 3), 'display', ctx());

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 0, 3)),
        );

        expect(payload?.fragments[0]?.marks).toEqual([
            {type: 'math', startOffset: 0, endOffset: 1},
            {type: 'math', startOffset: 2, endOffset: 3, data: {display: true}},
        ]);
        expect(payload?.html).toContain('data-umkehr-math-display="false"');
        expect(payload?.html).toContain('data-umkehr-math-display="true"');
    });

    it('serializes block metadata for selected fragments', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'Title', ctx());
        result = setBlockMeta(result.state, blockId, {type: 'heading', level: 2, ts: 'heading-ts'});

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 0, 5)),
        );

        expect(payload?.fragments[0]?.meta).toEqual({type: 'heading', level: 2, ts: 'heading-ts'});
        expect(payload?.html).toContain('<h2 data-umkehr-block-type="heading">Title</h2>');
    });

    it('serializes recipe ingredient metadata and generated HTML styling', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), '1 cup flour, chopped', ctx());
        result = setBlockMeta(result.state, blockId, {type: 'recipe_ingredient', ts: 'ingredient-ts'});

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 0, 20)),
        );

        expect(payload?.fragments[0]?.meta).toEqual({type: 'recipe_ingredient', ts: 'ingredient-ts'});
        expect(payload?.html).toContain('data-umkehr-block-type="recipe_ingredient"');
        expect(payload?.html).toContain('<strong>1</strong> <strong>cup</strong> ');
        expect(payload?.html).toContain('<span style="color: #1e7f4f">flour</span>');
        expect(payload?.html).toContain(', <em>chopped</em>');
    });

    it('serializes preview block metadata and HTML fallback', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'Subtitle', ctx());
        result = setBlockMeta(result.state, blockId, {
            type: 'preview',
            url: 'https://example.test',
            preview: {title: 'Example Title', siteName: 'Example'},
            ts: 'preview-ts',
        });

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 0, 8)),
        );

        expect(payload?.fragments[0]?.meta).toEqual({
            type: 'preview',
            url: 'https://example.test',
            preview: {title: 'Example Title', siteName: 'Example'},
            ts: 'preview-ts',
        });
        expect(payload?.html).toContain('data-umkehr-block-type="preview"');
        expect(payload?.html).toContain('<a href="https://example.test">Example Title</a><br>Subtitle');
    });

    it('serializes annotation references and body blocks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'hello', ctx());
        const annotated = createAnnotation(result.state, range(blockId, 1, 4), 'sidebar', makeCommandContext(demo.left));
        result = annotated;
        if (!annotated.bodyBlockId) throw new Error('missing annotation body');
        result = setAnnotationBodyText(result.state, annotated.bodyBlockId, 'note', ctx());

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 0, 5)),
        );

        const originalId = annotated.annotationId ? lamportToString(annotated.annotationId) : '';
        expect(payload?.fragments[0]?.marks).toContainEqual({
            type: 'annotation',
            startOffset: 1,
            endOffset: 4,
            data: {originalId, presentation: 'sidebar'},
        });
        expect(payload?.annotations).toEqual([
            {
                originalId,
                presentation: 'sidebar',
                bodyBlocks: [
                    {
                        text: 'note',
                        meta: result.state.state.blocks[annotated.bodyBlockId].meta,
                        marks: [],
                    },
                ],
            },
        ]);
    });

    it('serializes inline embeds for custom MIME and plain text', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'due ', ctx());
        result = insertInlineEmbed(result.state, result.selection, {type: 'date', value: '2026-06-23'}, ctx());

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 0, 5)),
        );

        expect(payload?.plainText).toBe('due 06/23/2026');
        expect(payload?.fragments[0]).toEqual({
            text: `due ${INLINE_EMBED_TEXT}`,
            meta: result.state.state.blocks[blockId].meta,
            marks: [
                {
                    type: 'embed',
                    startOffset: 4,
                    endOffset: 5,
                    data: {type: 'date', value: '2026-06-23'},
                },
            ],
        });
        expect(payload?.html).toContain('data-umkehr-embed-type="date"');
        expect(payload?.html).toContain('06/23/2026');
    });

    it('parses inline embed marks from custom MIME', () => {
        const parsed = parseBlockRichTextClipboardPayload(
            JSON.stringify(
                payload({
                    plainText: '06/23/2026',
                    fragments: [
                        {
                            text: INLINE_EMBED_TEXT,
                            meta: {type: 'paragraph', ts: '001-test'},
                            marks: [
                                {
                                    type: 'embed',
                                    startOffset: 0,
                                    endOffset: 1,
                                    data: {type: 'date', value: '2026-06-23'},
                                },
                            ],
                        },
                    ],
                }),
            ),
        );

        expect(parsed?.fragments[0]?.marks[0]).toEqual({
            type: 'embed',
            startOffset: 0,
            endOffset: 1,
            data: {type: 'date', value: '2026-06-23'},
        });
    });

    it('serializes multiple selections in document order as separate fragments', () => {
        const demo = createDemoState();
        const first = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(first, 0), 'first', ctx());
        result = splitBlock(result.state, caret(first, 5), ctx());
        result = insertText(result.state, result.selection, 'second', ctx());
        const blocks = materializeFormattedBlocks(result.state);
        const second = blocks[1].id;
        const selection = {
            primaryId: 'second',
            entries: [
                {id: 'second', selection: singleRetainedSelectionSet(result.state, range(second, 0, 6)).entries[0].selection},
                {id: 'first', selection: singleRetainedSelectionSet(result.state, range(first, 0, 5)).entries[0].selection},
            ],
        };

        const payload = serializeSelectionToClipboardPayload(result.state, selection);

        expect(payload?.fragments.map((fragment) => fragment.text)).toEqual(['first', 'second']);
        expect(payload?.plainText).toBe('first\nsecond');
    });

    it('serializes a whole-block selection', () => {
        const demo = createDemoState();
        const first = rootBlockIds(demo.left.state)[0];
        const pasted = pastePlainText(demo.left.state, caret(first, 0), 'one\ntwo', ctx());
        const [, secondBlock] = rootBlockIds(pasted.state);

        const payload = serializeSelectionToClipboardPayload(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, {
                type: 'block',
                anchorBlockId: secondBlock,
                focusBlockId: secondBlock,
            }),
        );

        expect(payload?.plainText).toBe('two');
        expect(payload?.fragments).toHaveLength(1);
        expect(payload?.fragments[0]?.text).toBe('two');
    });

    it('serializes a table-cell rectangle with TSV fallback', () => {
        const context = ctx();
        const demo = createDemoState();
        const tableBlock = rootBlockIds(demo.left.state)[0];
        let result = convertBlockToTable(
            demo.left.state,
            caret(tableBlock, 0),
            context,
            {rows: 2, columns: 2},
        );
        const rows = tableRowsForSelection(result.state, tableBlock);
        const cells = rows.flatMap((rowId) => tableCellsForSelection(result.state, rowId));

        ['A', 'B', 'C', 'D'].forEach((text, index) => {
            result = insertText(result.state, caret(cells[index], 0), text, context);
        });

        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, {
                type: 'table-cells',
                tableId: tableBlock,
                anchorCellId: cells[1],
                focusCellId: cells[2],
            }),
        );

        expect(cells.map((cellId) => blockContents(result.state, cellId))).toEqual(['A', 'B', 'C', 'D']);
        expect(payload?.plainText).toBe('A\nB\nC\nD');
        expect(payload?.tsv).toBe('A\tB\nC\tD');
        expect(payload?.fragments.map((fragment) => fragment.text)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('escapes generated HTML', () => {
        expect(
            fragmentsToHtml([
                {
                    text: '<x>',
                    meta: paragraphMeta('001-test'),
                    marks: [{type: 'link', startOffset: 0, endOffset: 3, data: 'https://example.test/?q="x"'}],
                },
            ]),
        ).toBe(
            '<p data-umkehr-block-type="paragraph"><a href="https://example.test/?q=&quot;x&quot;">&lt;x&gt;</a></p>',
        );
    });
});

const range = (blockId: string, startOffset: number, endOffset: number): EditorSelection => ({
    type: 'range',
    anchor: {blockId, offset: startOffset},
    focus: {blockId, offset: endOffset},
});
