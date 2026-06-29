import {describe, expect, it} from 'vitest';

import type {CachedState} from '../../block-crdt/types';
import type {RichBlockMeta} from '../blockMeta';
import {createBlockEditorRegistry} from './registry';
import {
    isLegacyRichBlockMeta,
    legacyRichTextBlocksPlugin,
    legacyRichTextBlockTypeIds,
} from './legacyRichTextBlocks';
import {
    blockEditorDocumentCompatibilityIssues,
} from './compatibility';
import {blockEditorMetaWithTs, validateBlockEditorMeta} from './metadata';

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

describe('legacy rich text block plugin', () => {
    it('declares every non-core rich text block metadata type', () => {
        expect(legacyRichTextBlockTypeIds).toEqual([
            'code',
            'table',
            'columns',
            'slide_deck',
            'slide',
            'poll',
        ]);
    });

    it('allows remaining transitional rich text metadata types during compatibility checks', () => {
        const registry = createBlockEditorRegistry([legacyRichTextBlocksPlugin]);
        const state = emptyState();
        const metas: RichBlockMeta[] = [
            {type: 'code', language: 'ts', ts: '1'},
            {type: 'table', ts: '1'},
            {type: 'columns', display: 'blocks', ts: '1'},
            {type: 'slide_deck', width: 1920, height: 1080, footer: 'slide-number', ts: '1'},
            {type: 'slide', showTitle: true, transition: 'none', ts: '1'},
            {type: 'poll', kind: 'rating', allowChange: true, votes: {}, ts: '1'},
        ];
        for (const [index, meta] of metas.entries()) {
            state.state.blocks[`b${index}`] = {
                id: [index + 1, 'a'],
                meta,
                style: {},
                order: {id: [index + 1, 'a'], path: [], index: [], ts: '1'},
            };
        }

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });

    it('declares the transitional table cell selection type', () => {
        const registry = createBlockEditorRegistry([legacyRichTextBlocksPlugin]);
        const state = emptyState();

        expect(
            blockEditorDocumentCompatibilityIssues(registry, {
                state,
                selections: [{id: 'sel-1', selection: {type: 'table-cells'}}],
            }),
        ).toEqual([]);
    });

    it('validates rich block metadata and rejects malformed metadata', () => {
        const registry = createBlockEditorRegistry([legacyRichTextBlocksPlugin]);

        expect(validateBlockEditorMeta(registry, {type: 'code', language: 'ts', ts: '1'})).toBe(true);
        expect(validateBlockEditorMeta(registry, {type: 'heading', level: 2, ts: '1'})).toBe(false);
        expect(validateBlockEditorMeta(registry, {type: 'heading', level: 4, ts: '1'})).toBe(false);
        expect(isLegacyRichBlockMeta({type: 'code', language: 'ts', preview: 'unknown', ts: '1'})).toBe(false);
    });

    it('updates timestamps through legacy block type specs', () => {
        const registry = createBlockEditorRegistry([legacyRichTextBlocksPlugin]);

        expect(blockEditorMetaWithTs(registry, {type: 'code', language: 'ts', ts: '1'}, '2')).toEqual({
            type: 'code',
            language: 'ts',
            ts: '2',
        });
    });
});
