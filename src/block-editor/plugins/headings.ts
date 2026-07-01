import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorMarkdownShortcutSpec, BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {editableBlockRenderer, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const headingBlockTypeSpec = simpleRichBlockTypeSpec('heading', (meta) =>
    meta.level === 1 || meta.level === 2 || meta.level === 3,
);

export const headingToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:heading1', 'Block type', 'Heading 1'),
    toolbarItem('block-type:heading2', 'Block type', 'Heading 2'),
    toolbarItem('block-type:heading3', 'Block type', 'Heading 3'),
]);

export const headingMarkdownShortcuts: readonly BlockEditorMarkdownShortcutSpec<RichBlockMeta>[] = [
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
];

export const headingsPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'headings',
    blockTypes: [headingBlockTypeSpec],
    toolbarItems: headingToolbarItems,
    slashCommands: withOrder([
        blockSlashCommand('heading1', 'Heading 1', ['h1', 'title']),
        blockSlashCommand('heading2', 'Heading 2', ['h2', 'subtitle']),
        blockSlashCommand('heading3', 'Heading 3', ['h3']),
    ]),
    markdownShortcuts: headingMarkdownShortcuts,
    blockRenderers: [editableBlockRenderer('render:heading', 'heading')],
    styles: [bundledPluginStyle('headings', 'headings.css', 50)],
};
