import {MATH_MARK} from '../inlineMarks.js';
import type {RichBlockMeta} from '../blockMeta.js';

import type {BlockEditorPlugin} from './types.js';

export const mathPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'math',
    marks: [{id: MATH_MARK, label: 'Math'}],
    toolbarItems: [
        {id: 'mark:math', group: 'Inline marks', label: 'Math', commandId: 'mark:math', order: 7},
        {
            id: 'mark:display-math',
            group: 'Inline marks',
            label: 'Display Math',
            commandId: 'mark:display-math',
            order: 8,
        },
    ],
};
