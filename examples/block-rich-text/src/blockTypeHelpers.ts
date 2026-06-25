import type {FormattedBlock} from 'umkehr/block-crdt';

import {defaultRatingPollMeta, paragraphMeta, type RichBlockMeta} from './blockMeta';
import type {BlockTypeMenuValue} from './blockEditorTypes';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;

export const deriveOrderedListNumbers = (blocks: RichFormattedBlock[]): Map<string, number> => {
    const result = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const block of blocks) {
        const parentKey = block.parentId;
        if (block.block.meta.type === 'list_item' && block.block.meta.kind === 'ordered') {
            const next = (counters.get(parentKey) ?? 0) + 1;
            counters.set(parentKey, next);
            result.set(block.id, next);
        } else {
            counters.set(parentKey, 0);
        }
    }
    return result;
};

export const blockTypeMeta = (
    kind: BlockTypeMenuValue,
    current: RichBlockMeta,
    ts: string,
): RichBlockMeta => {
    switch (kind) {
        case 'paragraph':
            return paragraphMeta(ts);
        case 'heading1':
            return {type: 'heading', level: 1, ts};
        case 'heading2':
            return {type: 'heading', level: 2, ts};
        case 'heading3':
            return {type: 'heading', level: 3, ts};
        case 'unordered':
            return {type: 'list_item', kind: 'unordered', ts};
        case 'ordered':
            return {type: 'list_item', kind: 'ordered', ts};
        case 'todo':
            return {type: 'todo', checked: current.type === 'todo' ? current.checked : false, ts};
        case 'blockquote':
            return {type: 'blockquote', ts};
        case 'code':
            return {type: 'code', language: current.type === 'code' ? current.language : '', ts};
        case 'mermaid':
            return {type: 'code', language: 'mermaid', preview: 'mermaid', ts};
        case 'vega-lite':
            return {type: 'code', language: 'vega-lite', preview: 'vega-lite', ts};
        case 'callout-info':
            return {type: 'callout', kind: 'info', ts};
        case 'callout-warning':
            return {type: 'callout', kind: 'warning', ts};
        case 'callout-error':
            return {type: 'callout', kind: 'error', ts};
        case 'recipe-ingredient':
            return {type: 'recipe_ingredient', ts};
        case 'table':
            return current;
        case 'kanban':
            return current;
        case 'preview':
            return {
                type: 'preview',
                url: current.type === 'preview' ? current.url : '',
                preview: current.type === 'preview' ? current.preview : null,
                ts,
            };
        case 'poll-rating':
            return defaultRatingPollMeta(ts);
        case 'poll-children':
            return {type: 'poll', kind: 'children', choiceMode: 'single', allowChange: true, votes: {}, ts};
        case 'poll-matrix':
            return {type: 'poll', kind: 'matrix', choiceMode: 'single', allowChange: true, votes: {}, ts};
        case 'poll-long':
            return {type: 'poll', kind: 'long', allowChange: true, votes: {}, ts};
    }
};

export const blockTypeMenuValue = (meta: RichBlockMeta | undefined): BlockTypeMenuValue => {
    if (!meta) return 'paragraph';
    switch (meta.type) {
        case 'paragraph':
            return 'paragraph';
        case 'heading':
            return meta.level === 1 ? 'heading1' : meta.level === 2 ? 'heading2' : 'heading3';
        case 'list_item':
            return meta.kind;
        case 'todo':
            return 'todo';
        case 'blockquote':
            return 'blockquote';
        case 'code':
            return meta.preview === 'mermaid'
                ? 'mermaid'
                : meta.preview === 'vega-lite'
                  ? 'vega-lite'
                  : 'code';
        case 'callout':
            return meta.kind === 'info'
                ? 'callout-info'
                : meta.kind === 'warning'
                  ? 'callout-warning'
                  : 'callout-error';
        case 'recipe_ingredient':
            return 'recipe-ingredient';
        case 'table':
            return 'table';
        case 'kanban':
            return 'kanban';
        case 'poll':
            return meta.kind === 'rating'
                ? 'poll-rating'
                : meta.kind === 'children'
                  ? 'poll-children'
                  : meta.kind === 'matrix'
                    ? 'poll-matrix'
                    : 'poll-long';
        case 'image':
            return 'paragraph';
        case 'preview':
            return 'preview';
    }
};
