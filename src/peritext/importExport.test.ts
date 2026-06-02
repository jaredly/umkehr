import {describe, expect, it} from 'vitest';
import {
    exportRichTextSnapshot,
    importRichTextSnapshot,
    materializeRichTextState,
    richTextSnapshotFromPlainText,
} from './index.js';

describe('peritext import/export', () => {
    it('imports plain text as ordinary insert operations', () => {
        const {operations, state} = importRichTextSnapshot(
            richTextSnapshotFromPlainText('hi'),
            'alice:main',
        );

        expect(operations).toEqual([
            {action: 'insert', opId: '1@alice:main', afterId: null, char: 'h'},
            {action: 'insert', opId: '2@alice:main', afterId: '1@alice:main', char: 'i'},
        ]);
        expect(materializeRichTextState(state)).toEqual({
            plainText: 'hi',
            spans: [{text: 'hi'}],
        });
    });

    it('imports span marks as normal addMark operations', () => {
        const {operations, state} = importRichTextSnapshot(
            {spans: [{text: 'hi', marks: {strong: true}}, {text: '!'}]},
            'alice:main',
        );

        expect(operations.at(-1)).toMatchObject({
            action: 'addMark',
            opId: '4@alice:main',
            start: {type: 'before', opId: '1@alice:main'},
            end: {type: 'after', opId: '2@alice:main'},
            markType: 'strong',
            value: true,
        });
        expect(materializeRichTextState(state).spans).toEqual([
            {text: 'hi', marks: {strong: true}},
            {text: '!'},
        ]);
    });

    it('exports the render view as a snapshot', () => {
        expect(
            exportRichTextSnapshot({
                plainText: 'hi',
                spans: [{text: 'hi', marks: {strong: true}}],
            }),
        ).toEqual({spans: [{text: 'hi', marks: {strong: true}}]});
    });

    it('rejects malformed snapshots', () => {
        expect(() =>
            importRichTextSnapshot({spans: [{text: 1}]} as never, 'alice:main'),
        ).toThrow(/span text/);
    });
});
