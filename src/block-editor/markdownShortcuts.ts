import type {RichBlockMeta} from './blockMeta';
import type {BlockEditorMarkdownShortcutSpec} from './plugins/index.js';

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
    {
        id: 'markdown:list-unordered',
        match({text, currentMeta, nextTs}) {
            if (currentMeta.type !== 'paragraph' || (!text.startsWith('- ') && !text.startsWith('* '))) {
                return null;
            }
            return {
                length: 2,
                meta: {type: 'list_item', kind: 'unordered', ts: nextTs()},
                kind: 'list',
            };
        },
    },
    {
        id: 'markdown:list-ordered',
        match({text, currentMeta, nextTs}) {
            if (currentMeta.type !== 'paragraph') return null;
            const ordered = /^[1-9][0-9]*\. /.exec(text);
            if (!ordered) return null;
            return {
                length: ordered[0].length,
                meta: {type: 'list_item', kind: 'ordered', ts: nextTs()},
                kind: 'list',
            };
        },
    },
    {
        id: 'markdown:heading',
        match({text, currentMeta, nextTs}) {
            if (currentMeta.type !== 'paragraph') return null;
            const heading = /^(#{1,3}) /.exec(text);
            if (!heading) return null;
            return {
                length: heading[0].length,
                meta: {type: 'heading', level: heading[1].length as 1 | 2 | 3, ts: nextTs()},
                kind: 'heading',
            };
        },
    },
    {
        id: 'markdown:todo-open',
        match({text, currentMeta, nextTs}) {
            if (!canConvertMarkdownTodoShortcut(currentMeta) || !text.startsWith('[ ] ')) return null;
            return {
                length: 4,
                meta: {type: 'todo', checked: false, ts: nextTs()},
                kind: 'todo',
            };
        },
    },
    {
        id: 'markdown:todo-checked',
        match({text, currentMeta, nextTs}) {
            if (
                !canConvertMarkdownTodoShortcut(currentMeta) ||
                (!text.startsWith('[x] ') && !text.startsWith('[X] '))
            ) {
                return null;
            }
            return {
                length: 4,
                meta: {type: 'todo', checked: true, ts: nextTs()},
                kind: 'todo',
            };
        },
    },
];

const canConvertMarkdownTodoShortcut = (meta: RichBlockMeta): boolean =>
    meta.type === 'paragraph' || (meta.type === 'list_item' && meta.kind === 'unordered');

const isMarkdownShortcutKind = (value: string | undefined): value is MarkdownShortcutMatch['kind'] =>
    value === 'list' || value === 'heading' || value === 'todo';
