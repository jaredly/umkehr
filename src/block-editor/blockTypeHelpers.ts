import type {FormattedBlock} from '../block-crdt/index.js';

import {
    defaultRatingPollMeta,
    defaultSlideDeckMeta,
    defaultSlideMeta,
    paragraphMeta,
    type RichBlockMeta,
} from './blockMeta';
import type {BlockTypeMenuValue} from './blockEditorTypes';
import type {BlockEditorRegistry} from './plugins/index.js';

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
        case 'columns':
        case 'card-columns':
            return current;
        case 'slide-deck':
            return defaultSlideDeckMeta(ts);
        case 'slide':
            return defaultSlideMeta(ts);
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

export const blockTypeMetaFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'blockTypes' | 'slashCommands' | 'toolbarItems'>,
    kind: BlockTypeMenuValue,
    current: RichBlockMeta,
    ts: string,
): RichBlockMeta | null => {
    if (!blockTypeCommandRegistered(registry, kind)) return null;
    const meta = blockTypeMeta(kind, current, ts);
    return meta.type === 'paragraph' || registry.blockTypes.has(meta.type) ? meta : null;
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
        case 'columns':
            return meta.display === 'cards' ? 'card-columns' : 'columns';
        case 'slide_deck':
            return 'slide-deck';
        case 'slide':
            return 'slide';
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

export const blockTypeMenuValueFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'blockTypes' | 'slashCommands' | 'toolbarItems'>,
    meta: RichBlockMeta | undefined,
): BlockTypeMenuValue => {
    const value = blockTypeMenuValue(meta);
    if (!meta || meta.type === 'paragraph') return value;
    if (!registry.blockTypes.has(meta.type)) return 'paragraph';
    return blockTypeCommandRegistered(registry, value) ? value : 'paragraph';
};

export const blockTypeMenuValuesFromRegistry = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'toolbarItems'>,
): BlockTypeMenuValue[] =>
    registry.toolbarItems
        .map((item) => blockTypeMenuValueFromCommandId(item.commandId))
        .filter((value): value is BlockTypeMenuValue => value !== null);

const blockTypeCommandRegistered = (
    registry: Pick<BlockEditorRegistry<RichBlockMeta>, 'slashCommands' | 'toolbarItems'>,
    kind: BlockTypeMenuValue,
): boolean => {
    if (kind === 'paragraph') return true;
    const commandId = `block-type:${kind}`;
    return (
        registry.toolbarItems.some((item) => item.commandId === commandId) ||
        registry.slashCommands.some((command) => command.commandId === commandId)
    );
};

const blockTypeMenuValueFromCommandId = (commandId: string | undefined): BlockTypeMenuValue | null => {
    if (!commandId?.startsWith('block-type:')) return null;
    const value = commandId.slice('block-type:'.length);
    return isBlockTypeMenuValue(value) ? value : null;
};

const BLOCK_TYPE_MENU_VALUES: ReadonlySet<string> = new Set([
    'paragraph',
    'heading1',
    'heading2',
    'heading3',
    'unordered',
    'ordered',
    'todo',
    'blockquote',
    'code',
    'mermaid',
    'vega-lite',
    'callout-info',
    'callout-warning',
    'callout-error',
    'recipe-ingredient',
    'table',
    'columns',
    'card-columns',
    'slide-deck',
    'slide',
    'preview',
    'poll-rating',
    'poll-children',
    'poll-matrix',
    'poll-long',
]);

const isBlockTypeMenuValue = (value: string): value is BlockTypeMenuValue =>
    BLOCK_TYPE_MENU_VALUES.has(value);
