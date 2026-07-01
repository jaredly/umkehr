import type {RichBlockMeta} from './blockMeta';
import {headingMarkdownShortcuts} from './plugins/headings.js';
import type {BlockEditorMarkdownShortcutSpec} from './plugins/index.js';
import {listMarkdownShortcuts} from './plugins/lists.js';
import {todoMarkdownShortcuts} from './plugins/todos.js';

export type MarkdownShortcutMatch = {
    length: number;
    meta: RichBlockMeta;
    kind: 'list' | 'heading' | 'todo';
};

export const markdownShortcutPrefix = (
    text: string,
    currentMeta: RichBlockMeta,
    nextTs: () => string,
): MarkdownShortcutMatch | null =>
    markdownShortcutPrefixFromSpecs(legacyMarkdownShortcutSpecs, text, currentMeta, nextTs);

export const markdownShortcutPrefixFromSpecs = (
    specs: readonly BlockEditorMarkdownShortcutSpec<RichBlockMeta>[],
    text: string,
    currentMeta: RichBlockMeta,
    nextTs: () => string,
): MarkdownShortcutMatch | null => {
    for (const spec of specs) {
        const match = spec.match({text, currentMeta, nextTs});
        if (!match || !isMarkdownShortcutKind(match.kind)) continue;
        return {length: match.length, meta: match.meta, kind: match.kind};
    }
    return null;
};

export const legacyMarkdownShortcutSpecs: readonly BlockEditorMarkdownShortcutSpec<RichBlockMeta>[] = [
    ...listMarkdownShortcuts,
    ...headingMarkdownShortcuts,
    ...todoMarkdownShortcuts,
];

const isMarkdownShortcutKind = (value: string | undefined): value is MarkdownShortcutMatch['kind'] =>
    value === 'list' || value === 'heading' || value === 'todo';
