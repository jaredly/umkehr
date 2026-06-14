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
import type {CrdtMeta, ObjectMeta} from './index.js';
import {
    materializeRichText,
    richText,
    richTextBuilderExtension,
    richTextLeafPlugin,
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
type RichTextBuilderExtensions = [typeof richTextBuilderExtension];
const createRichTextPatchBuilder = () =>
    createPatchBuilder<State, RichTextBuilderExtensions>({
        builderExtensions: [richTextBuilderExtension],
    });
const createRichTextDoc = (timestamp = '001') =>
    createCrdtDocument({title: 'Draft', body: richText()}, schema, {
        timestamp,
        leafPlugins: [richTextLeafPlugin],
    });

describe('crdt rich text metadata', () => {
    it('builds rich-text metadata from the schema marker', () => {
        const doc = createRichTextDoc();

        expect(doc.state).toEqual({
            title: 'Draft',
            body: {kind: 'rich-text', version: 1, chars: []},
        });
        expect(doc.meta).toMatchObject({
            kind: 'object',
            fields: {
                body: {
                    kind: 'leaf',
                    plugin: 'umkehr.rich-text',
                    created: '001',
                    data: {maxOpCounter: 0},
                },
            },
        });
    });

    it('materializes rich text through the explicit helper', () => {
        const doc = createRichTextDoc();

        expect(materializeRichText(doc, [{type: 'key', key: 'body'}])).toEqual({
            plainText: '',
            spans: [],
        });
    });

    it('translates and applies rich-text insert updates', () => {
        let doc = createRichTextDoc();
        const $ = createRichTextPatchBuilder();
        const updates = createCrdtUpdates(
            doc,
            $.body.$text.insert({at: {index: 0}, text: 'hi'}),
            ts(1),
        );

        expect(updates).toMatchObject([
            {
                op: 'leaf',
                plugin: 'umkehr.rich-text',
                change: {action: 'insert', opId: '1@alice:main', afterId: null, char: 'h'},
            },
            {
                op: 'leaf',
                plugin: 'umkehr.rich-text',
                change: {
                    action: 'insert',
                    opId: '2@alice:main',
                    afterId: '1@alice:main',
                    char: 'i',
                },
            },
        ]);

        for (const update of updates) doc = applyCrdtUpdate(doc, update);

        expect(doc.state.body).toMatchObject({kind: 'rich-text', version: 1});
        expect(doc.state.body.chars).toHaveLength(2);
        expect(materializeRichText(doc, [{type: 'key', key: 'body'}]).plainText).toBe('hi');
    });

    it('applies rich-text updates without mutating previous metadata', () => {
        const doc = createRichTextDoc();
        const beforeMeta = structuredClone(doc.meta) as CrdtMeta;
        const titleMeta = objectField(doc.meta, 'title');
        const bodyMeta = objectField(doc.meta, 'body');
        const $ = createRichTextPatchBuilder();
        const [insert] = createCrdtUpdates(
            doc,
            $.body.$text.insert({at: {index: 0}, text: 'h'}),
            ts(1),
        );
        if (!insert) throw new Error('missing rich-text insert update');

        const after = applyCrdtUpdate(doc, insert);

        expect(doc.meta).toEqual(beforeMeta);
        expect(after.meta).not.toBe(doc.meta);
        expect(objectField(after.meta, 'title')).toBe(titleMeta);
        expect(objectField(after.meta, 'body')).not.toBe(bodyMeta);
        expect(after.state).not.toBe(doc.state);
        expect(after.state.body).not.toBe(doc.state.body);
        expect(after.state.title).toBe(doc.state.title);
        expect(materializeRichText(after, [{type: 'key', key: 'body'}]).plainText).toBe('h');
    });

    it('applies marks and reports the rich-text field as changed', () => {
        let doc = createRichTextDoc();
        const $ = createRichTextPatchBuilder();
        for (const update of createCrdtUpdates(
            doc,
            $.body.$text.insert({at: {index: 0}, text: 'hi'}),
            ts(1),
        )) {
            doc = applyCrdtUpdate(doc, update);
        }
        const [mark] = createCrdtUpdates(
            doc,
            $.body.$text.mark({range: {start: 0, end: 2}, markType: 'strong', value: true}),
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
        const validator = createCrdtUpdateValidator(schema, {leafPlugins: [richTextLeafPlugin]});
        const doc = createRichTextDoc(ts(0));
        const [update] = createCrdtUpdates(
            doc,
            createRichTextPatchBuilder().body.$text.replace({snapshot: richTextFromPlainText('h')}),
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
        const base = createCrdtLocalHistory(createRichTextDoc(ts(0)));
        const $ = createRichTextPatchBuilder();
        const applied = applyLocalCommand(
            base,
            $.body.$text.insert({at: {index: 0}, text: 'hi'}),
            hlc.init('local', 10),
        );

        expect(
            materializeRichText(applied.history.doc, [{type: 'key', key: 'body'}]).plainText,
        ).toBe('hi');
        expect(applied.updates).toHaveLength(2);
        expect(canUndoLocalCommand(applied.history, 'local')).toBe(true);

        const undone = undoLocalCommand(applied.history, 'local', applied.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(
            materializeRichText(undone.history.doc, [{type: 'key', key: 'body'}]).plainText,
        ).toBe('');
        expect(undone.updates).toHaveLength(2);
        expect(undone.updates.every((update) => update.op === 'leaf')).toBe(true);
        expect(canRedoLocalCommand(undone.history, 'local')).toBe(true);

        const redone = redoLocalCommand(undone.history, 'local', undone.clock);
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(
            materializeRichText(redone.history.doc, [{type: 'key', key: 'body'}]).plainText,
        ).toBe('hi');
        expect(redone.updates).toHaveLength(2);
        expect(
            redone.updates[0]?.op === 'leaf'
                ? (redone.updates[0].change as {opId: string}).opId
                : '',
        ).not.toBe(
            applied.updates[0]?.op === 'leaf'
                ? (applied.updates[0].change as {opId: string}).opId
                : '',
        );
    });

    it('undoes and redoes rich-text marks with fresh operations', () => {
        let history = createCrdtLocalHistory(createRichTextDoc(ts(0)));
        const $ = createRichTextPatchBuilder();
        const inserted = applyLocalCommand(
            history,
            $.body.$text.insert({at: {index: 0}, text: 'hi'}),
            hlc.init('local', 10),
        );
        history = inserted.history;
        const marked = applyLocalCommand(
            history,
            $.body.$text.mark({range: {start: 0, end: 2}, markType: 'strong', value: true}),
            inserted.clock,
        );

        expect(materializeRichText(marked.history.doc, [{type: 'key', key: 'body'}]).spans).toEqual(
            [{text: 'hi', marks: {strong: true}}],
        );

        const undone = undoLocalCommand(marked.history, 'local', marked.clock);
        expect(undone.ok).toBe(true);
        if (!undone.ok) return;
        expect(materializeRichText(undone.history.doc, [{type: 'key', key: 'body'}]).spans).toEqual(
            [{text: 'hi'}],
        );

        const redone = redoLocalCommand(undone.history, 'local', undone.clock);
        expect(redone.ok).toBe(true);
        if (!redone.ok) return;
        expect(materializeRichText(redone.history.doc, [{type: 'key', key: 'body'}]).spans).toEqual(
            [{text: 'hi', marks: {strong: true}}],
        );
    });
});

function objectField(meta: CrdtMeta, key: string) {
    expect(meta.kind).toBe('object');
    return (meta as ObjectMeta).fields[key];
}
