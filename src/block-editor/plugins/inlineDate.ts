import type {RichBlockMeta} from '../blockMeta.js';
import {INLINE_EMBED_MARK} from '../inlineEmbeds.js';

import type {BlockEditorPlugin} from './types.js';

export const inlineDatePlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'inline-date',
    marks: [{id: INLINE_EMBED_MARK, label: 'Inline embed'}],
    inlineEmbeds: [{id: 'date', label: 'Date'}],
    toolbarItems: [
        {id: 'inline-embed:date', group: 'Inline marks', label: 'Date', commandId: 'inline-embed:date', order: 10},
    ],
    slashCommands: [
        {
            id: 'inline-embed:date',
            label: 'Date',
            group: 'Inline embed',
            keywords: ['embed', 'calendar'],
            commandId: 'inline-embed:date',
            order: 22,
        },
    ],
};
