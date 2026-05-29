import {useMemo, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
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
    schemaVersion: number;
    schemaFingerprintHash: string;
    createdAt: string;
    updatedAt: string;
};

export type DocumentArchiveAdapter = {
    exportArchive(): Promise<DocumentArchive>;
    importArchive(archive: DocumentArchive): Promise<void>;
};

export type DocumentModalSource = 'local' | 'server' | 'local-and-server';

export type DocumentModalItem = {
    docId: string;
    appId: string;
    title: string;
    payloadKind: DocumentPayloadKind;
    schemaVersion: number;
    schemaFingerprintHash: string;
    createdAt: string;
    updatedAt: string;
    source: DocumentModalSource;
    canDeleteLocal: boolean;
    metrics?: {
        sizeLabel?: string;
        branchCount?: number;
        eventCount?: number;
    };
};

export type SeedModalItem = {
    docId: string;
    appId: string;
    title: string;
    payloadKind: DocumentPayloadKind;
    schemaVersion: number;
    schemaFingerprintHash: string;
    createdAt: string;
    updatedAt: string;
    sizeLabel: string;
};

export function localDocumentModalItems(
    documents: LocalDocumentSummary[],
    appId: string,
    payloadKind: DocumentPayloadKind,
): DocumentModalItem[] {
    return sortDocumentItems(
        documents
            .filter((document) => document.appId === appId && document.payloadKind === payloadKind)
            .map((document) => ({
                docId: document.docId,
                appId: document.appId,
                title: document.title || document.docId,
                payloadKind: document.payloadKind,
                schemaVersion: document.schemaVersion,
                schemaFingerprintHash: document.schemaFingerprintHash,
                createdAt: document.createdAt,
                updatedAt: document.updatedAt,
                source: 'local',
                canDeleteLocal: true,
            })),
    );
}

export function filterUnrealizedSeeds(
    seeds: SeedModalItem[],
    documents: Pick<DocumentModalItem, 'docId'>[],
) {
    const realized = new Set(documents.map((document) => document.docId));
    return seeds.filter((seed) => !realized.has(seed.docId));
}

export function sortDocumentItems<T extends Pick<DocumentModalItem, 'title' | 'docId'>>(items: T[]) {
    return [...items].sort(
        (a, b) => (a.title || a.docId).localeCompare(b.title || b.docId) || a.docId.localeCompare(b.docId),
    );
}

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

export function DocumentManagerModal({
    documents,
    seeds,
    activeDocId,
    label = 'Document',
    archiveAdapter,
    onSwitchDocument,
    onCreateDocument,
    onCreateSeed,
    onDeleteLocal,
    onChanged,
}: {
    documents: DocumentModalItem[];
    seeds: SeedModalItem[];
    activeDocId: string;
    label?: string;
    archiveAdapter?: DocumentArchiveAdapter;
    onSwitchDocument(docId: string): void;
    onCreateDocument?(input: {docId: string; title: string}): Promise<void> | void;
    onCreateSeed?(seed: SeedModalItem): Promise<void> | void;
    onDeleteLocal?(document: DocumentModalItem): Promise<void> | void;
    onChanged?(): Promise<unknown> | unknown;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [creatingSeedDocId, setCreatingSeedDocId] = useState<string | null>(null);
    const activeDocument = useMemo(
        () => documents.find((document) => document.docId === activeDocId),
        [activeDocId, documents],
    );
    const triggerTitle = activeDocument?.title || activeDocId;

    async function createDocument(event: FormEvent) {
        event.preventDefault();
        const trimmed = title.trim();
        if (!trimmed || !onCreateDocument) return;
        setMessage(null);
        try {
            await onCreateDocument({docId: crypto.randomUUID(), title: trimmed});
            setTitle('');
            await onChanged?.();
            setMessage('Document created');
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    async function createSeed(seed: SeedModalItem) {
        if (!onCreateSeed) return;
        setMessage(null);
        setCreatingSeedDocId(seed.docId);
        try {
            await onCreateSeed(seed);
            await onChanged?.();
            setMessage(`Created ${seed.title || seed.docId}`);
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            setCreatingSeedDocId(null);
        }
    }

    async function deleteLocal(document: DocumentModalItem) {
        if (!onDeleteLocal) return;
        if (!window.confirm(`Delete the local copy of "${document.title || document.docId}"?`)) {
            return;
        }
        setMessage(null);
        try {
            await onDeleteLocal(document);
            await onChanged?.();
            setMessage('Local copy deleted');
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    async function exportDocument() {
        if (!archiveAdapter) return;
        setMessage(null);
        try {
            downloadJsonArchive(await archiveAdapter.exportArchive());
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    async function importDocument(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file || !archiveAdapter) return;
        setMessage(null);
        try {
            await archiveAdapter.importArchive(parseArchive(await file.text()));
            await onChanged?.();
            setMessage('Document imported');
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    return (
        <div className="documentManager">
            <button
                type="button"
                className="documentManagerTrigger"
                data-testid="document-manager-trigger"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(true)}
            >
                <span>{label}</span>
                <strong>{triggerTitle}</strong>
                {activeDocument ? <SourceBadge source={activeDocument.source} /> : null}
            </button>
            {open ? (
                <div className="documentModalOverlay" onMouseDown={() => setOpen(false)}>
                    <section
                        className="documentModal"
                        data-testid="document-manager-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Documents"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <header className="documentModalHeader">
                            <h1>Documents</h1>
                            <button type="button" onClick={() => setOpen(false)} aria-label="Close documents">
                                Close
                            </button>
                        </header>

                        <div className="documentModalActions">
                            {archiveAdapter ? (
                                <>
                                    <button type="button" onClick={() => void exportDocument()}>
                                        Export current
                                    </button>
                                    <button type="button" onClick={() => inputRef.current?.click()}>
                                        Import
                                    </button>
                                    <input
                                        ref={inputRef}
                                        type="file"
                                        accept="application/json,.json"
                                        className="documentArchiveInput"
                                        data-testid="document-archive-input"
                                        onChange={(event) => void importDocument(event)}
                                    />
                                </>
                            ) : null}
                        </div>

                        {onCreateDocument ? (
                            <form className="documentCreateForm" onSubmit={(event) => void createDocument(event)}>
                                <input
                                    value={title}
                                    onChange={(event) => setTitle(event.currentTarget.value)}
                                    placeholder="New document title"
                                    aria-label="New document title"
                                />
                                <button type="submit" disabled={!title.trim()}>
                                    New document
                                </button>
                            </form>
                        ) : null}

                        <section className="documentModalSection">
                            <h2>Documents</h2>
                            {documents.length ? (
                                <div className="documentRows">
                                    {documents.map((document) => (
                                        <DocumentRow
                                            key={document.docId}
                                            document={document}
                                            current={document.docId === activeDocId}
                                            onOpen={() => {
                                                onSwitchDocument(document.docId);
                                                setOpen(false);
                                            }}
                                            onDeleteLocal={
                                                document.canDeleteLocal && onDeleteLocal
                                                    ? () => void deleteLocal(document)
                                                    : undefined
                                            }
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="documentModalMessage">No documents.</p>
                            )}
                        </section>

                        <section className="documentModalSection">
                            <h2>Seed fixtures</h2>
                            {seeds.length ? (
                                <div className="documentRows">
                                    {seeds.map((seed) => (
                                        <SeedRow
                                            key={seed.docId}
                                            seed={seed}
                                            creating={creatingSeedDocId === seed.docId}
                                            onCreate={onCreateSeed ? () => void createSeed(seed) : undefined}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="documentModalMessage">No unrealized seeds.</p>
                            )}
                        </section>

                        {message ? <p className="documentModalStatus">{message}</p> : null}
                    </section>
                </div>
            ) : null}
        </div>
    );
}

function DocumentRow({
    document,
    current,
    onOpen,
    onDeleteLocal,
}: {
    document: DocumentModalItem;
    current: boolean;
    onOpen(): void;
    onDeleteLocal?: () => void;
}) {
    return (
        <article
            className="documentRow"
            data-testid="document-row"
            data-doc-id={document.docId}
            data-payload-kind={document.payloadKind}
            data-source={document.source}
        >
            <div className="documentRowMain">
                <div className="documentRowTitle">
                    <strong>{document.title || document.docId}</strong>
                    {current ? <span className="documentBadge">current</span> : null}
                    <SourceBadge source={document.source} />
                </div>
                <div className="documentRowMeta">
                    <span>{document.docId}</span>
                    <span>v{document.schemaVersion}</span>
                    <span>{document.schemaFingerprintHash.slice(0, 12)}</span>
                    {document.metrics?.sizeLabel ? <span>{document.metrics.sizeLabel}</span> : null}
                    {document.metrics?.eventCount !== undefined ? (
                        <span>{document.metrics.eventCount} events</span>
                    ) : null}
                    {document.metrics?.branchCount !== undefined ? (
                        <span>{document.metrics.branchCount} branches</span>
                    ) : null}
                </div>
            </div>
            <div className="documentRowActions">
                <button type="button" disabled={current} onClick={onOpen}>
                    Open
                </button>
                {onDeleteLocal ? (
                    <button type="button" className="dangerButton" onClick={onDeleteLocal}>
                        Delete local
                    </button>
                ) : null}
            </div>
        </article>
    );
}

function SeedRow({
    seed,
    creating,
    onCreate,
}: {
    seed: SeedModalItem;
    creating: boolean;
    onCreate?: () => void;
}) {
    return (
        <article
            className="documentRow seedRow"
            data-testid="seed-document-row"
            data-doc-id={seed.docId}
            data-payload-kind={seed.payloadKind}
        >
            <div className="documentRowMain">
                <div className="documentRowTitle">
                    <strong>{seed.title || seed.docId}</strong>
                    <span className="documentBadge">seed</span>
                </div>
                <div className="documentRowMeta">
                    <span>{seed.docId}</span>
                    <span>v{seed.schemaVersion}</span>
                    <span>{seed.schemaFingerprintHash.slice(0, 12)}</span>
                    <span>{seed.sizeLabel}</span>
                </div>
            </div>
            <div className="documentRowActions">
                {onCreate ? (
                    <button type="button" disabled={creating} onClick={onCreate}>
                        {creating ? 'Creating...' : 'Create'}
                    </button>
                ) : null}
            </div>
        </article>
    );
}

function SourceBadge({source}: {source: DocumentModalSource}) {
    const label =
        source === 'local-and-server' ? 'local + server' : source === 'server' ? 'server' : 'local';
    return <span className={`documentBadge source-${source}`}>{label}</span>;
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
