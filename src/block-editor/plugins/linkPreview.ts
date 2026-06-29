import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationBlockRenderer, declarationOptionPanel, isPreviewMetadata, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const linkPreviewBlockTypeSpec = simpleRichBlockTypeSpec(
    'preview',
    (meta) => typeof meta.url === 'string' && (meta.preview === null || isPreviewMetadata(meta.preview)),
);

export const linkPreviewToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:preview', 'Block type', 'Preview'),
]);

export const linkPreviewPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'link-preview',
    blockTypes: [linkPreviewBlockTypeSpec],
    toolbarItems: linkPreviewToolbarItems,
    slashCommands: withOrder([blockSlashCommand('preview', 'Preview', ['link', 'card', 'url'])]),
    commands: [
        {id: 'preview:set-url', handle: () => undefined},
        {id: 'preview:set-metadata', handle: () => undefined},
    ],
    blockRenderers: [declarationBlockRenderer('render:preview', 'preview')],
    optionPanels: [declarationOptionPanel('options:preview', 'preview')],
    clipboard: [{id: 'clipboard:preview'}],
    styles: [bundledPluginStyle('link-preview', 'linkPreview.css', 130)],
};
