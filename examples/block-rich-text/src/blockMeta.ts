import type {HLC, Lamport} from 'umkehr/block-crdt/types';
import type {Block} from 'umkehr/block-crdt/types';

export type ImagePresentationSize = 'small' | 'medium' | 'large' | 'original';

export type PreviewMetadata = {
    title?: string;
    description?: string;
    siteName?: string;
    imageUrl?: string;
    resolvedUrl?: string;
    fetchedAt?: string;
};

export type RichBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    | {type: 'heading'; level: 1 | 2 | 3; ts: HLC}
    | {type: 'list_item'; kind: 'ordered' | 'unordered'; ts: HLC}
    | {type: 'todo'; checked: boolean; ts: HLC}
    | {type: 'blockquote'; ts: HLC}
    | {type: 'code'; language: string; ts: HLC}
    | {type: 'callout'; kind: 'info' | 'warning' | 'error'; ts: HLC}
    | {type: 'recipe_ingredient'; ts: HLC}
    | {type: 'table'; ts: HLC}
    | {type: 'image'; attachmentId: string; size: ImagePresentationSize; ts: HLC}
    | {type: 'preview'; url: string; preview: PreviewMetadata | null; ts: HLC};

export type RichBlockType = RichBlockMeta['type'];

export const paragraphMeta = (ts: HLC): RichBlockMeta => ({type: 'paragraph', ts});

export const sameTypeWithTs = (meta: RichBlockMeta, ts: HLC): RichBlockMeta => {
    switch (meta.type) {
        case 'paragraph':
            return paragraphMeta(ts);
        case 'heading':
            return {type: 'heading', level: meta.level, ts};
        case 'list_item':
            return {type: 'list_item', kind: meta.kind, ts};
        case 'todo':
            return {type: 'todo', checked: meta.checked, ts};
        case 'blockquote':
            return {type: 'blockquote', ts};
        case 'code':
            return {type: 'code', language: meta.language, ts};
        case 'callout':
            return {type: 'callout', kind: meta.kind, ts};
        case 'recipe_ingredient':
            return {type: 'recipe_ingredient', ts};
        case 'table':
            return {type: 'table', ts};
        case 'image':
            return {type: 'image', attachmentId: meta.attachmentId, size: meta.size, ts};
        case 'preview':
            return {type: 'preview', url: meta.url, preview: meta.preview, ts};
    }
};

export const isTableBlock = (meta: RichBlockMeta): boolean => meta.type === 'table';

export const isCellBlock = (meta: RichBlockMeta): boolean => !isTableBlock(meta);

export const isEditableBlock = (_meta: RichBlockMeta): boolean => true;

export const isWholeSubtreeStyledBlock = (meta: RichBlockMeta): boolean =>
    meta.type === 'blockquote' || meta.type === 'callout';

export const tableVirtualParentsForBlock = (_block: Block<RichBlockMeta>): Lamport[] => [];
