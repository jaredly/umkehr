import {describe, expect, it} from 'vitest';

import type {CachedState} from '../block-crdt/types';
import {createBlockEditorRegistry} from './plugins/registry';
import {blockEditorDocumentCompatibilityIssues} from './plugins/compatibility';
import {defaultBlockEditorPlugins} from './defaultBlockEditorPlugins';
import type {RichBlockMeta} from './blockMeta';

const emptyState = (): CachedState<RichBlockMeta> => ({
    state: {
        chars: {},
        blocks: {},
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

describe('defaultBlockEditorPlugins', () => {
    it('builds a conflict-free registry for current rich-text features', () => {
        const registry = createBlockEditorRegistry(defaultBlockEditorPlugins);

        expect(registry.plugins.map((plugin) => plugin.id)).toEqual([
            'annotations',
            'basic-marks',
            'callouts',
            'code',
            'code/mermaid',
            'code/vega',
            'columns',
            'headings',
            'images',
            'ingredients',
            'inline-date',
            'legacy-rich-text-blocks',
            'legacy-rich-text-ui',
            'link-preview',
            'links',
            'lists',
            'math',
            'polls',
            'quote',
            'slides',
            'table-selection',
            'table',
            'todos',
        ]);
        expect(registry.marks.has('bold')).toBe(true);
        expect(registry.marks.has('underline')).toBe(true);
        expect(registry.blockTypes.has('heading')).toBe(true);
        expect(registry.blockTypes.has('code')).toBe(true);
        expect(registry.blockTypes.has('image')).toBe(true);
        expect(registry.blockTypes.has('preview')).toBe(true);
        expect(registry.blockTypes.has('poll')).toBe(true);
        expect(registry.blockTypes.has('columns')).toBe(true);
        expect(registry.blockTypes.has('slide_deck')).toBe(true);
        expect(registry.blockTypes.has('table')).toBe(true);
        expect(registry.slashCommands.length).toBeGreaterThan(0);
        expect(registry.selectionTypes.has('table-cells')).toBe(true);
        expect(registry.selectionPlugins.has('table-cells')).toBe(true);
        expect(registry.crdtConfig().markBehavior).toEqual({annotation: 'stacking'});
        expect(registry.styles.map((style) => style.id)).toEqual([
            'basic-marks:styles',
            'links:styles',
            'math:styles',
            'inline-date:styles',
            'headings:styles',
            'lists:styles',
            'todos:styles',
            'quote:styles',
            'callouts:styles',
            'code:styles',
            'ingredients:styles',
            'images:styles',
            'link-preview:styles',
            'annotations:styles',
            'polls:styles',
            'columns:styles',
            'slides:styles',
            'table:styles',
            'legacy-rich-text-ui:styles',
            'legacy-rich-text-blocks:styles',
        ]);
        expect(registry.styles.map((style) => style.pluginId)).toEqual([
            'basic-marks',
            'links',
            'math',
            'inline-date',
            'headings',
            'lists',
            'todos',
            'quote',
            'callouts',
            'code',
            'ingredients',
            'images',
            'link-preview',
            'annotations',
            'polls',
            'columns',
            'slides',
            'table',
            'legacy-rich-text-ui',
            'legacy-rich-text-blocks',
        ]);
    });

    it('declares metadata support for non-core current rich-text blocks', () => {
        const registry = createBlockEditorRegistry(defaultBlockEditorPlugins);
        const state = emptyState();
        state.state.blocks.poll = {
            id: [1, 'a'],
            meta: {type: 'poll', kind: 'rating', allowChange: true, votes: {}, ts: '1'},
            style: {},
            order: {id: [1, 'a'], path: [], index: [], ts: '1'},
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });

    it('declares metadata support for basic inline marks', () => {
        const registry = createBlockEditorRegistry(defaultBlockEditorPlugins);
        const state = emptyState();
        state.state.marks.bold = {
            id: [1, 'a'],
            start: {id: [1, 'a'], at: 'before'},
            end: {id: [2, 'a'], at: 'after'},
            remove: false,
            type: 'bold',
            crossedSplits: [],
        };
        state.state.marks.underline = {
            id: [2, 'a'],
            start: {id: [1, 'a'], at: 'before'},
            end: {id: [2, 'a'], at: 'after'},
            remove: false,
            type: 'underline',
            crossedSplits: [],
        };
        state.state.marks.link = {
            id: [3, 'a'],
            start: {id: [3, 'a'], at: 'before'},
            end: {id: [4, 'a'], at: 'after'},
            remove: false,
            type: 'link',
            data: 'https://example.com',
            crossedSplits: [],
        };
        state.state.marks.math = {
            id: [4, 'a'],
            start: {id: [5, 'a'], at: 'before'},
            end: {id: [6, 'a'], at: 'after'},
            remove: false,
            type: 'math',
            data: true,
            crossedSplits: [],
        };
        state.state.marks.date = {
            id: [5, 'a'],
            start: {id: [7, 'a'], at: 'before'},
            end: {id: [7, 'a'], at: 'after'},
            remove: false,
            type: 'embed',
            data: {type: 'date', value: '2026-06-28'},
            crossedSplits: [],
        };
        state.state.marks.code = {
            id: [6, 'a'],
            start: {id: [8, 'a'], at: 'before'},
            end: {id: [9, 'a'], at: 'after'},
            remove: false,
            type: 'code',
            data: 'ts',
            crossedSplits: [],
        };
        state.state.marks.annotation = {
            id: [7, 'a'],
            start: {id: [10, 'a'], at: 'before'},
            end: {id: [11, 'a'], at: 'after'},
            remove: false,
            type: 'annotation',
            data: {id: [12, 'a'], presentation: 'sidebar'},
            crossedSplits: [],
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });
});
