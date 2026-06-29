import type {BlockTypeMenuValue} from '../blockEditorTypes.js';
import type {RichBlockMeta} from '../blockMeta.js';
import {legacyMarkdownShortcutSpecs} from '../markdownShortcuts.js';
import type {
    BlockEditorPlugin,
    BlockEditorSlashCommandSpec,
    BlockEditorToolbarItemSpec,
} from './types.js';

export type LegacyBlockTypeMenuItem = {
    value: BlockTypeMenuValue;
    label: string;
};

function blockSlashCommand(
    value: BlockTypeMenuValue,
    label: string,
    keywords: string[],
): BlockEditorSlashCommandSpec {
    return {
        id: `block-type:${value}`,
        label,
        group: 'Block type',
        keywords,
        commandId: `block-type:${value}`,
    };
}

function toolbarItem(
    id: string,
    group: string,
    label: string,
    commandId = id,
): BlockEditorToolbarItemSpec {
    return {
        id,
        group,
        label,
        commandId,
    };
}

function withOrder<Item extends {order?: number}>(items: readonly Item[]): readonly Item[] {
    return items.map((item, order) => ({...item, order}));
}

export const legacyBlockTypeMenuItems: readonly LegacyBlockTypeMenuItem[] = [
    {value: 'paragraph', label: 'Paragraph'},
    {value: 'heading1', label: 'Heading 1'},
    {value: 'heading2', label: 'Heading 2'},
    {value: 'heading3', label: 'Heading 3'},
    {value: 'unordered', label: 'Bulleted list'},
    {value: 'ordered', label: 'Numbered list'},
    {value: 'todo', label: 'Todo'},
    {value: 'blockquote', label: 'Quote'},
    {value: 'code', label: 'Code'},
    {value: 'mermaid', label: 'Mermaid diagram'},
    {value: 'vega-lite', label: 'Vega-Lite chart'},
    {value: 'callout-info', label: 'Info callout'},
    {value: 'callout-warning', label: 'Warning callout'},
    {value: 'callout-error', label: 'Error callout'},
    {value: 'recipe-ingredient', label: 'Ingredient line'},
    {value: 'table', label: 'Table'},
    {value: 'columns', label: 'Columns'},
    {value: 'card-columns', label: 'Card columns'},
    {value: 'slide-deck', label: 'Slide deck'},
    {value: 'slide', label: 'Slide'},
    {value: 'preview', label: 'Preview'},
    {value: 'poll-rating', label: 'Rating poll'},
    {value: 'poll-children', label: 'Answer poll'},
    {value: 'poll-matrix', label: 'Matrix poll'},
    {value: 'poll-long', label: 'Long-answer poll'},
];

export const legacySlashCommandSpecs: readonly BlockEditorSlashCommandSpec[] = withOrder([
    blockSlashCommand('paragraph', 'Paragraph', ['text']),
    blockSlashCommand('heading1', 'Heading 1', ['h1', 'title']),
    blockSlashCommand('heading2', 'Heading 2', ['h2', 'subtitle']),
    blockSlashCommand('heading3', 'Heading 3', ['h3']),
    blockSlashCommand('unordered', 'Bulleted list', ['bullet', 'unordered']),
    blockSlashCommand('ordered', 'Numbered list', ['number', 'ordered']),
    blockSlashCommand('todo', 'Todo', ['task', 'checkbox']),
    blockSlashCommand('blockquote', 'Blockquote', ['quote']),
    blockSlashCommand('code', 'Code', ['pre']),
    blockSlashCommand('mermaid', 'Mermaid diagram', ['diagram', 'chart', 'flowchart', 'mermaid']),
    blockSlashCommand('vega-lite', 'Vega-Lite chart', ['chart', 'graph', 'vega', 'visualization']),
    blockSlashCommand('callout-info', 'Info callout', ['info']),
    blockSlashCommand('callout-warning', 'Warning callout', ['warning']),
    blockSlashCommand('callout-error', 'Error callout', ['error']),
    blockSlashCommand('recipe-ingredient', 'Ingredient', ['ingredient', 'recipe', 'food', 'line']),
    blockSlashCommand('table', 'Table', ['grid']),
    blockSlashCommand('columns', 'Columns', ['columns', 'layout']),
    blockSlashCommand('card-columns', 'Card columns', ['board', 'cards', 'columns']),
    blockSlashCommand('slide-deck', 'Slide deck', ['presentation', 'deck', 'slides']),
    blockSlashCommand('slide', 'Slide', ['presentation', 'deck']),
    blockSlashCommand('preview', 'Preview', ['link', 'card', 'url']),
]);

export const legacyToolbarItemSpecs: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('history:undo', 'History', 'Undo'),
    toolbarItem('history:redo', 'History', 'Redo'),
    toolbarItem('mark:code', 'Inline marks', 'Code'),
    toolbarItem('image:upload', 'Inline marks', 'Image'),
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
    markdownShortcuts: legacyMarkdownShortcutSpecs,
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

const blockTypeValueFromCommandId = (commandId: string | undefined): BlockTypeMenuValue | null => {
    if (!commandId?.startsWith('block-type:')) return null;
    const value = commandId.slice('block-type:'.length);
    return isBlockTypeMenuValue(value) ? value : null;
};

const BLOCK_TYPE_MENU_VALUES = new Set<string>(legacyBlockTypeMenuItems.map((item) => item.value));

const isBlockTypeMenuValue = (value: string): value is BlockTypeMenuValue =>
    BLOCK_TYPE_MENU_VALUES.has(value);
