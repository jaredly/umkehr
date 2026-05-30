import {describe, expect, it} from 'vitest';
import typia from 'typia';
import {
    applyCrdtUpdate,
    applyLocalCommand,
    changedNormalPathsForCrdtUpdate,
    canRedoLocalCommand,
    canUndoLocalCommand,
    createCrdtDocument,
    createCrdtLocalHistory,
    createCrdtUpdates,
    createCrdtUpdateValidator,
    hlc,
    redoLocalCommand,
    undoLocalCommand,
} from './index.js';
import {
    materializeRichText,
    richText,
    richTextFromPlainText,
    type RichCollaborativeText,
} from '../richtext/index.js';
import {createPatchBuilder} from '../helper.js';

type State = {
    title: string;
    body: RichCollaborativeText;
};

const schema = typia.json.schemas<[State], '3.1'>();
const ts = (count: number) => `000000000000001:${count.toString(36).padStart(5, '0')}:alice`;

describe('crdt rich text metadata', () => {
    it('builds rich-text metadata from the schema marker', () => {
        const doc = createCrdtDocument(
            {title: 'Draft', body: richText()},
            schema,
            {timestamp: '001'},
        );

        expect(doc.state).toEqual({title: 'Draft', body: {kind: 'rich-text', version: 1, chars: []}});
        expect(doc.meta).toMatchObject({
            kind: 'object',
            fields: {
                body: {
                    kind: 'richText',
                    created: '001',
                    maxOpCounter: 0,
                },
            },
        });
    });

    it('materializes rich text through the explicit helper', () => {
        const doc = createCrdtDocument(
            {title: 'Draft', body: richText()},
            schema,
            {timestamp: '001'},
        );

        expect(materializeRichText(doc, [{type: 'key', key: 'body'}])).toEqual({
            plainText: '',
            spans: [],
        });
    });

    it('translates and applies rich-text insert updates', () => {
        let doc = createCrdtDocument(
            {title: 'Draft', body: richText()},
            schema,
            {timestamp: '001'},
        );
        const $ = createPatchBuilder<State>();
        const updates = createCrdtUpdates(doc, $.body.$text.insert({index: 0}, 'hi'), ts(1));

        expect(updates).toMatchObject([
            {
                op: 'richText',
                change: {action: 'insert', opId: '1@alice:main', afterId: null, char: 'h'},
            },
            {
                op: 'richText',
                change: {action: 'insert', opId: '2@alice:main', afterId: '1@alice:main', char: 'i'},
            },
        ]);

        for (const update of updates) doc = applyCrdtUpdate(doc, update);

        expect(doc.state.body).toMatchObject({kind: 'rich-text', version: 1});
        expect(doc.state.body.chars).toHaveLength(2);
        expect(materializeRichText(doc, [{type: 'key', key: 'body'}]).plainText).toBe('hi');
    });

    it('applies marks and reports the rich-text field as changed', () => {
        let doc = createCrdtDocument(
            {title: 'Draft', body: richText()},
            schema,
            {timestamp: '001'},
        );
        const $ = createPatchBuilder<State>();
        for (const update of createCrdtUpdates(doc, $.body.$text.insert({index: 0}, 'hi'), ts(1))) {
            doc = applyCrdtUpdate(doc, update);
        }
        const [mark] = createCrdtUpdates(
            doc,
            $.body.$text.mark({start: 0, end: 2}, 'strong', true),
            ts(2),
        );
        if (!mark) throw new Error('missing mark update');

        const after = applyCrdtUpdate(doc, mark);

        expect(materializeRichText(after, [{type: 'key', key: 'body'}]).spans).toEqual([
            {text: 'hi', marks: {strong: true}},
        ]);
        expect(changedNormalPathsForCrdtUpdate(doc, after, mark)).toEqual([
            [{type: 'key', key: 'body'}],
        ]);
    });

    it('validates rich-text update envelopes', () => {
        const validator = createCrdtUpdateValidator(schema);
        const doc = createCrdtDocument(
            {title: 'Draft', body: richText()},
            schema,
            {timestamp: ts(0)},
        );
        const [update] = createCrdtUpdates(
            doc,
            createPatchBuilder<State>().body.$text.replace(richTextFromPlainText('h')),
            ts(1),
        );
        if (!update) throw new Error('missing update');

        expect(validator.validate(update)).toMatchObject({success: true});
        expect(
            validator.validate({
                ...update,
                change: {...update.change, char: 'too long'},
            }),
        ).toMatchObject({success: false});
    });

    it('undoes and redoes grouped rich-text inserts with fresh operations', () => {
        const base = createCrdtLocalHistory(
            createCrdtDocument(
                {title: 'Draft', body: richText()},
                schema,
                {timestamp: ts(0)},
            ),
        );
        const $ = createPatchBuilder<State>();
        const applied = applyLocalCommand(
            base,
            $.body.$text.insert({index: 0}, 'hi'),
            hlc.init('local', 10),
        );

        expect(materializeRichText(applied.history.doc, [{type: 'key', key: 'body'}]).plainText).toBe(
            'hi',
        );
        expect(applied.updates).toHaveLength(2);
        expect(canUndoLocalCommand(applied.history, 'local')).toBe(true);

        const undone = undoLocalCommand(applied.history, 'local', applied.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(materializeRichText(undone.history.doc, [{type: 'key', key: 'body'}]).plainText).toBe(
            '',
        );
        expect(undone.updates).toHaveLength(2);
        expect(undone.updates.every((update) => update.op === 'richText')).toBe(true);
        expect(canRedoLocalCommand(undone.history, 'local')).toBe(true);

        const redone = redoLocalCommand(undone.history, 'local', undone.clock);
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(materializeRichText(redone.history.doc, [{type: 'key', key: 'body'}]).plainText).toBe(
            'hi',
        );
        expect(redone.updates).toHaveLength(2);
        expect(redone.updates[0]?.op === 'richText' ? redone.updates[0].change.opId : '').not.toBe(
            applied.updates[0]?.op === 'richText' ? applied.updates[0].change.opId : '',
        );
    });

    it('undoes and redoes rich-text marks with fresh operations', () => {
        let history = createCrdtLocalHistory(
            createCrdtDocument(
                {title: 'Draft', body: richText()},
                schema,
                {timestamp: ts(0)},
            ),
        );
        const $ = createPatchBuilder<State>();
        const inserted = applyLocalCommand(
            history,
            $.body.$text.insert({index: 0}, 'hi'),
            hlc.init('local', 10),
        );
        history = inserted.history;
        const marked = applyLocalCommand(
            history,
            $.body.$text.mark({start: 0, end: 2}, 'strong', true),
            inserted.clock,
        );

        expect(materializeRichText(marked.history.doc, [{type: 'key', key: 'body'}]).spans).toEqual([
            {text: 'hi', marks: {strong: true}},
        ]);

        const undone = undoLocalCommand(marked.history, 'local', marked.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(materializeRichText(undone.history.doc, [{type: 'key', key: 'body'}]).spans).toEqual([
            {text: 'hi'},
        ]);

        const redone = redoLocalCommand(undone.history, 'local', undone.clock);
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(materializeRichText(redone.history.doc, [{type: 'key', key: 'body'}]).spans).toEqual([
            {text: 'hi', marks: {strong: true}},
        ]);
    });
});
