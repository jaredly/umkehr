import {describe, expect, it} from 'vitest';
import type {FormattedBlock} from 'umkehr/block-crdt';
import type {RichBlockMeta} from './blockMeta';
import {
    isLinkLikeText,
    linkHrefForSelectionSegments,
    linkRangeAroundOffset,
    textForSelectionSegments,
} from './inlineMarks';

const block = (
    runs: FormattedBlock<RichBlockMeta>['runs'],
    id = 'block-1',
): FormattedBlock<RichBlockMeta> =>
    ({
        id,
        runs,
        depth: 0,
        parentId: '0-root',
        block: {id: [1, 'test'], parent: [0, 'root'], order: '00000', meta: {type: 'paragraph', ts: '0'}},
    }) as FormattedBlock<RichBlockMeta>;

describe('block rich text inline mark helpers', () => {
    it('detects only explicit link-like targets without normalizing', () => {
        expect(isLinkLikeText('https://example.test')).toBe(true);
        expect(isLinkLikeText(' http://example.test/path ')).toBe(true);
        expect(isLinkLikeText('mailto:test@example.test')).toBe(true);
        expect(isLinkLikeText('example.test')).toBe(false);
        expect(isLinkLikeText('https://example.test with-space')).toBe(false);
    });

    it('finds a contiguous link range across adjacent runs with the same href', () => {
        const formatted = block([
            {text: 'a', marks: {}},
            {text: 'bc', marks: {link: 'https://example.test'}},
            {text: 'de', marks: {bold: true, link: 'https://example.test'}},
            {text: 'f', marks: {link: 'https://other.test'}},
        ]);

        expect(linkRangeAroundOffset(formatted, 3)).toEqual({
            blockId: 'block-1',
            startOffset: 1,
            endOffset: 5,
            href: 'https://example.test',
        });
    });

    it('returns a consistent href only when every selected character has the same link', () => {
        const blocks = [
            block([
                {text: 'ab', marks: {link: 'https://example.test'}},
                {text: 'c', marks: {link: 'https://other.test'}},
            ]),
        ];

        expect(linkHrefForSelectionSegments(blocks, [{blockId: 'block-1', startOffset: 0, endOffset: 2}])).toBe(
            'https://example.test',
        );
        expect(linkHrefForSelectionSegments(blocks, [{blockId: 'block-1', startOffset: 0, endOffset: 3}])).toBeNull();
    });

    it('extracts selected text across block segments', () => {
        const blocks = [
            block([{text: 'alpha', marks: {}}], 'first'),
            block([{text: 'beta', marks: {}}], 'second'),
        ];

        expect(
            textForSelectionSegments(blocks, [
                {blockId: 'first', startOffset: 1, endOffset: 5},
                {blockId: 'second', startOffset: 0, endOffset: 2},
            ]),
        ).toBe('lpha\nbe');
    });
});
