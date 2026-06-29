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
            'heading',
            'list_item',
            'todo',
            'blockquote',
            'code',
            'callout',
            'recipe_ingredient',
            'table',
            'columns',
            'slide_deck',
            'slide',
            'poll',
            'image',
            'preview',
        ]);
    });

    it('allows current rich text metadata types during compatibility checks', () => {
        const registry = createBlockEditorRegistry([legacyRichTextBlocksPlugin]);
        const state = emptyState();
        const metas: RichBlockMeta[] = [
            {type: 'heading', level: 1, ts: '1'},
            {type: 'list_item', kind: 'ordered', ts: '1'},
            {type: 'todo', checked: false, ts: '1'},
            {type: 'blockquote', ts: '1'},
            {type: 'code', language: 'ts', ts: '1'},
            {type: 'callout', kind: 'info', ts: '1'},
            {type: 'recipe_ingredient', ts: '1'},
            {type: 'table', ts: '1'},
            {type: 'columns', display: 'blocks', ts: '1'},
            {type: 'slide_deck', width: 1920, height: 1080, footer: 'slide-number', ts: '1'},
            {type: 'slide', showTitle: true, transition: 'none', ts: '1'},
            {type: 'poll', kind: 'rating', allowChange: true, votes: {}, ts: '1'},
            {type: 'image', attachmentId: 'image-1', size: 'medium', ts: '1'},
            {type: 'preview', url: 'https://example.com', preview: null, ts: '1'},
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

    it('validates rich block metadata and rejects malformed metadata', () => {
        const registry = createBlockEditorRegistry([legacyRichTextBlocksPlugin]);

        expect(validateBlockEditorMeta(registry, {type: 'heading', level: 2, ts: '1'})).toBe(true);
        expect(validateBlockEditorMeta(registry, {type: 'heading', level: 4, ts: '1'})).toBe(false);
        expect(isLegacyRichBlockMeta({type: 'code', language: 'ts', preview: 'unknown', ts: '1'})).toBe(false);
    });

    it('updates timestamps through legacy block type specs', () => {
        const registry = createBlockEditorRegistry([legacyRichTextBlocksPlugin]);

        expect(blockEditorMetaWithTs(registry, {type: 'todo', checked: true, ts: '1'}, '2')).toEqual({
            type: 'todo',
            checked: true,
            ts: '2',
        });
    });
});
