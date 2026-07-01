import {describe, expect, it} from 'vitest';

import {createBlockEditorRegistry} from './plugins/registry';
import {blockEditorDocumentCompatibilityIssues} from './plugins/compatibility';
import {
    blockEditorCrdtConfigFromRegistry,
    legacyRichTextCrdtPlugins,
    legacyRichTextCrdtRegistry,
    legacyStructuralCrdtPlugin,
    richTextCrdtConfig,
} from './editorCrdtConfig';
import type {CachedState} from '../block-crdt/types';
import type {RichBlockMeta} from './blockMeta';
import {annotationsPlugin} from './plugins/annotations';

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

describe('richTextCrdtConfig', () => {
    it('is backed by the legacy rich-text CRDT plugin registry', () => {
        const state = emptyState();
        const config = richTextCrdtConfig(state);

        expect(config.markBehavior).toEqual({annotation: 'stacking'});
        expect(config.virtualParents?.({
            id: [1, 'a'],
            meta: {type: 'table', ts: '1'},
            style: {},
            order: {id: [1, 'a'], path: [], index: [], ts: '1'},
        })).toEqual([]);
        expect(config.markVirtualParents?.({
            id: [2, 'a'],
            start: {id: [3, 'a'], at: 'before'},
            remove: false,
            type: 'annotation',
            data: {id: [4, 'a'], presentation: 'sidebar'},
            crossedSplits: [],
        })).toEqual([[4, 'a']]);
    });

    it('preserves poll metadata merge behavior through the registry', () => {
        const config = richTextCrdtConfig(emptyState());
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

        expect(config.mergeBlockMeta?.(current, incoming)).toEqual({
            ...incoming,
            votes: {
                alice: {type: 'single', optionId: '1', ts: '1'},
                bob: {type: 'single', optionId: '2', ts: '2'},
            },
        });
    });

    it('can build a CRDT config from an explicit registry', () => {
        const registry = createBlockEditorRegistry(legacyRichTextCrdtPlugins);

        expect(blockEditorCrdtConfigFromRegistry(registry).markBehavior).toEqual(
            legacyRichTextCrdtRegistry.crdtConfig().markBehavior,
        );
    });

    it('keeps annotation CRDT hooks separate from transitional structural virtual parents', () => {
        const annotationsRegistry = createBlockEditorRegistry([annotationsPlugin]);
        const structuralRegistry = createBlockEditorRegistry([legacyStructuralCrdtPlugin]);

        expect(annotationsRegistry.crdtConfig().markBehavior).toEqual({annotation: 'stacking'});
        expect(annotationsRegistry.crdtConfig().virtualParents).toBeUndefined();
        expect(structuralRegistry.crdtConfig().markBehavior).toBeUndefined();
        expect(structuralRegistry.crdtConfig().virtualParents).toBeUndefined();
    });

    it('declares annotation mark compatibility through the legacy annotations plugin', () => {
        const registry = createBlockEditorRegistry(legacyRichTextCrdtPlugins);
        const state = emptyState();
        state.state.marks.annotation = {
            id: [1, 'a'],
            start: {id: [2, 'a'], at: 'before'},
            end: {id: [3, 'a'], at: 'after'},
            remove: false,
            type: 'annotation',
            data: {id: [4, 'a'], presentation: 'sidebar'},
            crossedSplits: [],
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });

    it('allows richTextCrdtConfig callers to provide a registry', () => {
        const registry = createBlockEditorRegistry<RichBlockMeta>([]);

        expect(richTextCrdtConfig(emptyState(), registry)).toEqual({});
    });
});
