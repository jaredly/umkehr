import {describe, expect, it} from 'vitest';
import {exportDocument, importDocument, type DocumentBlock, type ImportDocument} from './documentFormat';
import {documentFixtures, MISSING_FIXTURE_IMAGE_ID} from './documentFixtures';
import type {CommandContext} from './blockCommands';
import {lamportToString} from 'umkehr/block-crdt/utils';

const ctx = (actor = 'fixture-test'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
    };
};

describe('document fixtures', () => {
    it('has unique fixture ids', () => {
        expect(new Set(documentFixtures.map((fixture) => fixture.id)).size).toBe(documentFixtures.length);
    });

    it.each(documentFixtures)('imports $id', (fixture) => {
        expect(() => importDocument(fixture.document(), ctx('fixturetest'))).not.toThrow();
    });

    it.each(documentFixtures.filter((fixture) => !['marked-long-block', 'many-blocks'].includes(fixture.id)))(
        'exports $id after import',
        (fixture) => {
            const imported = importDocument(fixture.document(), ctx('fixturetest'));
            expect(exportDocument(imported.state).length).toBeGreaterThan(0);
        },
        10000,
    );

    it('generates four 400-word long blocks', () => {
        const document = documentFixture('long-blocks');

        expect(document).toHaveLength(4);
        expect(document.map((block) => wordCount(block.content ?? ''))).toEqual([400, 400, 400, 400]);
    });

    it('generates a 600-word marked block with marks and annotations', () => {
        const [block] = documentFixture('marked-long-block');

        expect(wordCount(block.content ?? '')).toBe(600);
        expect(block.marks?.length).toBeGreaterThanOrEqual(60);
        expect(block.annotations?.some((annotation) => annotation.presentation === 'popover')).toBe(true);
    });

    it('includes inline and display math examples', () => {
        const document = documentFixture('math-equations');
        const marks = mathMarks(document);

        expect(marks.length).toBeGreaterThanOrEqual(12);
        expect(marks.some((mark) => mark.display)).toBe(true);
        expect(marks.some((mark) => !mark.display)).toBe(true);
    });

    it('generates a 5 by 7 large table', () => {
        const [table] = documentFixture('large-table');

        expect(table.type).toBe('table');
        expect(table.children).toHaveLength(5);
        expect(table.children?.map((row) => row.children?.length ?? 0)).toEqual([7, 7, 7, 7, 7]);
    });

    it('generates a sparse table with uneven row lengths', () => {
        const [table] = documentFixture('sparse-table');
        const rowLengths = table.children?.map((row) => row.children?.length ?? 0) ?? [];

        expect(new Set(rowLengths).size).toBeGreaterThan(1);
        expect(Math.min(...rowLengths)).toBeLessThan(Math.max(...rowLengths));
    });

    it('generates nested tables in the complex table fixture', () => {
        const [table] = documentFixture('complex-table');

        expect(countBlocksOfType([table], 'table')).toBeGreaterThan(1);
    });

    it('includes a kanban board fixture with mixed cards', () => {
        const [board] = documentFixture('kanban-board');

        expect(board.type).toBe('kanban');
        expect(board.children?.map((column) => column.content)).toEqual(['todo', 'in progress', 'done']);
        expect(countBlocksOfType([board], 'todo')).toBeGreaterThan(1);
        expect(countBlocksOfType([board], 'table')).toBe(1);
    });

    it('includes a slide deck fixture with slides and an orphan slide', () => {
        const [deck, orphan] = documentFixture('slide-deck');

        expect(deck.type).toBe('slide_deck');
        expect(deck.meta).toMatchObject({width: 1600, height: 900, footer: 'deck-title-and-slide-number'});
        expect(deck.children?.filter((child) => child.type === 'slide')).toHaveLength(2);
        expect(deck.children?.some((child) => child.type !== 'slide')).toBe(true);
        expect(countBlocksOfType([deck], 'table')).toBe(1);
        expect(orphan.type).toBe('slide');
    });

    it('includes a block CRDT intro slide deck fixture', () => {
        const [deck] = documentFixture('block-crdt-slide-deck');

        expect(deck.type).toBe('slide_deck');
        expect(deck.content).toBe('Block CRDT and block rich text');
        expect(deck.children?.filter((child) => child.type === 'slide')).toHaveLength(11);
        expect(countBlocksOfType([deck], 'code')).toBeGreaterThanOrEqual(1);
        expect(countBlocksOfType([deck], 'callout')).toBeGreaterThanOrEqual(1);
    });

    it('includes a simple everything slide deck fixture', async () => {
        const fixture = documentFixtures.find((item) => item.id === 'simple-everything-slide-deck');
        if (!fixture) throw new Error('missing simple-everything-slide-deck fixture');
        const [deck] = fixture.document();
        const types = collectBlockTypes([deck]);
        const expectedTypes: Array<Exclude<DocumentBlock['type'], undefined>> = [
            'paragraph',
            'heading',
            'list_item',
            'todo',
            'blockquote',
            'code',
            'callout',
            'recipe_ingredient',
            'table',
            'kanban',
            'slide_deck',
            'slide',
            'poll',
            'image',
            'preview',
        ];

        expect(deck.type).toBe('slide_deck');
        expect(deck.content).toBe('Everything blocks');
        expect(deck.children?.filter((child) => child.type === 'slide')).toHaveLength(6);
        expect(countBlocksOfType([deck], 'slide_deck')).toBeGreaterThan(1);
        for (const type of expectedTypes) expect(types.has(type)).toBe(true);
        expect(codePreviewKinds([deck])).toEqual(expect.arrayContaining(['mermaid', 'vega-lite']));
        expect(calloutKinds([deck])).toEqual(expect.arrayContaining(['info', 'warning', 'error']));
        expect(pollKinds([deck])).toEqual(expect.arrayContaining(['rating', 'children', 'matrix', 'long']));
        expect(markTypes([deck])).toEqual(
            expect.arrayContaining(['bold', 'italic', 'strikethrough', 'code', 'link', 'math']),
        );
        expect(annotationPresentations([deck])).toEqual(
            expect.arrayContaining(['popover', 'sidebar', 'footnote']),
        );

        const attachments = await fixture.attachments?.();
        expect(attachments?.size).toBe(1);
        expect(attachments?.values().next().value?.name).toBe('fixture-everything-slides-image.png');
    });

    it('generates depth-five list nesting', () => {
        const document = documentFixture('deep-list-nesting');

        expect(maxDepth(document)).toBe(5);
    });

    it('generates two hundred short blocks', () => {
        const document = documentFixture('many-blocks');

        expect(document).toHaveLength(200);
        expect(document.every((block) => wordCount(block.content ?? '') === 10)).toBe(true);
    });

    it('includes a mermaid diagram fixture', () => {
        const document = documentFixture('mermaid-diagram');
        const mermaid = document.find(
            (block) => block.type === 'code' && block.meta?.preview === 'mermaid',
        );

        expect(mermaid?.content).toContain('graph TD');
        expect(mermaid?.content).toContain('Diagram preview');
    });

    it('includes a vega-lite chart fixture', () => {
        const document = documentFixture('vega-lite-chart');
        const chart = document.find(
            (block) => block.type === 'code' && block.meta?.preview === 'vega-lite',
        );

        expect(chart?.content).toContain('mark: bar');
        expect(chart?.content).toContain('category: Alpha');
    });

    it('includes generated and missing image references', () => {
        const images = documentFixture('code-callouts-images').filter((block) => block.type === 'image');

        expect(images.some((block) => block.meta?.attachmentId === MISSING_FIXTURE_IMAGE_ID)).toBe(true);
        expect(images.some((block) => block.meta?.attachmentId !== MISSING_FIXTURE_IMAGE_ID)).toBe(true);
    });
});

const documentFixture = (id: string): ImportDocument => {
    const fixture = documentFixtures.find((item) => item.id === id);
    if (!fixture) throw new Error(`missing fixture ${id}`);
    return fixture.document();
};

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const countBlocksOfType = (blocks: DocumentBlock[], type: DocumentBlock['type']): number =>
    blocks.reduce(
        (count, block) =>
            count +
            (block.type === type ? 1 : 0) +
            countBlocksOfType(block.children ?? [], type),
        0,
    );

const collectBlockTypes = (blocks: DocumentBlock[]): Set<Exclude<DocumentBlock['type'], undefined>> =>
    blocks.reduce((types, block) => {
        if (block.type) types.add(block.type);
        for (const childType of collectBlockTypes(block.children ?? [])) types.add(childType);
        return types;
    }, new Set<Exclude<DocumentBlock['type'], undefined>>());

const markTypes = (blocks: DocumentBlock[]): string[] =>
    blocks.flatMap((block) => [
        ...(block.marks ?? []).map((mark) => mark.type),
        ...markTypes(block.children ?? []),
    ]);

const annotationPresentations = (blocks: DocumentBlock[]): string[] =>
    blocks.flatMap((block) => [
        ...(block.annotations ?? []).map((annotation) => annotation.presentation),
        ...annotationPresentations(block.children ?? []),
    ]);

const codePreviewKinds = (blocks: DocumentBlock[]): string[] =>
    blocks.flatMap((block) => [
        ...(block.type === 'code' && typeof block.meta?.preview === 'string' ? [block.meta.preview] : []),
        ...codePreviewKinds(block.children ?? []),
    ]);

const calloutKinds = (blocks: DocumentBlock[]): string[] =>
    blocks.flatMap((block) => [
        ...(block.type === 'callout' && typeof block.meta?.kind === 'string' ? [block.meta.kind] : []),
        ...calloutKinds(block.children ?? []),
    ]);

const pollKinds = (blocks: DocumentBlock[]): string[] =>
    blocks.flatMap((block) => [
        ...(block.type === 'poll' && typeof block.meta?.kind === 'string' ? [block.meta.kind] : []),
        ...pollKinds(block.children ?? []),
    ]);

const mathMarks = (blocks: DocumentBlock[]) =>
    blocks.flatMap((block) => [
        ...(block.marks ?? []).filter((mark) => mark.type === 'math'),
        ...mathMarks(block.children ?? []),
    ]);

const maxDepth = (blocks: DocumentBlock[]): number => {
    if (!blocks.length) return 0;
    return Math.max(...blocks.map((block) => 1 + maxDepth(block.children ?? [])));
};
