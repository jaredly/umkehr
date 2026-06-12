import {describe, expect, it} from 'vitest';
import {blankHistory, dispatch} from '../history/history.js';
import {createPatchBuilder} from '../helper.js';
import {resolveAndApply} from '../make.js';
import {
    BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    blockRichText,
    blockRichTextRootBlockId,
    type BlockRichText,
} from './index.js';

type State = {
    title: string;
    body: BlockRichText;
};

describe('block rich text builder surface', () => {
    it('creates block rich text draft patches', () => {
        const $ = createPatchBuilder<State>();
        const rootBlockId = blockRichTextRootBlockId();

        expect($.body.$block.insertText(rootBlockId, 0, 'hi')).toEqual({
            op: 'leaf',
            plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
            path: [{type: 'key', key: 'body'}],
            change: {kind: 'insertText', block: rootBlockId, offset: 0, text: 'hi'},
        });
        expect($.body.$block.deleteRange(rootBlockId, 0, 2)).toEqual({
            op: 'leaf',
            plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
            path: [{type: 'key', key: 'body'}],
            change: {kind: 'deleteRange', block: rootBlockId, startOffset: 0, endOffset: 2},
        });
    });

    it('resolveAndApply carries block patches without mutating public state', () => {
        const initial: State = {title: 'Draft', body: blockRichText()};
        const $ = createPatchBuilder<State>();
        const rootBlockId = blockRichTextRootBlockId();
        const result = resolveAndApply(
            initial,
            $.body.$block.insertText(rootBlockId, 0, 'hi'),
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
        const $ = createPatchBuilder<State>();

        expect(() =>
            dispatch(blankHistory(initial), $.body.$block.insertText(blockRichTextRootBlockId(), 0, 'hi')),
        ).toThrow(/CRDT history/);
    });
});
