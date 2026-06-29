import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationBlockRenderer, declarationOptionPanel, isImagePresentationSize, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const imageBlockTypeSpec = simpleRichBlockTypeSpec(
    'image',
    (meta) => typeof meta.attachmentId === 'string' && isImagePresentationSize(meta.size),
);

export const imageToolbarItems: readonly BlockEditorToolbarItemSpec[] = [
    {id: 'image:upload', group: 'Inline marks', label: 'Image', commandId: 'image:upload', order: 6},
];

export const imagesPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'images',
    blockTypes: [imageBlockTypeSpec],
    toolbarItems: imageToolbarItems,
    commands: [
        {id: 'image:upload', handle: () => undefined},
        {id: 'image:set-size', handle: () => undefined},
    ],
    blockRenderers: [declarationBlockRenderer('render:image', 'image')],
    optionPanels: [declarationOptionPanel('options:image', 'image')],
    clipboard: [{id: 'clipboard:image'}],
    styles: [bundledPluginStyle('images', 'images.css', 120)],
};
