import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {History} from 'umkehr';
import type {LocalDocumentSummary} from '../documentArchive';

const DB_NAME = 'umkehr-react-crdt-solo-documents';
const DB_VERSION = 1;

export type PersistedSoloDocument<TState> = {
    docId: string;
    appId: string;
    schemaFingerprintHash: string;
    history: History<TState, unknown>;
    createdAt: string;
    updatedAt: string;
};

interface SoloDocumentsDb extends DBSchema {
    documents: {
        key: string;
        value: PersistedSoloDocument<unknown>;
    };
}

export async function loadSoloDocument<TState>(docId: string) {
    const db = await openSoloDocumentsDb();
    return ((await db.get('documents', docId)) as PersistedSoloDocument<TState> | undefined) ?? null;
}

export async function saveSoloDocument<TState>(document: PersistedSoloDocument<TState>) {
    const db = await openSoloDocumentsDb();
    await db.put('documents', document as PersistedSoloDocument<unknown>, document.docId);
}

export async function listSoloDocumentSummaries(): Promise<LocalDocumentSummary[]> {
    const db = await openSoloDocumentsDb();
    const documents = await db.getAll('documents');
    return documents.map((document) => ({
        docId: document.docId,
        appId: document.appId,
        title: document.docId,
        payloadKind: 'solo',
        schemaFingerprintHash: document.schemaFingerprintHash,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
    }));
}

let dbPromise: Promise<IDBPDatabase<SoloDocumentsDb>> | null = null;

function openSoloDocumentsDb() {
    dbPromise ??= openDB<SoloDocumentsDb>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents');
        },
    });
    return dbPromise;
}
