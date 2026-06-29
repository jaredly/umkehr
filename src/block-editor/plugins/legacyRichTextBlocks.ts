import type {RichBlockMeta, RichBlockType} from '../blockMeta.js';
import {sameTypeWithTs} from '../blockMeta.js';
import {isPollMeta} from '../pollBlocks.js';
import type {BlockEditorBlockTypeSpec, BlockEditorPlugin} from './types.js';

export const legacyRichTextBlockTypeIds: readonly Exclude<RichBlockType, 'paragraph'>[] = [
    'table',
    'columns',
    'slide_deck',
    'slide',
    'poll',
];

export const legacyRichTextBlockTypeSpecs: readonly BlockEditorBlockTypeSpec<RichBlockMeta>[] =
    legacyRichTextBlockTypeIds.map((id) => ({
        id,
        validate: (meta): meta is RichBlockMeta => isLegacyRichBlockMeta(meta) && meta.type === id,
        withTs: (meta, ts) => sameTypeWithTs(meta, ts),
    }));

export const legacyRichTextBlocksPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'legacy-rich-text-blocks',
    blockTypes: legacyRichTextBlockTypeSpecs,
};

export const isLegacyRichBlockMeta = (value: unknown): value is RichBlockMeta => {
    if (!isRecord(value) || typeof value.ts !== 'string' || typeof value.type !== 'string') return false;
    switch (value.type) {
        case 'paragraph':
            return true;
        case 'heading':
            return value.level === 1 || value.level === 2 || value.level === 3;
        case 'list_item':
            return value.kind === 'ordered' || value.kind === 'unordered';
        case 'todo':
            return typeof value.checked === 'boolean';
        case 'blockquote':
            return true;
        case 'code':
            return (
                typeof value.language === 'string' &&
                (value.preview === undefined || value.preview === 'mermaid' || value.preview === 'vega-lite')
            );
        case 'callout':
            return value.kind === 'info' || value.kind === 'warning' || value.kind === 'error';
        case 'recipe_ingredient':
            return true;
        case 'table':
            return true;
        case 'columns':
            return value.display === 'cards' || value.display === 'blocks';
        case 'slide_deck':
            return (
                typeof value.width === 'number' &&
                typeof value.height === 'number' &&
                ['none', 'deck-title', 'slide-number', 'deck-title-and-slide-number'].includes(
                    String(value.footer),
                )
            );
        case 'slide':
            return (
                typeof value.showTitle === 'boolean' &&
                (value.transition === 'none' || value.transition === 'fade' || value.transition === 'slide')
            );
        case 'poll':
            return isPollMeta(value);
        case 'image':
            return (
                typeof value.attachmentId === 'string' &&
                (value.size === 'small' ||
                    value.size === 'medium' ||
                    value.size === 'large' ||
                    value.size === 'original')
            );
        case 'preview':
            return typeof value.url === 'string' && (value.preview === null || isRecord(value.preview));
        default:
            return false;
    }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
