import type {RichBlockMeta} from './blockMeta';

export type MarkdownShortcutMatch = {
    length: number;
    meta: RichBlockMeta;
    kind: 'list' | 'heading' | 'todo';
};

export const markdownShortcutPrefix = (
    text: string,
    currentMeta: RichBlockMeta,
    nextTs: () => string,
): MarkdownShortcutMatch | null => {
    if (currentMeta.type === 'paragraph' && (text.startsWith('- ') || text.startsWith('* '))) {
        return {
            length: 2,
            meta: {type: 'list_item', kind: 'unordered', ts: nextTs()},
            kind: 'list',
        };
    }
    if (currentMeta.type === 'paragraph') {
        const ordered = /^[1-9][0-9]*\. /.exec(text);
        if (ordered) {
            return {
                length: ordered[0].length,
                meta: {type: 'list_item', kind: 'ordered', ts: nextTs()},
                kind: 'list',
            };
        }
    }
    if (currentMeta.type === 'paragraph') {
        const heading = /^(#{1,3}) /.exec(text);
        if (heading) {
            return {
                length: heading[0].length,
                meta: {type: 'heading', level: heading[1].length as 1 | 2 | 3, ts: nextTs()},
                kind: 'heading',
            };
        }
    }
    if (!canConvertMarkdownTodoShortcut(currentMeta)) return null;
    if (text.startsWith('[ ] ')) {
        return {
            length: 4,
            meta: {type: 'todo', checked: false, ts: nextTs()},
            kind: 'todo',
        };
    }
    if (text.startsWith('[x] ') || text.startsWith('[X] ')) {
        return {
            length: 4,
            meta: {type: 'todo', checked: true, ts: nextTs()},
            kind: 'todo',
        };
    }
    return null;
};

const canConvertMarkdownTodoShortcut = (meta: RichBlockMeta): boolean =>
    meta.type === 'paragraph' || (meta.type === 'list_item' && meta.kind === 'unordered');
