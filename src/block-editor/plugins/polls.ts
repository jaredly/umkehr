import type {RichBlockMeta} from '../blockMeta.js';
import {mergeRichBlockMeta, isPollMeta} from '../pollBlocks.js';
import type {BlockEditorPlugin} from './types.js';
import {
    structuralBlockTypeSpec,
    structuralCommands,
    structuralOptionPanels,
    structuralToolbarItems,
} from './structuralHelpers.js';
import {bundledPluginStyle} from './pluginStyles.js';
import {pollBlockRenderer} from './pollRenderer.js';

export const pollsPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'polls',
    blockTypes: [structuralBlockTypeSpec('poll', isPollMeta)],
    toolbarItems: structuralToolbarItems([
        {value: 'poll-rating', label: 'Rating poll'},
        {value: 'poll-children', label: 'Answer poll'},
        {value: 'poll-matrix', label: 'Matrix poll'},
        {value: 'poll-long', label: 'Long-answer poll'},
    ]),
    commands: structuralCommands([
        'poll:vote',
        'poll:clear-vote',
        'poll:set-choice-mode',
        'poll:set-display-mode',
        'poll:set-allow-change',
        'poll:set-rating-maximum',
        'poll:set-rating-presentation',
    ]),
    blockRenderers: [pollBlockRenderer],
    optionPanels: structuralOptionPanels([{id: 'poll', blockType: 'poll'}]),
    crdt: {
        mergeBlockMetaTypes: ['poll'],
        mergeBlockMeta: mergeRichBlockMeta,
    },
    styles: [bundledPluginStyle('polls', 'polls.css', 150)],
};
