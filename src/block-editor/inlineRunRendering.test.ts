import {describe, expect, it} from 'vitest';

import type {CachedState, FormattedBlock} from '../block-crdt/index';

import type {RichBlockMeta} from './blockMeta';
import type {PendingInlineMarks} from './blockEditorTypes';
import {createBlockEditorRegistry} from './plugins/registry';
import {basicMarksPlugin} from './plugins/basicMarks';
import {codePlugin} from './plugins/code';
import {
    activeInlineMarkTypesFromRegistry,
    deriveActiveInlineMarks,
} from './inlineRunRendering';

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

const formattedBlock = (marks: Record<string, unknown>): FormattedBlock<RichBlockMeta> => ({
    id: 'block-1',
    block: {
        id: [1, 'a'],
        meta: {type: 'paragraph', ts: '1'},
        style: {},
        order: {id: [1, 'a'], path: [], index: [], ts: '1'},
    },
    runs: [{text: 'a', marks}],
    depth: 0,
    parentId: '',
});

describe('inline run rendering helpers', () => {
    it('derives active mark types from registered inline marks', () => {
        const registry = createBlockEditorRegistry([basicMarksPlugin, codePlugin]);

        expect(activeInlineMarkTypesFromRegistry(registry)).toEqual([
            'bold',
            'italic',
            'strikethrough',
            'underline',
            'code',
        ]);
    });

    it('ignores unregistered active mark types', () => {
        const registry = createBlockEditorRegistry([basicMarksPlugin]);
        const activeMarks = deriveActiveInlineMarks(
            emptyState(),
            [formattedBlock({bold: true, code: 'ts'})],
            {type: 'caret', point: {blockId: 'block-1', offset: 0}},
            {code: true} satisfies PendingInlineMarks,
            activeInlineMarkTypesFromRegistry(registry),
        );

        expect(activeMarks).toEqual({bold: true, italic: false, strikethrough: false, underline: false});
    });
});
