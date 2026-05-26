import type {ServerDocumentSummary} from './types';

export function parseServerDocumentsResponse(body: unknown): ServerDocumentSummary[] {
    if (!isRecord(body) || !Array.isArray(body.documents)) {
        throw new Error('Server returned an invalid document list.');
    }
    const documents: ServerDocumentSummary[] = [];
    for (const document of body.documents) {
        if (!isServerDocumentSummary(document)) {
            throw new Error('Server returned an invalid document summary.');
        }
        documents.push(document);
    }
    return documents;
}

export function documentsForActiveDoc(
    documents: ServerDocumentSummary[],
    activeDocId: string,
): ServerDocumentSummary[] {
    if (documents.some((document) => document.docId === activeDocId)) return documents;
    return [
        {
            docId: activeDocId,
            appId: '',
            schemaVersion: 0,
            schemaFingerprint: '',
            schemaFingerprintHash: '',
            title: activeDocId,
            sizeLabel: 'manual',
            sizeRank: 0,
            createdAt: '',
            lastAccessedAt: '',
            branchCount: 0,
            eventCount: 0,
        },
        ...documents,
    ];
}

function isServerDocumentSummary(value: unknown): value is ServerDocumentSummary {
    return (
        isRecord(value) &&
        typeof value.docId === 'string' &&
        value.docId.length > 0 &&
        typeof value.appId === 'string' &&
        typeof value.schemaVersion === 'number' &&
        typeof value.schemaFingerprint === 'string' &&
        typeof value.schemaFingerprintHash === 'string' &&
        typeof value.title === 'string' &&
        typeof value.sizeLabel === 'string' &&
        typeof value.sizeRank === 'number' &&
        typeof value.createdAt === 'string' &&
        typeof value.lastAccessedAt === 'string' &&
        typeof value.branchCount === 'number' &&
        typeof value.eventCount === 'number'
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
