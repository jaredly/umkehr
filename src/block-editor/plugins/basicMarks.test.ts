import {describe, expect, it} from 'vitest';

import type {CachedState} from '../../block-crdt/types';
import type {RichBlockMeta} from '../blockMeta';

import {blockEditorDocumentCompatibilityIssues} from './compatibility';
import {basicMarkIds, basicMarksPlugin} from './basicMarks';
import {createBlockEditorRegistry} from './registry';

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

describe('basic marks plugin', () => {
    it('declares the basic boolean inline marks', () => {
        const registry = createBlockEditorRegistry([basicMarksPlugin]);

        expect(basicMarkIds).toEqual(['bold', 'italic', 'strikethrough', 'underline']);
        expect([...registry.marks.keys()]).toEqual(['bold', 'italic', 'strikethrough', 'underline']);
    });

    it('owns the basic mark toolbar items', () => {
        const registry = createBlockEditorRegistry([basicMarksPlugin]);

        expect(registry.toolbarItems.map((item) => [item.id, item.commandId])).toEqual([
            ['mark:bold', 'mark:bold'],
            ['mark:italic', 'mark:italic'],
            ['mark:strikethrough', 'mark:strikethrough'],
            ['mark:underline', 'mark:underline'],
        ]);
    });

    it('owns renderers for the basic inline marks', () => {
        const registry = createBlockEditorRegistry([basicMarksPlugin]);

        expect(registry.inlineRenderers.map((renderer) => [renderer.id, renderer.markType])).toEqual([
            ['render:bold', 'bold'],
            ['render:italic', 'italic'],
            ['render:strikethrough', 'strikethrough'],
            ['render:underline', 'underline'],
        ]);
    });

    it('covers compatibility checks for basic mark records', () => {
        const registry = createBlockEditorRegistry([basicMarksPlugin]);
        const state = emptyState();
        state.state.marks.underline = {
            id: [1, 'a'],
            start: {id: [1, 'a'], at: 'before'},
            end: {id: [2, 'a'], at: 'after'},
            remove: false,
            type: 'underline',
            crossedSplits: [],
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });
});
