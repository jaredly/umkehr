import {describe, expect, it} from 'vitest';

import type {CachedState} from '../block-crdt/types';
import {createBlockEditorRegistry} from './plugins/registry';
import {blockEditorDocumentCompatibilityIssues} from './plugins/compatibility';
import {legacyRichTextPlugins} from './legacyRichTextPlugins';
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

describe('legacyRichTextPlugins', () => {
    it('builds a conflict-free registry for current rich-text features', () => {
        const registry = createBlockEditorRegistry(legacyRichTextPlugins);

        expect(registry.plugins.map((plugin) => plugin.id)).toEqual([
            'annotations',
            'basic-marks',
            'callouts',
            'code',
            'headings',
            'images',
            'ingredients',
            'inline-date',
            'legacy-rich-text-blocks',
            'legacy-rich-text-ui',
            'legacy-structural-crdt',
            'link-preview',
            'links',
            'lists',
            'math',
            'polls',
            'quote',
            'todos',
        ]);
        expect(registry.marks.has('bold')).toBe(true);
        expect(registry.marks.has('underline')).toBe(true);
        expect(registry.blockTypes.has('heading')).toBe(true);
        expect(registry.blockTypes.has('image')).toBe(true);
        expect(registry.blockTypes.has('preview')).toBe(true);
        expect(registry.blockTypes.has('poll')).toBe(true);
        expect(registry.slashCommands.length).toBeGreaterThan(0);
        expect(registry.crdtConfig().markBehavior).toEqual({annotation: 'stacking'});
    });

    it('declares metadata support for non-core current rich-text blocks', () => {
        const registry = createBlockEditorRegistry(legacyRichTextPlugins);
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
        const registry = createBlockEditorRegistry(legacyRichTextPlugins);
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
