import {describe, expect, it} from 'vitest';
import typia from 'typia';
import {richText, richTextFromPlainText, richTextFromSpans, type RichCollaborativeText} from './index.js';

type State = {
    title: string;
    body: RichCollaborativeText;
};

describe('richtext public api', () => {
    it('creates an empty rich-text value', () => {
        expect(richText()).toEqual({kind: 'rich-text', version: 1, chars: []});
    });

    it('creates import snapshots', () => {
        expect(richTextFromPlainText('hi')).toEqual({spans: [{text: 'hi'}]});
        expect(richTextFromSpans([{text: 'hi', marks: {strong: true}}])).toEqual({
            spans: [{text: 'hi', marks: {strong: true}}],
        });
    });

    it('emits the typia rich-text schema marker', () => {
        const schemas = typia.json.schemas<[State], '3.1'>();
        const root = schemas.components.schemas?.State as {
            properties?: Record<string, Record<string, unknown>>;
        };

        expect(root.properties?.body?.['x-umkehr-crdt']).toBe('rich-text');
        expect(root.properties?.body?.['x-umkehr-rich-text-version']).toBe(1);
    });
});
