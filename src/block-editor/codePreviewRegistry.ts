import {
    CODE_PREVIEW_LANGUAGES,
    type CodePreviewKind,
    type RichBlockMeta,
} from './blockMeta.js';
import type {BlockEditorCodePreviewRenderer, BlockEditorRegistry} from './plugins/index.js';

export const normalizeCodePreviewLanguage = (language: string): string => language.trim().toLowerCase();

export const codePreviewRendererForLanguage = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'codePreviewRenderersByLanguage'>,
    language: string,
): BlockEditorCodePreviewRenderer | null =>
    registry.codePreviewRenderersByLanguage.get(normalizeCodePreviewLanguage(language)) ?? null;

export const codePreviewKindForRenderer = (
    renderer: Pick<BlockEditorCodePreviewRenderer, 'previewKind'>,
): CodePreviewKind => renderer.previewKind;

export const codePreviewRendererForMeta = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'codePreviewRenderersByLanguage'>,
    meta: RichBlockMeta,
): BlockEditorCodePreviewRenderer | null => {
    if (meta.type !== 'code' || !meta.preview) return null;
    const renderer = codePreviewRendererForLanguage(registry, meta.language);
    return renderer?.previewKind === meta.preview ? renderer : null;
};

export const isPreviewableCodeMetaFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'codePreviewRenderersByLanguage'>,
    meta: RichBlockMeta,
): meta is Extract<RichBlockMeta, {type: 'code'}> & {preview: CodePreviewKind} =>
    meta.type === 'code' && codePreviewRendererForMeta(registry, meta) !== null;

export const codeMetaWithPreviewForRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'codePreviewRenderersByLanguage'>,
    meta: Extract<RichBlockMeta, {type: 'code'}>,
    enabled: boolean,
): Extract<RichBlockMeta, {type: 'code'}> => {
    const renderer = codePreviewRendererForLanguage(registry, meta.language);
    if (!enabled || !renderer) {
        const {preview: _preview, ...rest} = meta;
        return rest;
    }
    return {...meta, language: CODE_PREVIEW_LANGUAGES[renderer.previewKind], preview: renderer.previewKind};
};
