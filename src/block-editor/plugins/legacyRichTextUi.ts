import type {BlockTypeMenuValue} from '../blockEditorTypes.js';
import type {RichBlockMeta} from '../blockMeta.js';
import type {
    BlockEditorPlugin,
    BlockEditorSlashCommandSpec,
    BlockEditorToolbarItemSpec,
} from './types.js';

export type LegacyBlockTypeMenuItem = {
    value: BlockTypeMenuValue;
    label: string;
};

const BLOCK_TYPE_MENU_ORDER: Record<BlockTypeMenuValue, number> = {
    paragraph: 0,
    heading1: 1,
    heading2: 2,
    heading3: 3,
    unordered: 4,
    ordered: 5,
    todo: 6,
    blockquote: 7,
    code: 8,
    mermaid: 9,
    'vega-lite': 10,
    'callout-info': 11,
    'callout-warning': 12,
    'callout-error': 13,
    'recipe-ingredient': 14,
    table: 15,
    columns: 16,
    'card-columns': 17,
    'slide-deck': 18,
    slide: 19,
    preview: 20,
    'poll-rating': 21,
    'poll-children': 22,
    'poll-matrix': 23,
    'poll-long': 24,
};

export function blockSlashCommand(
    value: BlockTypeMenuValue,
    label: string,
    keywords: string[],
): BlockEditorSlashCommandSpec {
    return {
        id: `block-type:${value}`,
        label,
        group: 'Block type',
        keywords,
        order: BLOCK_TYPE_MENU_ORDER[value],
        commandId: `block-type:${value}`,
    };
}

export function toolbarItem(
    id: string,
    group: string,
    label: string,
    commandId = id,
): BlockEditorToolbarItemSpec {
    const blockValue = blockTypeValueFromCommandId(commandId);
    return {
        id,
        group,
        label,
        ...(blockValue === null ? {} : {order: BLOCK_TYPE_MENU_ORDER[blockValue]}),
        commandId,
    };
}

export function withOrder<Item extends {order?: number}>(items: readonly Item[]): readonly Item[] {
    return items.map((item, order) => ({...item, order: item.order ?? order}));
}

export const legacyBlockTypeMenuItems: readonly LegacyBlockTypeMenuItem[] = [
    {value: 'paragraph', label: 'Paragraph'},
    {value: 'code', label: 'Code'},
    {value: 'mermaid', label: 'Mermaid diagram'},
    {value: 'vega-lite', label: 'Vega-Lite chart'},
    {value: 'table', label: 'Table'},
    {value: 'columns', label: 'Columns'},
    {value: 'card-columns', label: 'Card columns'},
    {value: 'slide-deck', label: 'Slide deck'},
    {value: 'slide', label: 'Slide'},
    {value: 'poll-rating', label: 'Rating poll'},
    {value: 'poll-children', label: 'Answer poll'},
    {value: 'poll-matrix', label: 'Matrix poll'},
    {value: 'poll-long', label: 'Long-answer poll'},
];

export const legacySlashCommandSpecs: readonly BlockEditorSlashCommandSpec[] = withOrder([
    blockSlashCommand('paragraph', 'Paragraph', ['text']),
    blockSlashCommand('code', 'Code', ['pre']),
    blockSlashCommand('mermaid', 'Mermaid diagram', ['diagram', 'chart', 'flowchart', 'mermaid']),
    blockSlashCommand('vega-lite', 'Vega-Lite chart', ['chart', 'graph', 'vega', 'visualization']),
    blockSlashCommand('table', 'Table', ['grid']),
    blockSlashCommand('columns', 'Columns', ['columns', 'layout']),
    blockSlashCommand('card-columns', 'Card columns', ['board', 'cards', 'columns']),
    blockSlashCommand('slide-deck', 'Slide deck', ['presentation', 'deck', 'slides']),
    blockSlashCommand('slide', 'Slide', ['presentation', 'deck']),
]);

export const legacyToolbarItemSpecs: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('history:undo', 'History', 'Undo'),
    toolbarItem('history:redo', 'History', 'Redo'),
    toolbarItem('annotation:sidebar', 'Annotations', 'Comment'),
    toolbarItem('annotation:footnote', 'Annotations', 'Footnote'),
    toolbarItem('annotation:popover', 'Annotations', 'Popover'),
    ...legacyBlockTypeMenuItems.map((item) =>
        toolbarItem(`block-type:${item.value}`, 'Block type', item.label, `block-type:${item.value}`),
    ),
]);

export const legacyRichTextUiPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'legacy-rich-text-ui',
    toolbarItems: legacyToolbarItemSpecs,
    slashCommands: legacySlashCommandSpecs,
};

export const blockTypeMenuItemsFromToolbarSpecs = (
    specs: readonly BlockEditorToolbarItemSpec[],
): LegacyBlockTypeMenuItem[] =>
    specs.flatMap((spec) => {
        const value = blockTypeValueFromCommandId(spec.commandId);
        return value && spec.label ? [{value, label: spec.label}] : [];
    });

export const legacyBlockTypeMenuItemsFromToolbarSpecs = (): LegacyBlockTypeMenuItem[] =>
    blockTypeMenuItemsFromToolbarSpecs(legacyToolbarItemSpecs);

function blockTypeValueFromCommandId(commandId: string | undefined): BlockTypeMenuValue | null {
    if (!commandId?.startsWith('block-type:')) return null;
    const value = commandId.slice('block-type:'.length);
    return isBlockTypeMenuValue(value) ? value : null;
}

function isBlockTypeMenuValue(value: string): value is BlockTypeMenuValue {
    return value in BLOCK_TYPE_MENU_ORDER;
}
