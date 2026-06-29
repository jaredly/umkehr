import type {RichBlockMeta} from './blockMeta.js';
import {legacyRichTextCrdtPlugins} from './editorCrdtConfig.js';
import {
    basicMarksPlugin,
    calloutsPlugin,
    codePlugin,
    headingsPlugin,
    imagesPlugin,
    inlineDatePlugin,
    ingredientsPlugin,
    legacyRichTextBlocksPlugin,
    legacyRichTextUiPlugin,
    linkPreviewPlugin,
    linksPlugin,
    listsPlugin,
    mathPlugin,
    quotePlugin,
    todosPlugin,
    type BlockEditorPlugin,
} from './plugins/index.js';

export const legacyRichTextPlugins: readonly BlockEditorPlugin<RichBlockMeta>[] = [
    basicMarksPlugin,
    calloutsPlugin,
    codePlugin,
    headingsPlugin,
    imagesPlugin,
    inlineDatePlugin,
    ingredientsPlugin,
    legacyRichTextBlocksPlugin,
    legacyRichTextUiPlugin,
    linkPreviewPlugin,
    linksPlugin,
    listsPlugin,
    mathPlugin,
    quotePlugin,
    todosPlugin,
    ...legacyRichTextCrdtPlugins,
];
