import type {ImagePresentationSize, PreviewMetadata, RichBlockMeta} from '../blockMeta.js';
import {sameTypeWithTs} from '../blockMeta.js';
import type {BlockEditorBlockRenderer, BlockEditorBlockTypeSpec, BlockEditorOptionPanelSpec} from './types.js';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const simpleRichBlockTypeSpec = <Meta extends RichBlockMeta>(
    id: Meta['type'],
    validateMeta: (meta: Record<string, unknown>) => boolean,
): BlockEditorBlockTypeSpec<RichBlockMeta> => ({
    id,
    validate: (meta): meta is RichBlockMeta =>
        isRecord(meta) && meta.type === id && typeof meta.ts === 'string' && validateMeta(meta),
    isMeta: (meta): meta is RichBlockMeta => (meta as {type?: unknown}).type === id,
    withTs: (meta, ts) => sameTypeWithTs(meta, ts),
});

export const declarationBlockRenderer = (id: string, blockType: string): BlockEditorBlockRenderer<RichBlockMeta> => ({
    id,
    blockType,
    render: () => null,
});

export const declarationOptionPanel = (id: string, blockType: string): BlockEditorOptionPanelSpec<RichBlockMeta> => ({
    id,
    blockType,
    render: () => null,
});

export const isImagePresentationSize = (value: unknown): value is ImagePresentationSize =>
    value === 'small' || value === 'medium' || value === 'large' || value === 'original';

export const isPreviewMetadata = (value: unknown): value is PreviewMetadata => {
    if (!isRecord(value)) return false;
    return (
        optionalString(value.title) &&
        optionalString(value.description) &&
        optionalString(value.siteName) &&
        optionalString(value.imageUrl) &&
        optionalString(value.resolvedUrl) &&
        optionalString(value.fetchedAt)
    );
};

const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';
