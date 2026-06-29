import {describe, expect, it} from 'vitest';

import type {CachedState} from '../../block-crdt/types';
import type {RichBlockMeta} from '../blockMeta';
import {
    codeMetaWithPreviewForRegistry,
    codePreviewRendererForLanguage,
    isPreviewableCodeMetaFromRegistry,
} from '../codePreviewRegistry';
import {CODE_MARK} from '../inlineMarks';

import {blockEditorDocumentCompatibilityIssues} from './compatibility';
import {codeMermaidPlugin, codePlugin, codeVegaPlugin} from './code';
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
    it('declares code block, inline mark, renderer, toolbar, slash, and option ownership', () => {
        const registry = createBlockEditorRegistry([codePlugin]);

        expect(registry.blockTypes.has('code')).toBe(true);
        expect(registry.marks.has(CODE_MARK)).toBe(true);
        expect(registry.toolbarItems.map((item) => [item.id, item.commandId])).toEqual([
            ['mark:code', 'mark:code'],
            ['block-type:code', 'block-type:code'],
        ]);
        expect(registry.slashCommands.map((command) => [command.id, command.commandId])).toEqual([
            ['block-type:code', 'block-type:code'],
        ]);
        expect(registry.blockRenderers.get('code')?.id).toBe('render:code');
        expect(registry.optionPanels.get('code')?.map((panel) => panel.id)).toEqual(['options:code']);
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

    it('covers compatibility checks for code block metadata', () => {
        const registry = createBlockEditorRegistry([codePlugin]);
        const state = emptyState();
        state.state.blocks.code = {
            id: [1, 'a'],
            meta: {type: 'code', language: 'ts', ts: '1'},
            style: {},
            order: {id: [1, 'a'], path: [], index: [], ts: '1'},
        };

        expect(blockEditorDocumentCompatibilityIssues(registry, {state})).toEqual([]);
    });

    it('does not register preview renderers with the base code plugin alone', () => {
        const registry = createBlockEditorRegistry([codePlugin]);

        expect(registry.codePreviewRenderers.size).toBe(0);
        expect(registry.codePreviewRenderersByLanguage.size).toBe(0);
    });

    it('declares Mermaid preview renderer and requires code', () => {
        expect(() => createBlockEditorRegistry([codeMermaidPlugin])).toThrow(
            /requires "code"/,
        );

        const registry = createBlockEditorRegistry([codePlugin, codeMermaidPlugin]);

        expect(registry.codePreviewRenderers.get('code/mermaid:preview')?.previewKind).toBe('mermaid');
        expect(registry.codePreviewRenderersByLanguage.get('mermaid')?.id).toBe('code/mermaid:preview');
    });

    it('declares Vega-Lite preview renderer aliases and requires code', () => {
        expect(() => createBlockEditorRegistry([codeVegaPlugin])).toThrow(/requires "code"/);

        const registry = createBlockEditorRegistry([codePlugin, codeVegaPlugin]);

        expect(registry.codePreviewRenderers.get('code/vega:preview')?.previewKind).toBe('vega-lite');
        expect(registry.codePreviewRenderersByLanguage.get('vega-lite')?.id).toBe('code/vega:preview');
        expect(registry.codePreviewRenderersByLanguage.get('vegalite')?.id).toBe('code/vega:preview');
    });

    it('derives preview metadata support from registered preview renderers', () => {
        const codeOnly = createBlockEditorRegistry([codePlugin]);
        const withMermaid = createBlockEditorRegistry([codePlugin, codeMermaidPlugin]);
        const meta: Extract<RichBlockMeta, {type: 'code'}> = {
            type: 'code',
            language: 'mermaid',
            ts: '1',
        };

        expect(codePreviewRendererForLanguage(codeOnly, 'mermaid')).toBeNull();
        expect(codeMetaWithPreviewForRegistry(codeOnly, meta, true)).toEqual(meta);
        expect(isPreviewableCodeMetaFromRegistry(codeOnly, {...meta, preview: 'mermaid'})).toBe(false);

        expect(codePreviewRendererForLanguage(withMermaid, ' Mermaid ')?.previewKind).toBe('mermaid');
        expect(codeMetaWithPreviewForRegistry(withMermaid, meta, true)).toEqual({
            ...meta,
            preview: 'mermaid',
        });
        expect(isPreviewableCodeMetaFromRegistry(withMermaid, {...meta, preview: 'mermaid'})).toBe(true);
    });
});
