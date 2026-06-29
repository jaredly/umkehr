import type {RichBlockMeta} from '../blockMeta.js';
import {CODE_MARK} from '../inlineMarks.js';

import type {BlockEditorPlugin} from './types.js';

export const codePlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'code',
    marks: [{id: CODE_MARK, label: 'Code'}],
    toolbarItems: [{id: 'mark:code', group: 'Inline marks', label: 'Code', commandId: 'mark:code', order: 6}],
};
