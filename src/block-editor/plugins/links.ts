import {LINK_MARK} from '../inlineMarks.js';
import type {RichBlockMeta} from '../blockMeta.js';

import type {BlockEditorPlugin} from './types.js';

export const linksPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'links',
    marks: [{id: LINK_MARK, label: 'Link'}],
    toolbarItems: [{id: 'link:edit', group: 'Inline marks', label: 'Link', commandId: 'link:edit', order: 9}],
    inlineRenderers: [{id: 'render:link', markType: LINK_MARK, render: () => null}],
};
