import {describe, expect, it} from 'vitest';
import {
    blockContents,
    materializeFormattedBlocks,
    rootBlockIds,
    visibleBlockChildren,
} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import type {CommandContext} from './blockCommands';
import {annotationVirtualParents} from './annotations';
import {
    DocumentFormatError,
    exportDocument,
    importDocument,
    type DocumentBlock,
} from './documentFormat';

const ctx = (actor = 'importer'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
    };
};

const rootTexts = (result: ReturnType<typeof importDocument>): string[] =>
    rootBlockIds(result.state).map((id) => blockContents(result.state, id));

describe('block rich text document format import', () => {
    it('imports an empty document without a starter paragraph', () => {
        const result = importDocument([], ctx());

        expect(rootBlockIds(result.state)).toEqual([]);
        expect(result.blockIds).toEqual([]);
        expect(result.ops).toEqual([]);
    });

    it('defaults missing block type to paragraph and imports root blocks in order', () => {
        const result = importDocument(
            [
                {content: 'Hello'},
                {type: 'todo', meta: {checked: true}, content: 'Write tests'},
            ],
            ctx(),
        );

        expect(rootTexts(result)).toEqual(['Hello', 'Write tests']);
        const [firstId, secondId] = rootBlockIds(result.state);
        expect(result.state.state.blocks[firstId].meta.type).toBe('paragraph');
        expect(result.state.state.blocks[secondId].meta).toMatchObject({type: 'todo', checked: true});
    });

    it('imports nested children in order', () => {
        const result = importDocument(
            [
                {
                    type: 'list_item',
                    content: 'Parent',
                    children: [
                        {content: 'Child 1'},
                        {content: 'Child 2'},
                    ],
                },
            ],
            ctx(),
        );

        const [parentId] = rootBlockIds(result.state);
        const childIds = visibleBlockChildren(result.state, parentId, annotationVirtualParents(result.state));
        expect(blockContents(result.state, parentId)).toBe('Parent');
        expect(childIds.map((id) => blockContents(result.state, id))).toEqual(['Child 1', 'Child 2']);
    });

    it('imports metadata-bearing block types', () => {
        const result = importDocument(
            [
                {type: 'heading', meta: {level: 2}, content: 'Title'},
                {type: 'list_item', meta: {kind: 'ordered'}, content: 'One'},
                {type: 'code', meta: {language: 'TypeScript'}, content: 'const x = 1;'},
                {type: 'code', meta: {language: 'mermaid', preview: 'mermaid'}, content: 'graph TD\nA-->B'},
                {type: 'callout', meta: {kind: 'warning'}, content: 'Careful'},
                {type: 'image', meta: {attachmentId: 'image-1', size: 'large'}},
                {
                    type: 'preview',
                    meta: {
                        url: 'https://example.test',
                        preview: {title: 'Example', fetchedAt: '2026-06-24T00:00:00Z'},
                    },
                    content: 'Example',
                },
            ],
            ctx(),
        );

        const metas = rootBlockIds(result.state).map((id) => result.state.state.blocks[id].meta);
        expect(metas).toMatchObject([
            {type: 'heading', level: 2},
            {type: 'list_item', kind: 'ordered'},
            {type: 'code', language: 'typescript'},
            {type: 'code', language: 'mermaid', preview: 'mermaid'},
            {type: 'callout', kind: 'warning'},
            {type: 'image', attachmentId: 'image-1', size: 'large'},
            {
                type: 'preview',
                url: 'https://example.test',
                preview: {title: 'Example', fetchedAt: '2026-06-24T00:00:00Z'},
            },
        ]);
    });

    it('represents tables as normal nested blocks', () => {
        const result = importDocument(
            [
                {
                    type: 'table',
                    children: [
                        {
                            content: 'Row 1',
                            children: [{content: 'A1'}, {content: 'B1'}],
                        },
                    ],
                },
            ],
            ctx(),
        );

        const [tableId] = rootBlockIds(result.state);
        const [rowId] = visibleBlockChildren(result.state, tableId, annotationVirtualParents(result.state));
        const cellIds = visibleBlockChildren(result.state, rowId, annotationVirtualParents(result.state));
        expect(result.state.state.blocks[tableId].meta.type).toBe('table');
        expect(blockContents(result.state, rowId)).toBe('Row 1');
        expect(cellIds.map((id) => blockContents(result.state, id))).toEqual(['A1', 'B1']);
    });

    it('represents kanban boards as normal nested blocks', () => {
        const result = importDocument(
            [
                {
                    type: 'kanban',
                    content: 'Project board',
                    children: [
                        {
                            content: 'todo',
                            children: [{content: 'Draft proposal'}],
                        },
                        {
                            content: 'done',
                            children: [{type: 'todo', meta: {checked: true}, content: 'Kickoff'}],
                        },
                    ],
                },
            ],
            ctx(),
        );

        const [boardId] = rootBlockIds(result.state);
        const columnIds = visibleBlockChildren(result.state, boardId, annotationVirtualParents(result.state));
        const firstColumnCardIds = visibleBlockChildren(
            result.state,
            columnIds[0],
            annotationVirtualParents(result.state),
        );
        expect(result.state.state.blocks[boardId].meta.type).toBe('kanban');
        expect(blockContents(result.state, boardId)).toBe('Project board');
        expect(columnIds.map((id) => blockContents(result.state, id))).toEqual(['todo', 'done']);
        expect(firstColumnCardIds.map((id) => blockContents(result.state, id))).toEqual(['Draft proposal']);
    });

    it('imports marks with grapheme offsets', () => {
        const result = importDocument(
            [
                {
                    content: 'a👨‍👩‍👧‍👦b link code',
                    marks: [
                        {type: 'bold', start: 1, end: 2},
                        {type: 'italic', start: 0, end: 1},
                        {type: 'strikethrough', start: 2, end: 3},
                        {type: 'link', start: 4, end: 8, href: 'https://example.test'},
                        {type: 'code', start: 9, end: 13, language: 'TypeScript'},
                    ],
                },
            ],
            ctx(),
        );

        const [block] = materializeFormattedBlocks(result.state);
        expect(block.runs.map((run) => ({text: run.text, marks: run.marks}))).toEqual([
            {text: 'a', marks: {italic: true}},
            {text: '👨‍👩‍👧‍👦', marks: {bold: true}},
            {text: 'b', marks: {strikethrough: true}},
            {text: ' ', marks: {}},
            {text: 'link', marks: {link: 'https://example.test'}},
            {text: ' ', marks: {}},
            {text: 'code', marks: {code: 'typescript'}},
        ]);
    });

    it('imports annotations with body blocks', () => {
        const result = importDocument(
            [
                {
                    content: 'alpha beta gamma',
                    annotations: [
                        {
                            type: 'annotation',
                            presentation: 'popover',
                            start: 6,
                            end: 10,
                            body: [
                                {
                                    content: 'Popover note',
                                    marks: [{type: 'italic', start: 0, end: 7}],
                                },
                            ],
                        },
                        {
                            type: 'annotation',
                            presentation: 'sidebar',
                            start: 11,
                            end: 16,
                            body: [{content: 'Sidebar note'}],
                        },
                    ],
                },
            ],
            ctx(),
        );

        expect(exportDocument(result.state)).toEqual([
            {
                type: 'paragraph',
                content: 'alpha beta gamma',
                annotations: [
                    {
                        type: 'annotation',
                        presentation: 'popover',
                        start: 6,
                        end: 10,
                        body: [
                            {
                                type: 'paragraph',
                                content: 'Popover note',
                                marks: [{type: 'italic', start: 0, end: 7}],
                            },
                        ],
                    },
                    {
                        type: 'annotation',
                        presentation: 'sidebar',
                        start: 11,
                        end: 16,
                        body: [{type: 'paragraph', content: 'Sidebar note'}],
                    },
                ],
            },
        ]);
    });

    it('throws detailed path-aware validation errors', () => {
        expect(() => importDocument([{type: 'heading', meta: {level: 4}}], ctx())).toThrow(
            new DocumentFormatError('$[0].meta.level', 'must be 1, 2, or 3'),
        );
        expect(() => importDocument([{content: 'abc', marks: [{type: 'bold', start: 0, end: 4}]}], ctx()))
            .toThrow('$[0].marks[0]: mark range must satisfy 0 <= start < end <= 3');
        expect(() => importDocument([{type: 'image', meta: {}}], ctx())).toThrow(
            '$[0].meta.attachmentId: must be a non-empty string',
        );
        expect(() => importDocument([{children: ['nope']}], ctx())).toThrow('$[0].children[0]: block must be an object');
        expect(() =>
            importDocument(
                [{content: 'abc', annotations: [{type: 'annotation', presentation: 'popover', start: 0, end: 4}]}],
                ctx(),
            ),
        ).toThrow('$[0].annotations[0]: annotation range must satisfy 0 <= start < end <= 3');
        expect(() =>
            importDocument(
                [{content: 'abc', annotations: [{type: 'annotation', presentation: 'tooltip', start: 0, end: 1}]}],
                ctx(),
            ),
        ).toThrow('$[0].annotations[0].presentation: must be "sidebar", "footnote", or "popover"');
    });
});

describe('block rich text document format export', () => {
    it('exports a normalized document without timestamps', () => {
        const input: DocumentBlock[] = [
            {
                type: 'todo',
                meta: {checked: true},
                content: 'Write a list',
                children: [
                    {content: 'add a block'},
                    {
                        content: 'type in it',
                        marks: [
                            {type: 'bold', start: 0, end: 4},
                            {type: 'link', start: 5, end: 7, href: 'https://example.test'},
                        ],
                    },
                ],
            },
        ];

        const imported = importDocument(input, ctx());

        expect(exportDocument(imported.state)).toEqual([
            {
                type: 'todo',
                meta: {checked: true},
                content: 'Write a list',
                children: [
                    {type: 'paragraph', content: 'add a block'},
                    {
                        type: 'paragraph',
                        content: 'type in it',
                        marks: [
                            {type: 'bold', start: 0, end: 4},
                            {type: 'link', start: 5, end: 7, href: 'https://example.test'},
                        ],
                    },
                ],
            },
        ]);
    });

    it('round-trips image and preview metadata', () => {
        const input: DocumentBlock[] = [
            {type: 'image', meta: {attachmentId: 'image-1', size: 'small'}},
            {
                type: 'preview',
                meta: {url: 'https://example.test', preview: {title: 'Example'}},
                content: 'Example',
            },
        ];

        const imported = importDocument(input, ctx());

        expect(exportDocument(imported.state)).toEqual(input);
    });

    it('round-trips previewable code blocks', () => {
        const input: DocumentBlock[] = [
            {type: 'code', meta: {language: 'mermaid', preview: 'mermaid'}, content: 'graph TD\nA-->B'},
            {type: 'code', meta: {language: 'vega-lite', preview: 'vega-lite'}, content: '{"mark":"bar"}'},
        ];

        const imported = importDocument(input, ctx());

        expect(exportDocument(imported.state)).toEqual(input);
    });

    it('round-trips kanban boards', () => {
        const input: DocumentBlock[] = [
            {
                type: 'kanban',
                content: 'Project board',
                children: [
                    {content: 'todo', children: [{content: 'Draft proposal'}]},
                    {content: 'in progress', children: [{type: 'code', meta: {language: 'text'}, content: 'notes'}]},
                    {content: 'done'},
                ],
            },
        ];

        const imported = importDocument(input, ctx());

        expect(exportDocument(imported.state)).toEqual([
            {
                type: 'kanban',
                content: 'Project board',
                children: [
                    {type: 'paragraph', content: 'todo', children: [{type: 'paragraph', content: 'Draft proposal'}]},
                    {
                        type: 'paragraph',
                        content: 'in progress',
                        children: [{type: 'code', meta: {language: 'plaintext'}, content: 'notes'}],
                    },
                    {type: 'paragraph', content: 'done'},
                ],
            },
        ]);
    });

    it('round-trips footnote annotation metadata', () => {
        const input: DocumentBlock[] = [
            {
                content: 'Annotated text',
                annotations: [
                    {
                        type: 'annotation',
                        presentation: 'footnote',
                        start: 0,
                        end: 9,
                        body: [{content: 'Footnote body'}],
                    },
                ],
            },
        ];

        const imported = importDocument(input, ctx());

        expect(exportDocument(imported.state)).toEqual([
            {
                type: 'paragraph',
                content: 'Annotated text',
                annotations: [
                    {
                        type: 'annotation',
                        presentation: 'footnote',
                        start: 0,
                        end: 9,
                        body: [{type: 'paragraph', content: 'Footnote body'}],
                    },
                ],
            },
        ]);
    });
});
