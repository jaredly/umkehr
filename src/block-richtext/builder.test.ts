import {describe, expect, it} from 'vitest';
import {blankHistory, dispatch} from '../history/history.js';
import {createPatchBuilder} from '../helper.js';
import {resolveAndApply} from '../make.js';
import {
    BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    blockRichText,
    blockRichTextBuilderExtension,
    blockRichTextRootBlockId,
    type BlockRichText,
} from './index.js';

type State = {
    title: string;
    body: BlockRichText;
};

type BlockRichTextBuilderExtensions = [typeof blockRichTextBuilderExtension];
const createBlockRichTextPatchBuilder = () =>
    createPatchBuilder<State, BlockRichTextBuilderExtensions>({
        builderExtensions: [blockRichTextBuilderExtension],
    });

describe('block rich text builder surface', () => {
    it('creates block rich text draft patches', () => {
        const $ = createBlockRichTextPatchBuilder();
        const rootBlockId = blockRichTextRootBlockId();

        expect($.body.$block.insertText({block: rootBlockId, offset: 0, text: 'hi'})).toEqual({
            op: 'leaf',
            plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
            path: [{type: 'key', key: 'body'}],
            change: {kind: 'insertText', block: rootBlockId, offset: 0, text: 'hi'},
        });
        expect(
            $.body.$block.deleteRange({block: rootBlockId, startOffset: 0, endOffset: 2}),
        ).toEqual({
            op: 'leaf',
            plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
            path: [{type: 'key', key: 'body'}],
            change: {kind: 'deleteRange', block: rootBlockId, startOffset: 0, endOffset: 2},
        });
    });

    it('resolveAndApply carries block patches without mutating public state', () => {
        const initial: State = {title: 'Draft', body: blockRichText()};
        const $ = createBlockRichTextPatchBuilder();
        const rootBlockId = blockRichTextRootBlockId();
        const result = resolveAndApply(
            initial,
            $.body.$block.insertText({block: rootBlockId, offset: 0, text: 'hi'}),
            undefined,
            'type',
            Object.is,
        );

        expect(result.current).toEqual(initial);
        expect(result.changes).toEqual([
            {
                op: 'leaf',
                plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
                path: [{type: 'key', key: 'body'}],
                change: {kind: 'insertText', block: rootBlockId, offset: 0, text: 'hi'},
            },
        ]);
    });

    it('rejects block rich text patches in non-CRDT history', () => {
        const initial: State = {title: 'Draft', body: blockRichText()};
        const $ = createBlockRichTextPatchBuilder();

        expect(() =>
            dispatch(
                blankHistory(initial),
                $.body.$block.insertText({
                    block: blockRichTextRootBlockId(),
                    offset: 0,
                    text: 'hi',
                }),
            ),
        ).toThrow(/CRDT history/);
    });
});
