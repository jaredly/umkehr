import {describe, expect, it} from 'vitest';
import type {FormattedBlock} from 'umkehr/block-crdt';
import type {RichBlockMeta} from './blockMeta';
import {
    codeLanguageForSelectionSegments,
    codeRangeAroundOffset,
    isLinkLikeText,
    mathDisplayModeFromMarkValue,
    mathRangeAroundOffset,
    MATH_MARK,
    linkHrefForSelectionSegments,
    linkRangeAroundOffset,
    normalizeStoredCodeLanguage,
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
        block: {id: [1, 'test'], parent: [0, 'root'], order: '00000', meta: {type: 'paragraph', ts: '0'}, style: {}},
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

    it('finds a bare code range across adjacent formatted runs', () => {
        const formatted = block([
            {text: 'a', marks: {}},
            {text: 'bc', marks: {code: true}},
            {text: 'de', marks: {bold: true, code: true}},
            {text: 'f', marks: {}},
        ]);

        expect(codeRangeAroundOffset(formatted, 3)).toEqual({
            blockId: 'block-1',
            startOffset: 1,
            endOffset: 5,
            language: '',
        });
    });

    it('reads math mode from mark metadata', () => {
        expect(mathDisplayModeFromMarkValue(true)).toBe('inline');
        expect(mathDisplayModeFromMarkValue({display: false})).toBe('inline');
        expect(mathDisplayModeFromMarkValue({display: true})).toBe('display');
        expect(mathDisplayModeFromMarkValue({display: true, extra: true})).toBeNull();
        expect(mathDisplayModeFromMarkValue('math')).toBeNull();
    });

    it('finds contiguous math ranges by display mode', () => {
        const formatted = block([
            {text: 'a', marks: {}},
            {text: 'bc', marks: {[MATH_MARK]: true}},
            {text: 'de', marks: {bold: true, [MATH_MARK]: {display: false}}},
            {text: 'fg', marks: {[MATH_MARK]: {display: true}}},
        ]);

        expect(mathRangeAroundOffset(formatted, 2)).toEqual({
            blockId: 'block-1',
            startOffset: 1,
            endOffset: 5,
            mode: 'inline',
        });
        expect(mathRangeAroundOffset(formatted, 5)).toEqual({
            blockId: 'block-1',
            startOffset: 5,
            endOffset: 7,
            mode: 'display',
        });
    });

    it('finds a language code range using normalized aliases', () => {
        const formatted = block([
            {text: 'a', marks: {}},
            {text: 'bc', marks: {code: 'ts'}},
            {text: 'de', marks: {italic: true, code: 'typescript'}},
            {text: 'f', marks: {code: 'javascript'}},
        ]);

        expect(codeRangeAroundOffset(formatted, 2)).toEqual({
            blockId: 'block-1',
            startOffset: 1,
            endOffset: 5,
            language: 'typescript',
        });
    });

    it('returns a consistent code language only when every selected character has the same code mark', () => {
        const blocks = [
            block([
                {text: 'ab', marks: {code: 'ts'}},
                {text: 'cd', marks: {code: 'typescript'}},
                {text: 'e', marks: {code: true}},
                {text: 'f', marks: {}},
            ]),
        ];

        expect(codeLanguageForSelectionSegments(blocks, [{blockId: 'block-1', startOffset: 0, endOffset: 4}])).toBe(
            'typescript',
        );
        expect(codeLanguageForSelectionSegments(blocks, [{blockId: 'block-1', startOffset: 4, endOffset: 5}])).toBe(
            '',
        );
        expect(codeLanguageForSelectionSegments(blocks, [{blockId: 'block-1', startOffset: 0, endOffset: 5}])).toBeNull();
        expect(codeLanguageForSelectionSegments(blocks, [{blockId: 'block-1', startOffset: 5, endOffset: 6}])).toBeNull();
    });

    it('normalizes known code languages and keeps unknown languages lowercase', () => {
        expect(normalizeStoredCodeLanguage(' TS ')).toBe('typescript');
        expect(normalizeStoredCodeLanguage('JS')).toBe('javascript');
        expect(normalizeStoredCodeLanguage('Made-Up-Language')).toBe('made-up-language');
        expect(normalizeStoredCodeLanguage('   ')).toBe('');
    });
});
