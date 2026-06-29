import type {RichBlockMeta} from '../blockMeta.js';
import {INLINE_EMBED_MARK} from '../inlineEmbeds.js';

import type {BlockEditorPlugin} from './types.js';

export const inlineDatePlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'inline-date',
    marks: [{id: INLINE_EMBED_MARK, label: 'Inline embed'}],
    inlineEmbeds: [{id: 'date', label: 'Date'}],
};
