import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorMarkdownShortcutSpec, BlockEditorPlugin, BlockEditorToolbarItemSpec} from './types.js';
import {declarationBlockRenderer, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem, withOrder} from './legacyRichTextUi.js';

export const todoBlockTypeSpec = simpleRichBlockTypeSpec('todo', (meta) => typeof meta.checked === 'boolean');

export const todoToolbarItems: readonly BlockEditorToolbarItemSpec[] = withOrder([
    toolbarItem('block-type:todo', 'Block type', 'Todo'),
]);

export const todoMarkdownShortcuts: readonly BlockEditorMarkdownShortcutSpec<RichBlockMeta>[] = [
    {
        id: 'markdown:todo-open',
        match({text, currentMeta, nextTs}) {
            if (!canConvertMarkdownTodoShortcut(currentMeta) || !text.startsWith('[ ] ')) return null;
            return {
                length: 4,
                meta: {type: 'todo', checked: false, ts: nextTs()},
                kind: 'todo',
            };
        },
    },
    {
        id: 'markdown:todo-checked',
        match({text, currentMeta, nextTs}) {
            if (
                !canConvertMarkdownTodoShortcut(currentMeta) ||
                (!text.startsWith('[x] ') && !text.startsWith('[X] '))
            ) {
                return null;
            }
            return {
                length: 4,
                meta: {type: 'todo', checked: true, ts: nextTs()},
                kind: 'todo',
            };
        },
    },
];

export const todosPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'todos',
    blockTypes: [todoBlockTypeSpec],
    toolbarItems: todoToolbarItems,
    slashCommands: withOrder([blockSlashCommand('todo', 'Todo', ['task', 'checkbox'])]),
    markdownShortcuts: todoMarkdownShortcuts,
    commands: [{id: 'todo:toggle', handle: () => undefined}],
    blockRenderers: [declarationBlockRenderer('render:todo', 'todo')],
    optionPanels: [{id: 'options:todo', blockType: 'todo', render: () => null}],
};

const canConvertMarkdownTodoShortcut = (meta: RichBlockMeta): boolean =>
    meta.type === 'paragraph' || (meta.type === 'list_item' && meta.kind === 'unordered');
