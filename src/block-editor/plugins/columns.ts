import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorPlugin} from './types.js';
import {
    structuralBlockTypeSpec,
    structuralCommands,
    structuralOptionPanels,
    structuralRenderers,
    structuralSlashCommands,
    structuralToolbarItems,
} from './structuralHelpers.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const columnsPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'columns',
    blockTypes: [structuralBlockTypeSpec('columns', (meta) => meta.display === 'cards' || meta.display === 'blocks')],
    toolbarItems: structuralToolbarItems([
        {value: 'columns', label: 'Columns'},
        {value: 'card-columns', label: 'Card columns'},
    ]),
    slashCommands: structuralSlashCommands([
        {value: 'columns', label: 'Columns', keywords: ['columns', 'layout']},
        {value: 'card-columns', label: 'Card columns', keywords: ['board', 'cards', 'columns']},
    ]),
    commands: structuralCommands([
        'columns:convert',
        'columns:set-display',
        'columns:move-into',
        'columns:move-out',
        'columns:drop',
    ]),
    blockRenderers: structuralRenderers([{id: 'columns', blockType: 'columns'}]),
    optionPanels: structuralOptionPanels([{id: 'columns', blockType: 'columns'}]),
    styles: [bundledPluginStyle('columns', 'columns.css', 160)],
};
