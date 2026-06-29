import {describe, expect, it} from 'vitest';

import type {CachedState} from '../../block-crdt/types';
import type {RichBlockMeta} from '../blockMeta';
import {CODE_MARK} from '../inlineMarks';

import {blockEditorDocumentCompatibilityIssues} from './compatibility';
import {codePlugin} from './code';
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

describe('code plugin', () => {
    it('declares inline code mark and toolbar ownership', () => {
        const registry = createBlockEditorRegistry([codePlugin]);

        expect(registry.marks.has(CODE_MARK)).toBe(true);
        expect(registry.toolbarItems.map((item) => [item.id, item.commandId])).toEqual([
            ['mark:code', 'mark:code'],
        ]);
        expect(registry.inlineRenderers.map((renderer) => [renderer.id, renderer.markType])).toEqual([
            ['render:code', CODE_MARK],
        ]);
    });

    it('covers compatibility checks for inline code mark records', () => {
        const registry = createBlockEditorRegistry([codePlugin]);
        const state = emptyState();
        state.state.marks.code = {
            id: [1, 'a'],
            start: {id: [1, 'a'], at: 'before'},
            end: {id: [2, 'a'], at: 'after'},
            remove: false,
            type: CODE_MARK,
            data: 'ts',
            crossedSplits: [],
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });
});
