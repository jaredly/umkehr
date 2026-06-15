import type {HLC, Lamport} from 'umkehr/block-crdt/types';
import type {Block} from 'umkehr/block-crdt/types';

export type RichBlockMeta =
    | {type: 'paragraph'; ts: HLC}
    | {type: 'heading'; level: 1 | 2 | 3; ts: HLC}
    | {type: 'list_item'; kind: 'ordered' | 'unordered'; ts: HLC}
    | {type: 'todo'; checked: boolean; ts: HLC}
    | {type: 'blockquote'; ts: HLC}
    | {type: 'code'; language: string; ts: HLC}
    | {type: 'callout'; kind: 'info' | 'warning' | 'error'; ts: HLC}
    | {type: 'table'; rowParent: Lamport; ts: HLC}
    | {type: 'table_row'; ts: HLC};

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
        case 'table':
            return {type: 'table', rowParent: meta.rowParent, ts};
        case 'table_row':
            return {type: 'table_row', ts};
    }
};

export const isTableBlock = (meta: RichBlockMeta): boolean => meta.type === 'table';

export const isTableRow = (meta: RichBlockMeta): boolean => meta.type === 'table_row';

export const isCellBlock = (meta: RichBlockMeta): boolean =>
    !isTableBlock(meta) && !isTableRow(meta);

export const isEditableBlock = (meta: RichBlockMeta): boolean => !isTableRow(meta);

export const isWholeSubtreeStyledBlock = (meta: RichBlockMeta): boolean =>
    meta.type === 'blockquote' || meta.type === 'callout';

export const tableVirtualParentsForBlock = (block: Block<RichBlockMeta>): Lamport[] =>
    block.meta.type === 'table' ? [block.meta.rowParent] : [];
