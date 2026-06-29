import {describe, expect, it} from 'vitest';

import type {CachedState} from '../../block-crdt/types';
import type {RichBlockMeta} from '../blockMeta';
import {blockTypeMenuValueFromRegistry, blockTypeMetaFromRegistry} from '../blockTypeHelpers';
import {markdownShortcutPrefixFromSpecs} from '../markdownShortcuts';
import {blockEditorDocumentCompatibilityIssues} from './compatibility';
import {createBlockEditorRegistry} from './registry';
import {
    calloutsPlugin,
    headingsPlugin,
    imagesPlugin,
    ingredientsPlugin,
    linkPreviewPlugin,
    listsPlugin,
    quotePlugin,
    todosPlugin,
} from './index';

const emptyState = (meta: RichBlockMeta): CachedState<RichBlockMeta> => ({
    state: {
        chars: {},
        blocks: {
            b1: {
                id: [1, 'a'],
                meta,
                style: {},
                order: {id: [1, 'a'], path: [], index: [], ts: '1'},
            },
        },
        marks: {},
        splits: {},
        joins: {},
        maxSeenCount: 0,
    },
    cache: {
        blockChildren: {},
        charContents: {},
        joinSentinels: {},
        joinedBlocks: {},
    },
});

describe('simple block plugins', () => {
    it('declare focused block metadata ownership', () => {
        const registry = createBlockEditorRegistry([
            headingsPlugin,
            listsPlugin,
            todosPlugin,
            quotePlugin,
            calloutsPlugin,
            ingredientsPlugin,
            imagesPlugin,
            linkPreviewPlugin,
        ]);

        expect([...registry.blockTypes.keys()]).toEqual(expect.arrayContaining([
            'heading',
            'list_item',
            'todo',
            'blockquote',
            'callout',
            'recipe_ingredient',
            'image',
            'preview',
        ]));
        expect(registry.blockTypes.size).toBe(8);
        expect(blockEditorDocumentCompatibilityIssues(registry, {state: emptyState({type: 'image', attachmentId: 'i1', size: 'medium', ts: '1'})})).toEqual([]);
        expect(blockEditorDocumentCompatibilityIssues(createBlockEditorRegistry([headingsPlugin]), {state: emptyState({type: 'image', attachmentId: 'i1', size: 'medium', ts: '1'})})).toHaveLength(1);
    });

    it('own block toolbar, slash, command, renderer, and option declarations', () => {
        const registry = createBlockEditorRegistry([
            headingsPlugin,
            listsPlugin,
            todosPlugin,
            quotePlugin,
            calloutsPlugin,
            ingredientsPlugin,
            imagesPlugin,
            linkPreviewPlugin,
        ]);

        expect(registry.toolbarItems.map((item) => item.id)).toEqual(
            expect.arrayContaining([
                'block-type:heading1',
                'block-type:ordered',
                'block-type:todo',
                'block-type:blockquote',
                'block-type:callout-warning',
                'block-type:recipe-ingredient',
                'image:upload',
                'block-type:preview',
            ]),
        );
        expect(registry.slashCommands.map((command) => command.commandId)).toEqual(
            expect.arrayContaining(['block-type:heading1', 'block-type:ordered', 'block-type:preview']),
        );
        expect([...registry.commands.keys()]).toEqual(
            expect.arrayContaining(['todo:toggle', 'callout:set-kind', 'image:upload', 'image:set-size', 'preview:set-url', 'preview:set-metadata']),
        );
        expect([...registry.blockRenderers.keys()]).toEqual(
            expect.arrayContaining([
                'heading',
                'list_item',
                'todo',
                'blockquote',
                'callout',
                'recipe_ingredient',
                'image',
                'preview',
            ]),
        );
        expect(registry.optionPanels.get('callout')?.map((panel) => panel.id)).toEqual(['options:callout']);
        expect(registry.optionPanels.get('image')?.map((panel) => panel.id)).toEqual(['options:image']);
        expect(registry.optionPanels.get('preview')?.map((panel) => panel.id)).toEqual(['options:preview']);
    });

    it('gates markdown shortcuts by registered plugin', () => {
        const headings = createBlockEditorRegistry([headingsPlugin]);
        const lists = createBlockEditorRegistry([listsPlugin]);
        const todos = createBlockEditorRegistry([todosPlugin]);
        const paragraph: RichBlockMeta = {type: 'paragraph', ts: '0'};

        expect(markdownShortcutPrefixFromSpecs(headings.markdownShortcuts, '## ', paragraph, () => '1')?.meta).toEqual({
            type: 'heading',
            level: 2,
            ts: '1',
        });
        expect(markdownShortcutPrefixFromSpecs(headings.markdownShortcuts, '- ', paragraph, () => '1')).toBeNull();
        expect(markdownShortcutPrefixFromSpecs(lists.markdownShortcuts, '1. ', paragraph, () => '2')?.meta).toEqual({
            type: 'list_item',
            kind: 'ordered',
            ts: '2',
        });
        expect(markdownShortcutPrefixFromSpecs(todos.markdownShortcuts, '[x] ', paragraph, () => '3')?.meta).toEqual({
            type: 'todo',
            checked: true,
            ts: '3',
        });
    });

    it('gates block type metadata factories by registry declarations', () => {
        const headings = createBlockEditorRegistry([headingsPlugin]);
        const paragraph: RichBlockMeta = {type: 'paragraph', ts: '0'};

        expect(blockTypeMetaFromRegistry(headings, 'heading3', paragraph, '1')).toEqual({
            type: 'heading',
            level: 3,
            ts: '1',
        });
        expect(blockTypeMetaFromRegistry(headings, 'todo', paragraph, '1')).toBeNull();
        expect(blockTypeMenuValueFromRegistry(headings, {type: 'todo', checked: false, ts: '1'})).toBe('paragraph');
    });
});
