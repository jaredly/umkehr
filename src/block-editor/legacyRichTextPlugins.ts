import type {RichBlockMeta} from './blockMeta.js';
import {legacyRichTextCrdtPlugins} from './editorCrdtConfig.js';
import {
    legacyRichTextBlocksPlugin,
    legacyRichTextUiPlugin,
    type BlockEditorPlugin,
} from './plugins/index.js';

export const legacyRichTextPlugins: readonly BlockEditorPlugin<RichBlockMeta>[] = [
    legacyRichTextBlocksPlugin,
    legacyRichTextUiPlugin,
    ...legacyRichTextCrdtPlugins,
];
