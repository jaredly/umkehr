import type {AttachmentStore, ImageAttachment} from './attachments';
import type {DocumentAnnotation, DocumentBlock, DocumentMark, ImportDocument} from './documentFormat';

export type DocumentFixture = {
    id: string;
    label: string;
    document(): ImportDocument;
    attachments?(): Promise<AttachmentStore>;
};

type FixtureImage = {
    id: string;
    label: string;
    background: string;
    foreground: string;
};

const VALID_IMAGE_ID = 'fixture-generated-image';
export const MISSING_FIXTURE_IMAGE_ID = 'fixture-missing-image';

export const documentFixtures: DocumentFixture[] = [
    {
        id: 'simple-mixed-blocks',
        label: 'Simple mixed blocks',
        document: simpleMixedBlocks,
        attachments: () =>
            generatedImageAttachments([
                {
                    id: VALID_IMAGE_ID,
                    label: 'Fixture image',
                    background: '#dfe9f3',
                    foreground: '#31516b',
                },
            ]),
    },
    {id: 'long-blocks', label: 'Long blocks', document: longBlocks},
    {id: 'marked-long-block', label: 'Marked long block', document: markedLongBlock},
    {id: 'math-equations', label: 'Math equations', document: mathEquations},
    {id: 'large-table', label: 'Large table', document: largeTable},
    {id: 'sparse-table', label: 'Sparse table', document: sparseTable},
    {id: 'complex-table', label: 'Complex table', document: complexTable},
    {id: 'kanban-board', label: 'Kanban board', document: kanbanBoard},
    {id: 'deep-list-nesting', label: 'Deep list nesting', document: deepListNesting},
    {id: 'many-blocks', label: 'Many blocks', document: manyBlocks},
    {id: 'mixed-table-and-text', label: 'Mixed table and text', document: mixedTableAndText},
    {id: 'mermaid-diagram', label: 'Mermaid diagram', document: mermaidDiagram},
    {id: 'vega-lite-chart', label: 'Vega-Lite chart', document: vegaLiteChart},
    {
        id: 'code-callouts-images',
        label: 'Code, callouts, and images',
        document: codeCalloutsImages,
        attachments: () =>
            generatedImageAttachments([
                {
                    id: VALID_IMAGE_ID,
                    label: 'Generated diagram',
                    background: '#e9f4eb',
                    foreground: '#236842',
                },
            ]),
    },
    {id: 'empty-short-grapheme-blocks', label: 'Empty, short, and grapheme blocks', document: emptyShortGraphemeBlocks},
];

export const fixtureById = (id: string): DocumentFixture | null =>
    documentFixtures.find((fixture) => fixture.id === id) ?? null;

function simpleMixedBlocks(): ImportDocument {
    return [
    {type: 'heading', meta: {level: 1}, content: 'Fixture document'},
    {
        content: 'This paragraph has bold text, italic text, a link, and a popover note.',
        marks: [
            {type: 'bold', start: 19, end: 28},
            {type: 'italic', start: 30, end: 41},
            {type: 'link', start: 45, end: 49, href: 'https://example.test/fixture'},
        ],
        annotations: [
            {
                type: 'annotation',
                presentation: 'popover',
                start: 57,
                end: 64,
                body: [{content: 'Popover body generated from fixture JSON.'}],
            },
        ],
    },
    {type: 'todo', meta: {checked: true}, content: 'Verify fixture replacement'},
    {type: 'callout', meta: {kind: 'warning'}, content: 'Generated fixtures are intentionally varied.'},
    {type: 'code', meta: {language: 'TypeScript'}, content: 'const fixture = true;'},
    {type: 'blockquote', content: 'A quote block keeps styled block rendering covered.'},
    {
        type: 'list_item',
        meta: {kind: 'ordered'},
        content: 'First ordered item',
        children: [{type: 'list_item', meta: {kind: 'unordered'}, content: 'Nested unordered item'}],
    },
    {
        type: 'preview',
        meta: {
            url: 'https://example.test/fixtures',
            preview: {title: 'Fixture Preview', siteName: 'Example', fetchedAt: '2026-06-24T00:00:00Z'},
        },
        content: 'Fixture Preview',
    },
    {type: 'image', meta: {attachmentId: VALID_IMAGE_ID, size: 'medium'}},
    {type: 'image', meta: {attachmentId: MISSING_FIXTURE_IMAGE_ID, size: 'small'}},
    ];
}

function longBlocks(): ImportDocument {
    return Array.from({length: 4}, (_, index) => ({
        type: 'paragraph',
        content: words(400, `long-${index}`),
    }));
}

function markedLongBlock(): ImportDocument {
    const content = words(600, 'marked');
    return [
        {
            content,
            marks: generatedMarks(content),
            annotations: generatedAnnotations(content),
        },
    ];
}

function mathEquations(): ImportDocument {
    const inlineBasics = 'Inline math can live inside prose: E = mc^2, a^2 + b^2 = c^2, and \\int_0^1 x^2 dx = 1/3.';
    const namedVariables = 'Named variables and Greek letters: \\alpha + \\beta = \\gamma, f(x) = \\sin(x), and \\lim_{n \\to \\infty} 1/n = 0.';
    const mixedFormatting = 'Formatting can sit beside math: bold claim, then y = mx + b, then more text.';
    const tableCell = 'Cell formula: A = \\pi r^2';

    return [
        {type: 'heading', meta: {level: 1}, content: 'Math equation fixture'},
        {
            content: inlineBasics,
            marks: [
                mathMark(inlineBasics, 'E = mc^2'),
                mathMark(inlineBasics, 'a^2 + b^2 = c^2'),
                mathMark(inlineBasics, '\\int_0^1 x^2 dx = 1/3'),
            ],
        },
        {
            content: namedVariables,
            marks: [
                mathMark(namedVariables, '\\alpha + \\beta = \\gamma'),
                mathMark(namedVariables, 'f(x) = \\sin(x)'),
                mathMark(namedVariables, '\\lim_{n \\to \\infty} 1/n = 0'),
            ],
        },
        displayMathBlock(String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`),
        displayMathBlock(String.raw`\sum_{k=0}^{n} k = \frac{n(n + 1)}{2}`),
        displayMathBlock(String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}\begin{bmatrix} x \\ y \end{bmatrix} = \begin{bmatrix} ax + by \\ cx + dy \end{bmatrix}`),
        displayMathBlock(String.raw`\begin{aligned} f(x) &= x^2 + 2x + 1 \\ &= (x + 1)^2 \end{aligned}`),
        {
            type: 'blockquote',
            content: mixedFormatting,
            marks: [
                {type: 'bold', start: 33, end: 43},
                mathMark(mixedFormatting, 'y = mx + b'),
            ],
        },
        {
            type: 'table',
            content: 'Math in table cells',
            children: [
                {
                    content: 'Geometry',
                    children: [
                        {content: tableCell, marks: [mathMark(tableCell, 'A = \\pi r^2')]},
                        displayMathBlock(String.raw`V = \frac{4}{3}\pi r^3`),
                    ],
                },
                {
                    content: 'Calculus',
                    children: [
                        displayMathBlock(String.raw`\frac{d}{dx}x^n = nx^{n - 1}`),
                        displayMathBlock(String.raw`\int e^x\,dx = e^x + C`),
                    ],
                },
            ],
        },
    ];
}

const mathMark = (content: string, source: string, display = false): DocumentMark => {
    const start = content.indexOf(source);
    if (start < 0) throw new Error(`missing math source ${source}`);
    return {type: 'math', start, end: start + source.length, ...(display ? {display: true} : {})};
};

const displayMathBlock = (source: string): DocumentBlock => ({
    content: source,
    marks: [mathMark(source, source, true)],
});

function largeTable(): ImportDocument {
    return [{
        type: 'table',
        content: 'Large table fixture',
        children: Array.from({length: 5}, (_, row) => ({
            content: `Row ${row + 1}`,
            children: Array.from({length: 7}, (_, column) => ({
                content: `Cell ${row + 1}-${column + 1} value`,
            })),
        })),
    }];
}

function sparseTable(): ImportDocument {
    return [{
        type: 'table',
        content: 'Sparse table fixture',
        children: [7, 4, 6, 2, 5].map((cellCount, row) => ({
            content: `Sparse row ${row + 1}`,
            children: Array.from({length: cellCount}, (_, column) => ({
                content: `Sparse ${row + 1}-${column + 1}`,
            })),
        })),
    }];
}

function complexTable(): ImportDocument {
    return [{
        type: 'table',
        content: 'Complex table fixture',
        children: [
            {
                content: 'Header row',
                children: [{content: 'Area'}, {content: 'Nested content'}, {content: 'Status'}],
            },
            {
                content: 'Row with nested table in cell',
                children: [
                    {content: 'Planning'},
                    {
                        content: 'Nested table lives below',
                        children: [smallNestedTable('Cell nested table')],
                    },
                    {content: 'Active'},
                ],
            },
            smallNestedTable('Row nested table'),
            {
                content: 'Row with list in cell',
                children: [
                    {content: 'Execution'},
                    {
                        content: 'Checklist',
                        children: [
                            {type: 'list_item', content: 'First nested task'},
                            {type: 'list_item', content: 'Second nested task'},
                        ],
                    },
                    {content: 'Queued'},
                ],
            },
        ],
    }];
}

function kanbanBoard(): ImportDocument {
    return [{
        type: 'kanban',
        content: 'Launch board',
        children: [
            {
                content: 'todo',
                children: [
                    {
                        content: 'Draft release notes',
                        children: [
                            {type: 'todo', meta: {checked: false}, content: 'Collect screenshots'},
                            {content: 'Confirm publish date'},
                        ],
                    },
                    {type: 'code', meta: {language: 'text'}, content: 'owner: docs\nrisk: medium'},
                ],
            },
            {
                content: 'in progress',
                children: [
                    {type: 'todo', meta: {checked: false}, content: 'QA import/export'},
                    {
                        type: 'callout',
                        meta: {kind: 'warning'},
                        content: 'Design review pending',
                    },
                ],
            },
            {
                content: 'done',
                children: [
                    {type: 'todo', meta: {checked: true}, content: 'Kickoff'},
                    smallNestedTable('Metrics card'),
                ],
            },
        ],
    }];
}

function deepListNesting(): ImportDocument {
    return [nestedList(5, 1)];
}

function manyBlocks(): ImportDocument {
    return Array.from({length: 200}, (_, index) => ({
        type: blockTypeForIndex(index),
        ...(blockTypeForIndex(index) === 'todo' ? {meta: {checked: index % 4 === 0}} : {}),
        ...(blockTypeForIndex(index) === 'callout' ? {meta: {kind: calloutKindForIndex(index)}} : {}),
        content: words(10, `many-${index}`),
    } as DocumentBlock));
}

function mixedTableAndText(): ImportDocument {
    return [
        {type: 'heading', meta: {level: 2}, content: 'Table boundaries'},
        {content: 'Paragraph before the table to test navigation into the grid.'},
        ...largeTable(),
        {content: 'Paragraph after the table to test navigation out of the grid.'},
    ];
}

function mermaidDiagram(): ImportDocument {
    return [
        {type: 'heading', meta: {level: 2}, content: 'Mermaid diagram fixture'},
        {
            type: 'code',
            meta: {language: 'mermaid', preview: 'mermaid'},
            content: [
                'graph TD',
                '  A[Draft source] --> B{Render?}',
                '  B -->|View| C[Diagram preview]',
                '  B -->|Edit| D[Code-like editor]',
                '  D --> A',
            ].join('\n'),
        },
        {content: 'Use the Mermaid block toggle to switch between editing source and viewing the rendered diagram.'},
    ];
}

function vegaLiteChart(): ImportDocument {
    return [
        {type: 'heading', meta: {level: 2}, content: 'Vega-Lite chart fixture'},
        {
            type: 'code',
            meta: {language: 'vega-lite', preview: 'vega-lite'},
            content: [
                '$schema: https://vega.github.io/schema/vega-lite/v5.json',
                'width: 320',
                'height: 180',
                'data:',
                '  values:',
                '    - category: Alpha',
                '      value: 28',
                '    - category: Beta',
                '      value: 55',
                '    - category: Gamma',
                '      value: 43',
                'mark: bar',
                'encoding:',
                '  x:',
                '    field: category',
                '    type: nominal',
                '  y:',
                '    field: value',
                '    type: quantitative',
            ].join('\n'),
        },
        {content: 'Use split view to edit the chart spec while watching the preview.'},
    ];
}

function codeCalloutsImages(): ImportDocument {
    return [
        {type: 'code', meta: {language: 'JavaScript'}, content: 'function fixture() {\n  return true;\n}'},
        {type: 'callout', meta: {kind: 'info'}, content: 'Info callout'},
        {type: 'callout', meta: {kind: 'warning'}, content: 'Warning callout'},
        {type: 'callout', meta: {kind: 'error'}, content: 'Error callout'},
        {type: 'image', meta: {attachmentId: VALID_IMAGE_ID, size: 'large'}},
        {type: 'image', meta: {attachmentId: MISSING_FIXTURE_IMAGE_ID, size: 'medium'}},
    ];
}

function emptyShortGraphemeBlocks(): ImportDocument {
    return [
        {content: ''},
        {type: 'todo', content: '', meta: {checked: false}},
        {content: 'x'},
        {
            content: 'a👨‍👩‍👧‍👦b café',
            marks: [
                {type: 'bold', start: 1, end: 2},
                {type: 'italic', start: 3, end: 8},
            ],
        },
    ];
}

const smallNestedTable = (title: string): DocumentBlock => ({
    type: 'table',
    content: title,
    children: [
        {content: 'Nested row 1', children: [{content: 'N1 A'}, {content: 'N1 B'}]},
        {content: 'Nested row 2', children: [{content: 'N2 A'}, {content: 'N2 B'}]},
    ],
});

const nestedList = (depth: number, index: number): DocumentBlock => ({
    type: 'list_item',
    meta: {kind: depth % 2 === 0 ? 'ordered' : 'unordered'},
    content: `Nested list depth ${index}`,
    ...(depth > 1 ? {children: [nestedList(depth - 1, index + 1)]} : {}),
});

const vocabulary = [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
    'i',
    'j',
    'k',
    'l',
    'm',
    'n',
    'o',
    'q',
];

const words = (count: number, seed: string): string =>
    Array.from({length: count}, (_, index) => vocabulary[(index + seed.length) % vocabulary.length]).join(' ');

const wordRanges = (content: string): Array<{start: number; end: number}> => {
    const ranges: Array<{start: number; end: number}> = [];
    let offset = 0;
    for (const word of content.split(' ')) {
        ranges.push({start: offset, end: offset + word.length});
        offset += word.length + 1;
    }
    return ranges;
};

const generatedMarks = (content: string): DocumentMark[] => {
    const ranges = wordRanges(content);
    const marks: DocumentMark[] = [];
    const cycle = ['bold', 'italic', 'strikethrough', 'code', 'link'] as const;
    for (let wordIndex = 0; wordIndex < ranges.length; wordIndex += 10) {
        const type = cycle[(wordIndex / 10) % cycle.length];
        const length = 1 + ((wordIndex / 10) % 3);
        const start = ranges[wordIndex].start;
        const end = ranges[Math.min(ranges.length - 1, wordIndex + length - 1)].end;
        if (type === 'link') {
            marks.push({type, start, end, href: `https://example.test/mark/${wordIndex}`});
        } else if (type === 'code') {
            marks.push({type, start, end, language: 'text'});
        } else {
            marks.push({type, start, end});
        }
    }
    return marks;
};

const generatedAnnotations = (content: string): DocumentAnnotation[] => {
    const ranges = wordRanges(content);
    const presentations = ['popover', 'sidebar', 'footnote'] as const;
    const annotations: DocumentAnnotation[] = [];
    for (let wordIndex = 50; wordIndex < ranges.length; wordIndex += 90) {
        const start = ranges[wordIndex].start;
        const end = ranges[Math.min(ranges.length - 1, wordIndex + 1)].end;
        const presentation = presentations[((wordIndex - 50) / 90) % presentations.length];
        annotations.push({
            type: 'annotation',
            presentation,
            start,
            end,
            body: [{content: `${presentation} annotation for words ${wordIndex}-${wordIndex + 1}`}],
        });
    }
    return annotations;
};

const blockTypeForIndex = (index: number): DocumentBlock['type'] => {
    if (index % 20 === 0) return 'callout';
    if (index % 10 === 0) return 'todo';
    if (index % 15 === 0) return 'blockquote';
    return 'paragraph';
};

const calloutKindForIndex = (index: number) =>
    (['info', 'warning', 'error'] as const)[index % 3];

const generatedImageAttachments = async (images: FixtureImage[]): Promise<AttachmentStore> => {
    const attachments: AttachmentStore = new Map();
    for (const image of images) {
        attachments.set(image.id, await generatedImageAttachment(image));
    }
    return attachments;
};

const generatedImageAttachment = async (image: FixtureImage): Promise<ImageAttachment> => {
    const width = 640;
    const height = 360;
    const dataUrl = await canvasDataUrl(width, height, image);
    return {
        id: image.id,
        objectUrl: dataUrl,
        name: `${image.id}.png`,
        mimeType: 'image/png',
        width,
        height,
        uploadStatus: 'local',
        bytes: dataUrl,
    };
};

const canvasDataUrl = async (width: number, height: number, image: FixtureImage): Promise<string> => {
    if (typeof document === 'undefined') return fallbackSvgDataUrl(width, height, image);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    let context: CanvasRenderingContext2D | null = null;
    try {
        context = canvas.getContext('2d');
    } catch {
        return fallbackSvgDataUrl(width, height, image);
    }
    if (!context) return fallbackSvgDataUrl(width, height, image);
    context.fillStyle = image.background;
    context.fillRect(0, 0, width, height);
    context.fillStyle = image.foreground;
    context.fillRect(48, 48, width - 96, height - 96);
    context.fillStyle = '#ffffff';
    context.font = 'bold 42px sans-serif';
    context.fillText(image.label, 86, 185);
    try {
        return canvas.toDataURL('image/png');
    } catch {
        return fallbackSvgDataUrl(width, height, image);
    }
};

const fallbackSvgDataUrl = (width: number, height: number, image: FixtureImage): string => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${image.background}"/><rect x="48" y="48" width="${width - 96}" height="${height - 96}" fill="${image.foreground}"/><text x="86" y="185" fill="white" font-family="sans-serif" font-size="42" font-weight="700">${escapeSvgText(image.label)}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const escapeSvgText = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
