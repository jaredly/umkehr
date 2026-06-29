import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationBlockRenderer, declarationOptionPanel, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';

export const calloutBlockTypeSpec = simpleRichBlockTypeSpec('callout', (meta) =>
    meta.kind === 'info' || meta.kind === 'warning' || meta.kind === 'error',
);

export const calloutToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:callout-info', 'Block type', 'Info callout'),
    toolbarItem('block-type:callout-warning', 'Block type', 'Warning callout'),
    toolbarItem('block-type:callout-error', 'Block type', 'Error callout'),
]);

export const calloutsPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'callouts',
    blockTypes: [calloutBlockTypeSpec],
    toolbarItems: calloutToolbarItems,
    slashCommands: withOrder([
        blockSlashCommand('callout-info', 'Info callout', ['info']),
        blockSlashCommand('callout-warning', 'Warning callout', ['warning']),
        blockSlashCommand('callout-error', 'Error callout', ['error']),
    ]),
    commands: [{id: 'callout:set-kind', handle: () => undefined}],
    blockRenderers: [declarationBlockRenderer('render:callout', 'callout')],
    optionPanels: [declarationOptionPanel('options:callout', 'callout')],
};
