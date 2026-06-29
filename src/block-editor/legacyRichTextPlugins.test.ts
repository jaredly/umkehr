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
            'legacy-rich-text-blocks',
            'legacy-rich-text-ui',
            'polls',
        ]);
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
});
