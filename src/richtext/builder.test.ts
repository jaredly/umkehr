import {describe, expect, it} from 'vitest';
import {blankHistory, dispatch} from '../history/history.js';
import {createPatchBuilder} from '../helper.js';
import {resolveAndApply} from '../make.js';
import {
    RICH_TEXT_LEAF_PLUGIN_ID,
    richText,
    richTextBuilderExtension,
    richTextFromPlainText,
    type RichCollaborativeText,
} from './index.js';

type State = {
    title: string;
    body: RichCollaborativeText;
};

type RichTextBuilderExtensions = [typeof richTextBuilderExtension];
const createRichTextPatchBuilder = () =>
    createPatchBuilder<State, RichTextBuilderExtensions>({
        builderExtensions: [richTextBuilderExtension],
    });

describe('rich text builder surface', () => {
    it('creates rich text draft patches', () => {
        const $ = createRichTextPatchBuilder();

        expect($.body.$text.insert({at: {index: 0}, text: 'hi'})).toEqual({
            op: 'leaf',
            plugin: RICH_TEXT_LEAF_PLUGIN_ID,
            path: [{type: 'key', key: 'body'}],
            change: {kind: 'insert', at: {index: 0}, text: 'hi'},
        });
        expect($.body.$text.replace({snapshot: richTextFromPlainText('reset')})).toEqual({
            op: 'leaf',
            plugin: RICH_TEXT_LEAF_PLUGIN_ID,
            path: [{type: 'key', key: 'body'}],
            change: {kind: 'replace', snapshot: {spans: [{text: 'reset'}]}},
        });
    });

    it('resolveAndApply carries rich text patches without mutating public state', () => {
        const initial: State = {title: 'Draft', body: richText()};
        const $ = createRichTextPatchBuilder();
        const result = resolveAndApply(
            initial,
            $.body.$text.insert({at: {index: 0}, text: 'hi'}),
            undefined,
            'type',
            Object.is,
        );

        expect(result.current).toEqual(initial);
        expect(result.changes).toEqual([
            {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: [{type: 'key', key: 'body'}],
                change: {kind: 'insert', at: {index: 0}, text: 'hi'},
            },
        ]);
    });

    it('rejects rich text patches in non-CRDT history', () => {
        const initial: State = {title: 'Draft', body: richText()};
        const $ = createRichTextPatchBuilder();

        expect(() =>
            dispatch(blankHistory(initial), $.body.$text.insert({at: {index: 0}, text: 'hi'})),
        ).toThrow(/CRDT history/);
    });
});
