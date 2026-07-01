import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {groupedBlockRenderer, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const quoteBlockTypeSpec = simpleRichBlockTypeSpec('blockquote', () => true);

export const quoteToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:blockquote', 'Block type', 'Quote'),
]);

export const quotePlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'quote',
    blockTypes: [quoteBlockTypeSpec],
    toolbarItems: quoteToolbarItems,
    slashCommands: withOrder([blockSlashCommand('blockquote', 'Blockquote', ['quote'])]),
    blockRenderers: [groupedBlockRenderer('render:blockquote', 'blockquote', 'groupedSubtree blockquoteGroup')],
    styles: [bundledPluginStyle('quote', 'quote.css', 80)],
};
