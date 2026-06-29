import type {RichBlockMeta} from './blockMeta.js';
import {legacyRichTextCrdtPlugins} from './editorCrdtConfig.js';
import {
    basicMarksPlugin,
    inlineDatePlugin,
    legacyRichTextBlocksPlugin,
    legacyRichTextUiPlugin,
    linksPlugin,
    mathPlugin,
    type BlockEditorPlugin,
} from './plugins/index.js';

export const legacyRichTextPlugins: readonly BlockEditorPlugin<RichBlockMeta>[] = [
    basicMarksPlugin,
    inlineDatePlugin,
    legacyRichTextBlocksPlugin,
    legacyRichTextUiPlugin,
    linksPlugin,
    mathPlugin,
    ...legacyRichTextCrdtPlugins,
];
