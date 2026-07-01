import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationOptionPanel, groupedBlockRenderer, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';
import {bundledPluginStyle} from './pluginStyles.js';

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
    blockRenderers: [
        groupedBlockRenderer('render:callout', 'callout', (node) => {
            const meta = node.block.block.meta;
            return [
                'groupedSubtree',
                'calloutGroup',
                meta.type === 'callout' ? `callout${capitalize(meta.kind)}` : '',
            ]
                .filter(Boolean)
                .join(' ');
        }),
    ],
    optionPanels: [declarationOptionPanel('options:callout', 'callout')],
    styles: [bundledPluginStyle('callouts', 'callouts.css', 90)],
};

const capitalize = (value: string): string => (value ? value[0].toUpperCase() + value.slice(1) : value);
