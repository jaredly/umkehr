/// <reference path="../optionalPreviewModules.d.ts" />

import {createElement} from 'react';

import type {RichBlockMeta} from '../blockMeta.js';
import {codePreviewRendererForMeta} from '../codePreviewRegistry.js';
import {CODE_MARK} from '../inlineMarks.js';
import {PreviewableCodeBlock} from '../mediaBlocks.js';

import type {BlockEditorPlugin} from './types.js';
import {declarationOptionPanel, simpleRichBlockTypeSpec} from './blockPluginUtils.js';
import {blockSlashCommand, toolbarItem} from './legacyRichTextUi.js';
import {bundledPluginStyle} from './pluginStyles.js';

let mermaidInitialized = false;
let mermaidLoadPromise: Promise<typeof import('mermaid')> | null = null;

const loadMermaid = () => {
    const testMermaid = (globalThis as {__umkehrTestMermaid?: typeof import('mermaid')['default']})
        .__umkehrTestMermaid;
    if (testMermaid) return Promise.resolve({default: testMermaid} as typeof import('mermaid'));
    mermaidLoadPromise ??= import('mermaid');
    return mermaidLoadPromise;
};

const ensureMermaidInitialized = async () => {
    const mermaid = await loadMermaid();
    if (mermaidInitialized) return mermaid.default;
    mermaid.default.initialize({startOnLoad: false, securityLevel: 'strict'});
    mermaidInitialized = true;
    return mermaid.default;
};

const parseJsonOrYaml = (source: string, parseYaml: (value: string) => unknown): unknown => {
    try {
        return JSON.parse(source);
    } catch {
        return parseYaml(source);
    }
};

const codeBlockRenderer = {
    id: 'render:code',
    blockType: 'code',
    render(node, context) {
        const meta = node.block.block.meta;
        if (meta.type !== 'code') return null;
        const editor = context.blocks.renderEditableBlock(node);
        const renderer = codePreviewRendererForMeta(context.registry, meta);
        if (!renderer) return editor;
        return createElement(PreviewableCodeBlock, {
            blockId: node.id,
            renderer,
            source: context.blocks.nodeText(node),
            editor,
        });
    },
} satisfies NonNullable<BlockEditorPlugin<RichBlockMeta>['blockRenderers']>[number];

export const codePlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'code',
    blockTypes: [
        simpleRichBlockTypeSpec<Extract<RichBlockMeta, {type: 'code'}>>(
            'code',
            (meta) =>
                typeof meta.language === 'string' &&
                (meta.preview === undefined || meta.preview === 'mermaid' || meta.preview === 'vega-lite'),
        ),
    ],
    marks: [{id: CODE_MARK, label: 'Code'}],
    blockRenderers: [codeBlockRenderer],
    inlineRenderers: [{id: 'render:code', markType: CODE_MARK, render: () => null}],
    optionPanels: [declarationOptionPanel('options:code', 'code')],
    toolbarItems: [
        toolbarItem('block-type:code', 'Block type', 'Code'),
        {id: 'mark:code', group: 'Inline marks', label: 'Code', commandId: 'mark:code', order: 6},
    ],
    slashCommands: [blockSlashCommand('code', 'Code', ['pre'])],
    styles: [bundledPluginStyle('code', 'code.css', 100)],
};

export const codeMermaidPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'code/mermaid',
    requires: ['code'],
    toolbarItems: [toolbarItem('block-type:mermaid', 'Block type', 'Mermaid diagram')],
    slashCommands: [blockSlashCommand('mermaid', 'Mermaid diagram', ['diagram', 'chart', 'flowchart', 'mermaid'])],
    codePreviewRenderers: [
        {
            id: 'code/mermaid:preview',
            languages: ['mermaid'],
            previewKind: 'mermaid',
            label: 'Mermaid diagram',
            emptyLabel: 'Empty diagram',
            loadingLabel: 'Rendering diagram...',
            errorLabel: 'Unable to render Mermaid diagram.',
            async render(source, renderId) {
                const mermaid = await ensureMermaidInitialized();
                const result = await mermaid.render(renderId, source);
                return {html: result.svg};
            },
        },
    ],
};

export const codeVegaPlugin: BlockEditorPlugin<RichBlockMeta> = {
    id: 'code/vega',
    requires: ['code'],
    toolbarItems: [toolbarItem('block-type:vega-lite', 'Block type', 'Vega-Lite chart')],
    slashCommands: [blockSlashCommand('vega-lite', 'Vega-Lite chart', ['chart', 'graph', 'vega', 'visualization'])],
    codePreviewRenderers: [
        {
            id: 'code/vega:preview',
            languages: ['vega-lite', 'vegalite'],
            previewKind: 'vega-lite',
            label: 'Vega-Lite chart',
            emptyLabel: 'Empty chart',
            loadingLabel: 'Rendering chart...',
            errorLabel: 'Unable to render Vega-Lite chart.',
            async render(source, renderId) {
                const [vegaLite, vega, yaml] = await Promise.all([
                    import('vega-lite'),
                    import('vega'),
                    import('yaml'),
                ]);
                const spec = parseJsonOrYaml(source, yaml.parse) as Parameters<typeof vegaLite.compile>[0];
                const compiled = vegaLite.compile(spec).spec;
                const view = new vega.View(vega.parse(compiled), {renderer: 'none'});
                const svg = await view.toSVG();
                await view.finalize();
                return {html: `<div id="${renderId}">${svg}</div>`};
            },
        },
    ],
};
