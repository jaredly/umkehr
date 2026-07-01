import {createElement} from 'react';

import type {ImageAttachment} from '../attachments.js';
import type {RichBlockMeta} from '../blockMeta.js';
import {ImagePreview} from '../mediaBlocks.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationOptionPanel, isImagePresentationSize, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const imageBlockTypeSpec = simpleRichBlockTypeSpec(
    'image',
    (meta) => typeof meta.attachmentId === 'string' && isImagePresentationSize(meta.size),
);

export const imageToolbarItems: readonly BlockEditorToolbarItemSpec[] = [
    {id: 'image:upload', group: 'Inline marks', label: 'Image', commandId: 'image:upload', order: 6},
];

const imageBlockRenderer = {
    id: 'render:image',
    blockType: 'image',
    render(node, context) {
        const meta = node.block.block.meta;
        if (meta.type !== 'image') return null;
        const caption = context.blocks.renderEditableBlock(node);
        return createElement(
            'figure',
            {className: `imageBlock imageSize-${meta.size}`},
            createElement(ImagePreview, {
                attachment: context.attachments.get(meta.attachmentId) as ImageAttachment | null,
                attachmentId: meta.attachmentId,
            }),
            createElement('figcaption', null, caption),
        );
    },
} satisfies NonNullable<BlockEditorPlugin<RichBlockMeta>['blockRenderers']>[number];

export const imagesPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'images',
    blockTypes: [imageBlockTypeSpec],
    toolbarItems: imageToolbarItems,
    commands: [
        {id: 'image:upload', handle: () => undefined},
        {id: 'image:set-size', handle: () => undefined},
    ],
    blockRenderers: [imageBlockRenderer],
    optionPanels: [declarationOptionPanel('options:image', 'image')],
    clipboard: [{id: 'clipboard:image'}],
    styles: [bundledPluginStyle('images', 'images.css', 120)],
};
