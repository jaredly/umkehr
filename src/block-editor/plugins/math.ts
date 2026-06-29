import {MATH_MARK} from '../inlineMarks.js';
import type {RichBlockMeta} from '../blockMeta.js';

import type {BlockEditorPlugin} from './types.js';

export const mathPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'math',
    marks: [{id: MATH_MARK, label: 'Math'}],
};
