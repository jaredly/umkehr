import {createElement, type CSSProperties} from 'react';

import type {ImagePresentationSize, PreviewMetadata, RichBlockMeta} from '../blockMeta.js';
import {sameTypeWithTs} from '../blockMeta.js';
import type {
    BlockEditorBlockRenderer,
    BlockEditorBlockTypeSpec,
    BlockEditorEditableBlockOptions,
    BlockEditorOptionPanelSpec,
    BlockEditorRenderedBlockNode,
} from './types.js';

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

export const editableBlockRenderer = (
    id: string,
    blockType: RichBlockMeta['type'],
    options?: BlockEditorEditableBlockOptions | ((node: BlockEditorRenderedBlockNode<RichBlockMeta>) => BlockEditorEditableBlockOptions),
): BlockEditorBlockRenderer<RichBlockMeta> => ({
    id,
    blockType,
    render: (node, context) =>
        context.blocks.renderEditableBlock(
            node,
            typeof options === 'function' ? options(node) : options,
        ),
});

export const groupedBlockRenderer = (
    id: string,
    blockType: RichBlockMeta['type'],
    className: string | ((node: BlockEditorRenderedBlockNode<RichBlockMeta>) => string),
): BlockEditorBlockRenderer<RichBlockMeta> => ({
    id,
    blockType,
    children: 'renderer',
    render: (node, context) =>
        createElement(
            'div',
            {
                className: typeof className === 'function' ? className(node) : className,
                style: {'--group-depth': node.block.depth} as CSSProperties,
            },
            context.blocks.renderEditableBlock(node),
            ...context.blocks.renderChildren(node),
        ),
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
