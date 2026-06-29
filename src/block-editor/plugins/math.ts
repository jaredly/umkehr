import {MATH_MARK} from '../inlineMarks.js';
import type {RichBlockMeta} from '../blockMeta.js';

import type {BlockEditorPlugin} from './types.js';
import {bundledPluginStyle} from './pluginStyles.js';

export const mathPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'math',
    marks: [{id: MATH_MARK, label: 'Math'}],
    inlineRenderers: [{id: 'render:math', markType: MATH_MARK, render: () => null}],
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
    styles: [bundledPluginStyle('math', 'math.css', 30)],
};
