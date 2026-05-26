import {describe, expect, it} from 'vitest';
import {
    documentsForActiveDoc,
    parseServerDocumentsResponse,
} from './documents';
import type {ServerDocumentSummary} from './types';

const summary: ServerDocumentSummary = {
    docId: 'todos-small',
    appId: 'todos',
    schemaVersion: 1,
    schemaFingerprint: 'schema',
    schemaFingerprintHash: 'hash',
    title: 'Todos small',
    sizeLabel: 'small',
    sizeRank: 10,
    createdAt: '2026-01-02T00:00:00.000Z',
    lastAccessedAt: '2026-01-02T00:00:00.000Z',
    branchCount: 1,
    eventCount: 2,
};

describe('server document helpers', () => {
    it('parses valid document summaries and rejects malformed responses', () => {
        expect(parseServerDocumentsResponse({documents: [summary]})).toEqual([summary]);
        expect(() => parseServerDocumentsResponse({documents: [{...summary, docId: ''}]}))
            .toThrow('Server returned an invalid document summary.');
        expect(() => parseServerDocumentsResponse({documents: 'nope'})).toThrow(
            'Server returned an invalid document list.',
        );
    });

    it('keeps a manual active document available when it is missing from discovery', () => {
        expect(documentsForActiveDoc([summary], 'todos-small')).toEqual([summary]);
        expect(documentsForActiveDoc([summary], 'manual-doc').map((document) => document.docId))
            .toEqual(['manual-doc', 'todos-small']);
    });
});
