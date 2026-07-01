import {tableVirtualParentsForBlock, type RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin} from './types.js';
import {
    structuralBlockTypeSpec,
    structuralCommands,
    structuralSlashCommands,
    structuralToolbarItems,
} from './structuralHelpers.js';
import {bundledPluginStyle} from './pluginStyles.js';
import {tableBlockRenderer} from './tableRenderer.js';

export const tablePlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'table',
    requires: ['table-selection'],
    blockTypes: [structuralBlockTypeSpec('table', () => true)],
    toolbarItems: structuralToolbarItems([{value: 'table', label: 'Table'}]),
    slashCommands: structuralSlashCommands([{value: 'table', label: 'Table', keywords: ['grid']}]),
    commands: structuralCommands([
        'table:create',
        'table:create-missing-cell',
        'table:add-row',
        'table:add-column',
        'table:move-row',
        'table:move-cell',
        'table:move-cell-rectangle',
        'table:delete-selection',
        'table:clear-cells',
        'table:split-row-header',
        'table:delete-row-header',
        'table:keyboard-navigation',
        'table:drag-drop',
        'table:clipboard',
    ]),
    blockRenderers: [tableBlockRenderer],
    crdt: {
        virtualParents: tableVirtualParentsForBlock,
    },
    styles: [bundledPluginStyle('table', 'table.css', 180)],
};
