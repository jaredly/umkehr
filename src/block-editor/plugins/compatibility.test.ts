import {describe, expect, it} from 'vitest';

import {createBlockEditorRegistry} from './registry';
import {
    assertBlockEditorDocumentPluginsAvailable,
    blockEditorDocumentCompatibilityIssues,
    BlockEditorPluginLoadError,
} from './compatibility';
import type {BlockEditorPlugin} from './types';
import type {CachedState} from '../../block-crdt/types';

type TestMeta =
    | {type: 'paragraph'; ts: string}
    | {type: 'poll'; ts: string}
    | {type: 'card'; ts: string};

const emptyState = (): CachedState<TestMeta> => ({
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

const plugin = (input: BlockEditorPlugin<TestMeta>): BlockEditorPlugin<TestMeta> => input;

describe('block editor document plugin compatibility', () => {
    it('allows paragraph blocks without plugins', () => {
        const state = emptyState();
        state.state.blocks.p = {
            id: [1, 'a'],
            meta: {type: 'paragraph', ts: '1'},
            style: {},
            order: {id: [1, 'a'], path: [], index: [], ts: '1'},
        };

        const issues = blockEditorDocumentCompatibilityIssues(createBlockEditorRegistry<TestMeta>([]), {state});

        expect(issues).toEqual([]);
    });

    it('reports missing block, mark, embed, and selection plugins', () => {
        const state = emptyState();
        state.state.blocks.poll = {
            id: [1, 'a'],
            meta: {type: 'poll', ts: '1'},
            style: {},
            order: {id: [1, 'a'], path: [], index: [], ts: '1'},
        };
        state.state.marks.bold = {
            id: [2, 'a'],
            start: {id: [3, 'a'], at: 'before'},
            remove: false,
            type: 'bold',
            crossedSplits: [],
        };
        state.state.marks.date = {
            id: [4, 'a'],
            start: {id: [5, 'a'], at: 'before'},
            remove: false,
            type: 'embed',
            data: {type: 'date', value: '2026-06-28'},
            crossedSplits: [],
        };

        const issues = blockEditorDocumentCompatibilityIssues(createBlockEditorRegistry<TestMeta>([]), {
            state,
            selections: [{id: 'sel-1', selection: {type: 'table-cells'}}],
        });

        expect(issues).toEqual([
            {type: 'block', id: 'poll', blockType: 'poll'},
            {type: 'mark', id: 'bold', markType: 'bold'},
            {type: 'mark', id: 'date', markType: 'embed'},
            {type: 'inline-embed', id: 'date', embedType: 'date'},
            {type: 'selection', id: 'sel-1', selectionType: 'table-cells'},
        ]);
    });

    it('accepts document features declared by plugins', () => {
        const state = emptyState();
        state.state.blocks.poll = {
            id: [1, 'a'],
            meta: {type: 'poll', ts: '1'},
            style: {},
            order: {id: [1, 'a'], path: [], index: [], ts: '1'},
        };
        state.state.marks.bold = {
            id: [2, 'a'],
            start: {id: [3, 'a'], at: 'before'},
            remove: false,
            type: 'bold',
            crossedSplits: [],
        };
        state.state.marks.date = {
            id: [4, 'a'],
            start: {id: [5, 'a'], at: 'before'},
            remove: false,
            type: 'embed',
            data: {type: 'date', value: '2026-06-28'},
            crossedSplits: [],
        };

        const registry = createBlockEditorRegistry<TestMeta>([
            plugin({id: 'polls', blockTypes: [{id: 'poll'}]}),
            plugin({id: 'marks', marks: [{id: 'bold'}, {id: 'embed'}]}),
            plugin({id: 'date', inlineEmbeds: [{id: 'date'}]}),
            plugin({id: 'table', selectionTypes: [{id: 'table-cells'}]}),
        ]);

        expect(
            blockEditorDocumentCompatibilityIssues(registry, {
                state,
                selections: [{id: 'sel-1', selection: {type: 'table-cells'}}],
            }),
        ).toEqual([]);
    });

    it('throws a load error with actionable issue details', () => {
        const state = emptyState();
        state.state.blocks.card = {
            id: [1, 'a'],
            meta: {type: 'card', ts: '1'},
            style: {},
            order: {id: [1, 'a'], path: [], index: [], ts: '1'},
        };

        expect(() => assertBlockEditorDocumentPluginsAvailable(createBlockEditorRegistry<TestMeta>([]), {state}))
            .toThrow(BlockEditorPluginLoadError);
    });
});
