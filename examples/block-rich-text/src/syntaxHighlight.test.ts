import {describe, expect, it} from 'vitest';
import {highlightCode, normalizeCodeLanguage} from 'umkehr/block-editor';

describe('syntax highlighting', () => {
    it('normalizes common language aliases', () => {
        expect(normalizeCodeLanguage('ts')).toBe('typescript');
        expect(normalizeCodeLanguage('JS')).toBe('javascript');
        expect(normalizeCodeLanguage('md')).toBe('markdown');
        expect(normalizeCodeLanguage('html')).toBe('xml');
        expect(normalizeCodeLanguage(' plain ')).toBe('plaintext');
    });

    it('returns stable tokens for supported languages', () => {
        const tokens = highlightCode('const answer = "yes";', 'javascript');

        expect(tokens.map((token) => token.text).join('')).toBe('const answer = "yes";');
        expect(tokens.some((token) => token.className === 'syntax-keyword')).toBe(true);
        expect(tokens.some((token) => token.className === 'syntax-string')).toBe(true);
    });

    it('falls back to plain tokens for unsupported languages', () => {
        expect(highlightCode('hello()', 'made-up-language')).toEqual([
            {text: 'hello()', className: null},
        ]);
    });

    it('does not emit empty tokens for empty code', () => {
        expect(highlightCode('', 'typescript')).toEqual([]);
    });
});
