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
        const mermaid = document.find((block) => block.type === 'mermaid');

        expect(mermaid?.content).toContain('graph TD');
        expect(mermaid?.content).toContain('Diagram preview');
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

const maxDepth = (blocks: DocumentBlock[]): number => {
    if (!blocks.length) return 0;
    return Math.max(...blocks.map((block) => 1 + maxDepth(block.children ?? [])));
};
