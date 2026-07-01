import {createElement} from 'react';

import type {RichBlockMeta} from '../blockMeta.js';
import {PreviewBlockCard} from '../mediaBlocks.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationOptionPanel, isPreviewMetadata, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const linkPreviewBlockTypeSpec = simpleRichBlockTypeSpec(
    'preview',
    (meta) => typeof meta.url === 'string' && (meta.preview === null || isPreviewMetadata(meta.preview)),
);

export const linkPreviewToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:preview', 'Block type', 'Preview'),
]);

const linkPreviewBlockRenderer = {
    id: 'render:preview',
    blockType: 'preview',
    render(node, context) {
        const meta = node.block.block.meta;
        if (meta.type !== 'preview') return null;
        return createElement(PreviewBlockCard, {
            meta,
            subtitle: context.blocks.renderEditableBlock(node),
            onSetUrl: (url) => context.previews.setUrl(node.id, url),
            onSetMetadata: (url, metadata) => context.previews.setMetadata(node.id, url, metadata),
        });
    },
} satisfies NonNullable<BlockEditorPlugin<RichBlockMeta>['blockRenderers']>[number];

export const linkPreviewPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'link-preview',
    blockTypes: [linkPreviewBlockTypeSpec],
    toolbarItems: linkPreviewToolbarItems,
    slashCommands: withOrder([blockSlashCommand('preview', 'Preview', ['link', 'card', 'url'])]),
    commands: [
        {id: 'preview:set-url', handle: () => undefined},
        {id: 'preview:set-metadata', handle: () => undefined},
    ],
    blockRenderers: [linkPreviewBlockRenderer],
    optionPanels: [declarationOptionPanel('options:preview', 'preview')],
    clipboard: [{id: 'clipboard:preview'}],
    styles: [bundledPluginStyle('link-preview', 'linkPreview.css', 130)],
};
