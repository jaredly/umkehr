import {describe, expect, it} from 'vitest';

import type {CachedState} from '../../block-crdt/types';
import type {RichBlockMeta} from '../blockMeta';
import {INLINE_EMBED_MARK} from '../inlineEmbeds';
import {LINK_MARK, MATH_MARK} from '../inlineMarks';

import {blockEditorDocumentCompatibilityIssues} from './compatibility';
import {createBlockEditorRegistry} from './registry';
import {inlineDatePlugin} from './inlineDate';
import {linksPlugin} from './links';
import {mathPlugin} from './math';

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

describe('inline feature plugins', () => {
    it('declares link, math, and date embed compatibility surfaces', () => {
        const registry = createBlockEditorRegistry([linksPlugin, mathPlugin, inlineDatePlugin]);

        expect(registry.marks.has(LINK_MARK)).toBe(true);
        expect(registry.marks.has(MATH_MARK)).toBe(true);
        expect(registry.marks.has(INLINE_EMBED_MARK)).toBe(true);
        expect(registry.inlineEmbeds.has('date')).toBe(true);
    });

    it('owns inline toolbar and slash entries for these features', () => {
        const registry = createBlockEditorRegistry([linksPlugin, mathPlugin, inlineDatePlugin]);

        expect(registry.toolbarItems.map((item) => [item.id, item.commandId])).toEqual([
            ['mark:math', 'mark:math'],
            ['mark:display-math', 'mark:display-math'],
            ['link:edit', 'link:edit'],
            ['inline-embed:date', 'inline-embed:date'],
        ]);
        expect(registry.slashCommands.map((command) => [command.id, command.commandId])).toEqual([
            ['inline-embed:date', 'inline-embed:date'],
        ]);
    });

    it('owns inline renderers for link, math, and date embeds', () => {
        const registry = createBlockEditorRegistry([linksPlugin, mathPlugin, inlineDatePlugin]);

        expect(registry.inlineRenderers.map((renderer) => [renderer.id, renderer.markType, renderer.embedType])).toEqual([
            ['render:inline-date', INLINE_EMBED_MARK, 'date'],
            ['render:link', LINK_MARK, undefined],
            ['render:math', MATH_MARK, undefined],
        ]);
    });

    it('covers compatibility checks for link, math, and date embed records', () => {
        const registry = createBlockEditorRegistry([linksPlugin, mathPlugin, inlineDatePlugin]);
        const state = emptyState();
        state.state.marks.link = {
            id: [1, 'a'],
            start: {id: [1, 'a'], at: 'before'},
            end: {id: [2, 'a'], at: 'after'},
            remove: false,
            type: LINK_MARK,
            data: 'https://example.com',
            crossedSplits: [],
        };
        state.state.marks.math = {
            id: [2, 'a'],
            start: {id: [3, 'a'], at: 'before'},
            end: {id: [4, 'a'], at: 'after'},
            remove: false,
            type: MATH_MARK,
            data: true,
            crossedSplits: [],
        };
        state.state.marks.date = {
            id: [3, 'a'],
            start: {id: [5, 'a'], at: 'before'},
            end: {id: [5, 'a'], at: 'after'},
            remove: false,
            type: INLINE_EMBED_MARK,
            data: {type: 'date', value: '2026-06-28'},
            crossedSplits: [],
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });
});
