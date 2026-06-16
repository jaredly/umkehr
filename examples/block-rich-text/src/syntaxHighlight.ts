import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

export type SyntaxToken = {
    text: string;
    className: string | null;
};

type HighlightNode = string | {scope?: string; children?: HighlightNode[]};

const languages = {
    css,
    javascript,
    json,
    markdown,
    typescript,
    xml,
};

for (const [name, language] of Object.entries(languages)) {
    hljs.registerLanguage(name, language);
}

const languageAliases = new Map([
    ['css', 'css'],
    ['html', 'xml'],
    ['js', 'javascript'],
    ['javascript', 'javascript'],
    ['json', 'json'],
    ['markdown', 'markdown'],
    ['md', 'markdown'],
    ['plain', 'plaintext'],
    ['text', 'plaintext'],
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['typescript', 'typescript'],
    ['xml', 'xml'],
    ['jsx', 'javascript'],
]);

export const normalizeCodeLanguage = (language: string): string | null => {
    const normalized = language.trim().toLowerCase();
    if (!normalized) return null;
    return languageAliases.get(normalized) ?? normalized;
};

export const highlightCode = (text: string, language: string): SyntaxToken[] => {
    if (!text) return [];

    const normalized = normalizeCodeLanguage(language);
    if (!normalized || normalized === 'plaintext' || !hljs.getLanguage(normalized)) {
        return [{text, className: null}];
    }

    try {
        const result = hljs.highlight(text, {language: normalized, ignoreIllegals: true});
        const root = (result._emitter as unknown as {rootNode?: HighlightNode}).rootNode;
        if (!root || typeof root === 'string') return [{text, className: null}];
        const tokens = flattenHighlightNodes(root.children ?? [], null);
        return coalesceTokens(tokens.length ? tokens : [{text, className: null}]);
    } catch {
        return [{text, className: null}];
    }
};

const flattenHighlightNodes = (
    nodes: HighlightNode[],
    inheritedClassName: string | null,
): SyntaxToken[] =>
    nodes.flatMap((node) => {
        if (typeof node === 'string') {
            return node ? [{text: node, className: inheritedClassName}] : [];
        }
        const className = syntaxClassName(node.scope) ?? inheritedClassName;
        return flattenHighlightNodes(node.children ?? [], className);
    });

const syntaxClassName = (scope: string | undefined): string | null => {
    if (!scope) return null;
    const primary = scope.split(/\s+/)[0]?.split('.').at(-1);
    if (!primary || primary.startsWith('language:')) return null;
    return `syntax-${primary.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
};

const coalesceTokens = (tokens: SyntaxToken[]): SyntaxToken[] => {
    const result: SyntaxToken[] = [];
    for (const token of tokens) {
        if (!token.text) continue;
        const previous = result.at(-1);
        if (previous && previous.className === token.className) {
            previous.text += token.text;
        } else {
            result.push({...token});
        }
    }
    return result;
};
