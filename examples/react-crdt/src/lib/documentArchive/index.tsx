import {useRef, useState, type ChangeEvent} from 'react';
import {createPatchValidator} from 'umkehr/validation';
import {
    createCrdtUpdateValidator,
    type CrdtDocument,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from 'umkehr/crdt';
import type {History} from 'umkehr';
import type {AppDefinition} from '../crdtApp';
import type {TransportState} from '../local/useLocalDemoSync';
import type {PersistedReplica, PersistedBatch} from '../local-first/types';
import type {PersistedServerReplica} from '../server/types';

export const DOCUMENT_ARCHIVE_KIND = 'umkehr.react-crdt.document';
export const DOCUMENT_ARCHIVE_VERSION = 1;

export type DocumentPayloadKind =
    | 'solo'
    | 'local-simulator'
    | 'peerjs'
    | 'server'
    | 'local-first';

export type SoloDocumentPayload = {
    kind: 'solo';
    history: History<unknown, unknown>;
};

export type LocalSimulatorDocumentPayload = {
    kind: 'local-simulator';
    replicas: Record<string, CrdtLocalHistory<unknown>>;
    transportState: TransportState;
};

export type PeerJsDocumentPayload = {
    kind: 'peerjs';
    history: CrdtLocalHistory<unknown>;
};

export type ServerDocumentPayload = {
    kind: 'server';
    replica: PersistedServerReplica<unknown>;
};

export type LocalFirstDocumentPayload = {
    kind: 'local-first';
    replica: PersistedReplica<unknown>;
    batches: PersistedBatch[];
};

export type DocumentPayload =
    | SoloDocumentPayload
    | LocalSimulatorDocumentPayload
    | PeerJsDocumentPayload
    | ServerDocumentPayload
    | LocalFirstDocumentPayload;

export type DocumentArchive<TPayload extends DocumentPayload = DocumentPayload> = {
    kind: typeof DOCUMENT_ARCHIVE_KIND;
    archiveVersion: typeof DOCUMENT_ARCHIVE_VERSION;
    exportedAt: string;
    appId: string;
    docId: string;
    schemaVersion?: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    exportedBy?: {actor: string};
    payload: TPayload;
};

export type LocalDocumentSummary = {
    docId: string;
    appId: string;
    title: string;
    payloadKind: DocumentPayloadKind;
    schemaVersion?: number;
    schemaFingerprintHash: string;
    createdAt: string;
    updatedAt: string;
};

export type DocumentArchiveAdapter = {
    exportArchive(): Promise<DocumentArchive>;
    importArchive(archive: DocumentArchive): Promise<void>;
};

export function serializeArchive(archive: DocumentArchive): string {
    return `${JSON.stringify(archive, null, 2)}\n`;
}

export function parseArchive(json: string): DocumentArchive {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error('Archive file is not valid JSON.');
    }
    assertDocumentArchive(parsed);
    return parsed;
}

export function assertArchiveForApp<TKind extends DocumentPayloadKind>(
    archive: DocumentArchive,
    app: Pick<AppDefinition<unknown>, 'id'>,
    expectedPayloadKind: TKind,
): asserts archive is DocumentArchive<Extract<DocumentPayload, {kind: TKind}>> {
    if (archive.appId !== app.id) {
        throw new Error(`Archive belongs to app "${archive.appId}", not "${app.id}".`);
    }
    if (archive.payload.kind !== expectedPayloadKind) {
        throw new Error(
            `Archive payload "${archive.payload.kind}" cannot be imported into "${expectedPayloadKind}".`,
        );
    }
}

export function archiveFileName({
    appId,
    docId,
    payloadKind,
    exportedAt,
}: {
    appId: string;
    docId: string;
    payloadKind: DocumentPayloadKind;
    exportedAt: string;
}) {
    const date = exportedAt.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
    return `${safeFileSegment(appId)}-${safeFileSegment(docId)}-${payloadKind}-${date}.json`;
}

export function readActiveDocIdFromSearch(search: string, fallbackDocId: string) {
    return new URLSearchParams(search).get('doc')?.trim() || fallbackDocId;
}

export function urlWithActiveDocId(href: string, docId: string) {
    const url = new URL(href);
    url.searchParams.set('doc', docId);
    return `${url.pathname}${url.search}${url.hash}`;
}

export function documentsForActiveDocument(
    documents: LocalDocumentSummary[],
    activeDocId: string,
    appId: string,
    payloadKind: DocumentPayloadKind,
): LocalDocumentSummary[] {
    const filtered = documents.filter(
        (document) => document.appId === appId && document.payloadKind === payloadKind,
    );
    if (filtered.some((document) => document.docId === activeDocId)) return filtered;
    return [
        {
            docId: activeDocId,
            appId,
            title: activeDocId,
            payloadKind,
            schemaFingerprintHash: '',
            createdAt: '',
            updatedAt: '',
        },
        ...filtered,
    ];
}

export function DocumentPicker({
    documents,
    activeDocId,
    appId,
    payloadKind,
    label = 'Document',
    onSwitchDocument,
}: {
    documents: LocalDocumentSummary[];
    activeDocId: string;
    appId: string;
    payloadKind: DocumentPayloadKind;
    label?: string;
    onSwitchDocument(docId: string): void;
}) {
    const options = documentsForActiveDocument(documents, activeDocId, appId, payloadKind);
    return (
        <label className="documentPicker">
            <span>{label}</span>
            <select
                value={activeDocId}
                onChange={(event) => onSwitchDocument(event.currentTarget.value)}
                aria-label={label}
            >
                {options.map((document) => (
                    <option key={document.docId} value={document.docId} title={document.docId}>
                        {document.title || document.docId}
                    </option>
                ))}
            </select>
        </label>
    );
}

export function DocumentArchiveControls({
    adapter,
    appId,
    docId,
    payloadKind,
    disabled,
}: {
    adapter: DocumentArchiveAdapter;
    appId: string;
    docId: string;
    payloadKind: DocumentPayloadKind;
    disabled?: boolean;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function exportDocument() {
        setMessage(null);
        try {
            const archive = await adapter.exportArchive();
            downloadJsonArchive(archive);
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    async function importDocument(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        setMessage(null);
        try {
            const archive = parseArchive(await file.text());
            await adapter.importArchive(archive);
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    return (
        <div className="documentArchiveControls" aria-label="Document import and export">
            <button type="button" disabled={disabled} onClick={() => void exportDocument()}>
                Export
            </button>
            <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
            >
                Import
            </button>
            <input
                ref={inputRef}
                type="file"
                accept="application/json,.json"
                className="documentArchiveInput"
                onChange={(event) => void importDocument(event)}
            />
            {message ? <p className="documentArchiveMessage">{message}</p> : null}
        </div>
    );
}

export function downloadJsonArchive(archive: DocumentArchive) {
    const blob = new Blob([serializeArchive(archive)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = archiveFileName({
        appId: archive.appId,
        docId: archive.docId,
        payloadKind: archive.payload.kind,
        exportedAt: archive.exportedAt,
    });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export function validateCrdtDocumentForApp<TState>(
    input: unknown,
    app: AppDefinition<TState>,
): CrdtDocument<TState> {
    if (!isRecord(input)) throw new Error('Imported CRDT document must be an object.');
    const state = app.validateState(input.state);
    if (!state.success) throw new Error('Imported CRDT document state does not match this app.');
    if (!Array.isArray(input.pending)) throw new Error('Imported CRDT document pending updates are invalid.');
    if (!isRecord(input.schema)) throw new Error('Imported CRDT document schema is invalid.');
    return input as CrdtDocument<TState>;
}

export function validateCrdtLocalHistoryForApp<TState>(
    input: unknown,
    app: AppDefinition<TState>,
): CrdtLocalHistory<TState> {
    if (!isRecord(input)) throw new Error('Imported CRDT history must be an object.');
    const history = input as Partial<CrdtLocalHistory<TState>>;
    validateCrdtDocumentForApp(history.base, app);
    validateCrdtDocumentForApp(history.doc, app);
    if (!Array.isArray(history.updates)) {
        throw new Error('Imported CRDT history update log is invalid.');
    }
    validateCrdtUpdatesForApp(history.updates, app);
    return input as CrdtLocalHistory<TState>;
}

export function validateCrdtUpdatesForApp<TState>(
    updates: unknown,
    app: AppDefinition<TState>,
): CrdtUpdate[] {
    if (!Array.isArray(updates)) throw new Error('Imported CRDT updates must be an array.');
    const validator = createCrdtUpdateValidator(app.schema);
    return updates.map((update, index) => {
        const result = validator.validate(update);
        if (!result.success) throw new Error(`Imported CRDT update ${index} is invalid.`);
        return result.data;
    });
}

export function validateHistoryForApp<TState>(
    input: unknown,
    app: AppDefinition<TState>,
): History<TState, unknown> {
    if (!isRecord(input)) throw new Error('Imported history must be an object.');
    if (input.version !== 2) throw new Error('Imported history version is unsupported.');
    const initial = app.validateState(input.initial);
    const current = app.validateState(input.current);
    if (!initial.success || !current.success) {
        throw new Error('Imported history state does not match this app.');
    }
    if (!isRecord(input.nodes) || typeof input.root !== 'string' || typeof input.tip !== 'string') {
        throw new Error('Imported history graph is invalid.');
    }
    const patchValidator = createPatchValidator(app.schema);
    for (const [nodeId, node] of Object.entries(input.nodes)) {
        if (!isRecord(node) || !Array.isArray(node.changes)) {
            throw new Error(`Imported history node "${nodeId}" is invalid.`);
        }
        for (const patch of node.changes) {
            const result = patchValidator.validate(patch);
            if (!result.success) throw new Error(`Imported history node "${nodeId}" has an invalid patch.`);
        }
    }
    return input as History<TState, unknown>;
}

function assertDocumentArchive(input: unknown): asserts input is DocumentArchive {
    if (!isRecord(input)) throw new Error('Archive must be an object.');
    if (input.kind !== DOCUMENT_ARCHIVE_KIND) throw new Error('Archive kind is unsupported.');
    if (input.archiveVersion !== DOCUMENT_ARCHIVE_VERSION) {
        throw new Error('Archive version is unsupported.');
    }
    if (typeof input.exportedAt !== 'string' || !input.exportedAt) {
        throw new Error('Archive exportedAt is required.');
    }
    if (typeof input.appId !== 'string' || !input.appId) throw new Error('Archive appId is required.');
    if (typeof input.docId !== 'string' || !input.docId) throw new Error('Archive docId is required.');
    if (typeof input.schemaFingerprint !== 'string' || !input.schemaFingerprint) {
        throw new Error('Archive schemaFingerprint is required.');
    }
    if (typeof input.schemaFingerprintHash !== 'string' || !input.schemaFingerprintHash) {
        throw new Error('Archive schemaFingerprintHash is required.');
    }
    if (input.exportedBy !== undefined) {
        if (!isRecord(input.exportedBy) || typeof input.exportedBy.actor !== 'string') {
            throw new Error('Archive exportedBy is invalid.');
        }
    }
    assertDocumentPayload(input.payload);
}

function assertDocumentPayload(input: unknown): asserts input is DocumentPayload {
    if (!isRecord(input) || typeof input.kind !== 'string') {
        throw new Error('Archive payload is invalid.');
    }
    switch (input.kind) {
        case 'solo':
            if (!isRecord(input.history)) throw new Error('Solo archive payload is invalid.');
            return;
        case 'local-simulator':
            if (!isRecord(input.replicas) || !isRecord(input.transportState)) {
                throw new Error('Local simulator archive payload is invalid.');
            }
            return;
        case 'peerjs':
            if (!isRecord(input.history)) throw new Error('PeerJS archive payload is invalid.');
            return;
        case 'server':
            if (!isRecord(input.replica)) throw new Error('Server archive payload is invalid.');
            return;
        case 'local-first':
            if (!isRecord(input.replica) || !Array.isArray(input.batches)) {
                throw new Error('Local-first archive payload is invalid.');
            }
            return;
        default:
            throw new Error(`Archive payload kind "${input.kind}" is unsupported.`);
    }
}

function safeFileSegment(input: string) {
    return input.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'document';
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
