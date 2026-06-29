import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorMarkdownShortcutSpec, BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationBlockRenderer, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';

export const listBlockTypeSpec = simpleRichBlockTypeSpec('list_item', (meta) =>
    meta.kind === 'ordered' || meta.kind === 'unordered',
);

export const listToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:unordered', 'Block type', 'Bulleted list'),
    toolbarItem('block-type:ordered', 'Block type', 'Numbered list'),
]);

export const listMarkdownShortcuts: readonly BlockEditorMarkdownShortcutSpec<RichBlockMeta>[] = [
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
];

export const listsPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'lists',
    blockTypes: [listBlockTypeSpec],
    toolbarItems: listToolbarItems,
    slashCommands: withOrder([
        blockSlashCommand('unordered', 'Bulleted list', ['bullet', 'unordered']),
        blockSlashCommand('ordered', 'Numbered list', ['number', 'ordered']),
    ]),
    markdownShortcuts: listMarkdownShortcuts,
    blockRenderers: [declarationBlockRenderer('render:list-item', 'list_item')],
};
