import {describe, expect, it} from 'vitest';

import type {CachedState} from '../../block-crdt/types';
import type {RichBlockMeta} from '../blockMeta';
import {blockTypeMetaFromRegistry} from '../blockTypeHelpers';
import {blockEditorDocumentCompatibilityIssues} from './compatibility';
import {
    columnsPlugin,
    createBlockEditorRegistry,
    pollsPlugin,
    slidesPlugin,
    tablePlugin,
} from './index';
import {tableSelectionPluginBundle} from '../tableSelectionPlugin';

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

describe('structural block plugins', () => {
    it('declare structural ownership independently', () => {
        const registry = createBlockEditorRegistry([
            pollsPlugin,
            columnsPlugin,
            slidesPlugin,
            tableSelectionPluginBundle,
            tablePlugin,
        ]);

        expect([...registry.blockTypes.keys()]).toEqual(
            expect.arrayContaining(['poll', 'columns', 'slide_deck', 'slide', 'table']),
        );
        expect(registry.toolbarItems.map((item) => item.id)).toEqual(
            expect.arrayContaining([
                'block-type:poll-rating',
                'block-type:columns',
                'block-type:card-columns',
                'block-type:slide-deck',
                'block-type:slide',
                'block-type:table',
            ]),
        );
        expect([...registry.blockRenderers.keys()]).toEqual(
            expect.arrayContaining(['poll', 'columns', 'slide_deck', 'slide', 'table']),
        );
        expect(registry.optionPanels.get('poll')?.map((panel) => panel.id)).toEqual(['options:poll']);
        expect(registry.optionPanels.get('columns')?.map((panel) => panel.id)).toEqual(['options:columns']);
        expect(registry.optionPanels.get('slide_deck')?.map((panel) => panel.id)).toEqual(['options:slide-deck']);
        expect(registry.optionPanels.get('slide')?.map((panel) => panel.id)).toEqual(['options:slide']);
        expect([...registry.commands.keys()]).toEqual(
            expect.arrayContaining([
                'poll:vote',
                'columns:set-display',
                'slides:add-slide',
                'table:keyboard-navigation',
                'table:clipboard',
            ]),
        );
    });

    it('gates structural metadata compatibility by registered plugin', () => {
        const polls = createBlockEditorRegistry([pollsPlugin]);

        expect(blockEditorDocumentCompatibilityIssues(polls, {
            state: emptyState({type: 'poll', kind: 'rating', allowChange: true, votes: {}, ts: '1'}),
        })).toEqual([]);
        expect(blockEditorDocumentCompatibilityIssues(polls, {
            state: emptyState({type: 'columns', display: 'blocks', ts: '1'}),
        })).toEqual([{type: 'block', id: 'b1', blockType: 'columns'}]);
    });

    it('gates structural block type creation by plugin menu declarations', () => {
        const polls = createBlockEditorRegistry([pollsPlugin]);
        const tables = createBlockEditorRegistry([tableSelectionPluginBundle, tablePlugin]);
        const paragraph: RichBlockMeta = {type: 'paragraph', ts: '0'};

        expect(blockTypeMetaFromRegistry(polls, 'poll-long', paragraph, '1')).toEqual({
            type: 'poll',
            kind: 'long',
            allowChange: true,
            votes: {},
            ts: '1',
        });
        expect(blockTypeMetaFromRegistry(tables, 'table', paragraph, '1')).toEqual(paragraph);
        expect(blockTypeMetaFromRegistry(polls, 'table', paragraph, '1')).toBeNull();
    });

    it('keeps poll metadata merge behavior on the polls plugin', () => {
        const registry = createBlockEditorRegistry([pollsPlugin]);
        const current: RichBlockMeta = {
            type: 'poll',
            kind: 'rating',
            allowChange: true,
            votes: {alice: {type: 'single', optionId: '1', ts: '1'}},
            ts: '1',
        };
        const incoming: RichBlockMeta = {
            type: 'poll',
            kind: 'rating',
            allowChange: true,
            votes: {bob: {type: 'single', optionId: '2', ts: '2'}},
            ts: '2',
        };

        expect(registry.crdtConfig().mergeBlockMeta?.(current, incoming)).toEqual({
            ...incoming,
            votes: {
                alice: {type: 'single', optionId: '1', ts: '1'},
                bob: {type: 'single', optionId: '2', ts: '2'},
            },
        });
    });

    it('requires table selection for the table plugin', () => {
        expect(() => createBlockEditorRegistry([tablePlugin])).toThrow(
            'Plugin "table" requires "table-selection"',
        );
    });
});
