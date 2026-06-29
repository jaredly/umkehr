import {tableVirtualParentsForBlock, type RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin} from './types.js';
import {
    structuralBlockTypeSpec,
    structuralCommands,
    structuralRenderers,
    structuralSlashCommands,
    structuralToolbarItems,
} from './structuralHelpers.js';

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
    blockRenderers: structuralRenderers([{id: 'table', blockType: 'table'}]),
    crdt: {
        virtualParents: tableVirtualParentsForBlock,
    },
};
