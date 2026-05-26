import {useCallback, useEffect, useMemo, useState} from 'react';
import {createCrdtLocalHistory, type CrdtLocalHistory} from 'umkehr/crdt';
import {createInitialCrdtHistory, type AppDefinition, type CrdtRuntime} from '../crdtApp';
import {
    assertArchiveForApp,
    DocumentArchiveControls,
    DocumentPicker,
    readActiveDocIdFromSearch,
    urlWithActiveDocId,
    validateCrdtLocalHistoryForApp,
    type DocumentArchive,
    type LocalDocumentSummary,
} from '../documentArchive';
import {schemaFingerprint, schemaFingerprintHash} from '../local-first/schemaFingerprint';
import {loadBranchFreeSeedFixtureForApp, seedCrdtHistoryForApp} from '../seed/documents';
import {SeedDocumentPicker} from '../seed/SeedDocumentPicker';
import {useStore} from '../store';
import {PeerJsControls} from './PeerJsControls';
import {
    listPeerJsDocumentSummaries,
    loadPeerJsDocument,
    savePeerJsDocument,
    type PersistedPeerJsDocument,
} from './persistence';
import type {PeerProtocolConfig} from './protocol';
import type {PeerJsSync, PeerRole} from './types';
import {usePeerJsSync} from './usePeerJsSync';

export function PeerJsApp<TState, EphemeralData = never>({
    app,
    runtime,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
}) {
    const initialHostPeerId = readInvitePeerId();
    const [role, setRole] = useState<PeerRole>(() => (initialHostPeerId ? 'client' : 'host'));
    const defaultDocId = runtime.docId;
    const [activeDocId, setActiveDocId] = useState(() =>
        readActiveDocIdFromSearch(window.location.search, defaultDocId),
    );
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const fingerprintHash = useMemo(() => schemaFingerprintHash(app), [app]);
    const [documents, setDocuments] = useState<LocalDocumentSummary[]>([]);
    const [hostHistory, setHostHistory] = useState(() => createInitialCrdtHistory(app));
    const actor = useMemo(() => `${role}-${crypto.randomUUID().slice(0, 8)}`, [role]);
    const protocol = useMemo(
        (): PeerProtocolConfig<TState> => ({
            docId: activeDocId,
            tagKey: app.tagKey,
            schema: app.schema,
            validateState: app.validateState,
        }),
        [activeDocId, app],
    );
    const sync = usePeerJsSync({
        role,
        actor,
        initialDocument: role === 'host' ? hostHistory.doc : undefined,
        protocol,
    });
    const {Provider} = runtime;

    const refreshDocuments = useCallback(() => {
        void listPeerJsDocumentSummaries().then(setDocuments);
    }, []);

    useEffect(() => {
        if (role !== 'host') return;
        let alive = true;
        loadOrCreatePeerJsDocument(app, activeDocId, fingerprintHash).then((document) => {
            if (!alive) return;
            setHostHistory(document.history);
            sync.setSnapshotDocument(document.history.doc);
            refreshDocuments();
        });
        return () => {
            alive = false;
        };
    }, [activeDocId, app, fingerprintHash, refreshDocuments, role, sync]);

    const switchDocument = useCallback((docId: string) => {
        window.history.pushState(
            window.history.state,
            '',
            urlWithActiveDocId(window.location.href, docId),
        );
        setActiveDocId(docId);
    }, []);

    const importSeedDocument = useCallback(
        async (docId: string) => {
            if (role !== 'host') return;
            const fixture = loadBranchFreeSeedFixtureForApp(app, docId);
            if (!fixture) throw new Error(`No seed document exists for "${docId}".`);
            const now = new Date().toISOString();
            const history = seedCrdtHistoryForApp(app, fixture);
            await savePeerJsDocument({
                docId: fixture.docId,
                appId: app.id,
                schemaFingerprintHash: fingerprintHash,
                history,
                createdAt: fixture.createdAt || now,
                updatedAt: now,
            });
            setHostHistory(history);
            sync.setSnapshotDocument(history.doc);
            switchDocument(fixture.docId);
            refreshDocuments();
        },
        [app, fingerprintHash, refreshDocuments, role, switchDocument, sync],
    );

    const saveHostHistory = useCallback(
        (history: CrdtLocalHistory<TState>) => {
            setHostHistory(history);
            sync.setSnapshotDocument(history.doc);
            const now = new Date().toISOString();
            void savePeerJsDocument({
                docId: activeDocId,
                appId: app.id,
                schemaFingerprintHash: fingerprintHash,
                history,
                createdAt: now,
                updatedAt: now,
            }).then(refreshDocuments);
        },
        [activeDocId, app.id, fingerprintHash, refreshDocuments, sync],
    );

    const archiveAdapter = useMemo(
        () => ({
            async exportArchive(): Promise<DocumentArchive> {
                return {
                    kind: 'umkehr.react-crdt.document',
                    archiveVersion: 1,
                    exportedAt: new Date().toISOString(),
                    appId: app.id,
                    docId: activeDocId,
                    schemaFingerprint: fingerprint,
                    schemaFingerprintHash: fingerprintHash,
                    exportedBy: {actor},
                    payload: {kind: 'peerjs', history: hostHistory as any},
                };
            },
            async importArchive(archive: DocumentArchive) {
                if (role !== 'host') throw new Error('Only a PeerJS host can import a document.');
                assertArchiveForApp(archive, app as any, 'peerjs');
                const imported = validateCrdtLocalHistoryForApp(archive.payload.history, app);
                const now = new Date().toISOString();
                await savePeerJsDocument({
                    docId: archive.docId,
                    appId: app.id,
                    schemaFingerprintHash: fingerprintHash,
                    history: imported,
                    createdAt: now,
                    updatedAt: now,
                });
                setHostHistory(imported);
                sync.setSnapshotDocument(imported.doc);
                switchDocument(archive.docId);
                refreshDocuments();
            },
        }),
        [
            activeDocId,
            actor,
            app,
            fingerprint,
            fingerprintHash,
            hostHistory,
            refreshDocuments,
            role,
            switchDocument,
            sync,
        ],
    );

    return (
        <main className="peerShell">
            <PeerInviteConnector hostPeerId={initialHostPeerId} role={role} sync={sync} />
            {role === 'host' ? (
                <div className="documentToolbar">
                    <DocumentPicker
                        documents={documents}
                        activeDocId={activeDocId}
                        appId={app.id}
                        payloadKind="peerjs"
                        onSwitchDocument={switchDocument}
                    />
                    <SeedDocumentPicker
                        appId={app.id}
                        payloadKind="peerjs"
                        onImportSeed={importSeedDocument}
                    />
                    <DocumentArchiveControls
                        adapter={archiveAdapter}
                        appId={app.id}
                        docId={activeDocId}
                        payloadKind="peerjs"
                    />
                </div>
            ) : null}
            <PeerJsControls
                role={role}
                setRole={setRole}
                sync={sync}
                docId={activeDocId}
                initialHostPeerId={initialHostPeerId}
            />
            {role === 'host' ? (
                <Provider initial={hostHistory} transport={sync.transport} save={saveHostHistory}>
                    <PeerHostDocument actor={actor} sync={sync} app={app} runtime={runtime} />
                </Provider>
            ) : (
                <PeerClientDocument actor={actor} sync={sync} app={app} runtime={runtime} />
            )}
        </main>
    );
}

function PeerInviteConnector<TState>({
    hostPeerId,
    role,
    sync,
}: {
    hostPeerId: string;
    role: PeerRole;
    sync: PeerJsSync<TState>;
}) {
    const state = useStore(sync.stateStore);
    const connections = useStore(sync.connectionsStore);
    const hasConnected = connections.some((connection) => connection.peerId === hostPeerId);

    useEffect(() => {
        if (!hostPeerId || role !== 'client' || hasConnected || state.kind !== 'ready') return;
        sync.connect(hostPeerId);
    }, [hasConnected, hostPeerId, role, state.kind, sync]);

    return null;
}

function PeerHostDocument<TState, EphemeralData>({
    actor,
    sync,
    app,
    runtime,
}: {
    actor: string;
    sync: PeerJsSync<TState>;
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
}) {
    const editor = runtime.useEditorContext();
    const history = editor.useLocalHistory();

    useEffect(() => {
        sync.setSnapshotDocument(history.doc);
    }, [history.doc, sync]);

    return app.renderPanel({
        actor,
        editor,
        title: `Host ${app.title}`,
    });
}

function PeerClientDocument<TState, EphemeralData>({
    actor,
    sync,
    app,
    runtime,
}: {
    actor: string;
    sync: PeerJsSync<TState>;
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
}) {
    const snapshot = useStore(sync.snapshotStore);
    const state = useStore(sync.stateStore);
    const initial = useMemo(() => (snapshot ? createCrdtLocalHistory(snapshot) : null), [snapshot]);
    const {Provider} = runtime;

    if (!initial) {
        return (
            <section className="waitingPanel">
                <h1>Waiting for host snapshot</h1>
                <p>
                    {state.kind === 'waiting-for-snapshot'
                        ? `Connected to ${state.hostPeerId}`
                        : 'Enter the host Peer ID to join.'}
                </p>
            </section>
        );
    }

    return (
        <Provider initial={initial} transport={sync.transport}>
            <PeerClientPanel actor={actor} app={app} runtime={runtime} />
        </Provider>
    );
}

function PeerClientPanel<TState, EphemeralData>({
    actor,
    app,
    runtime,
}: {
    actor: string;
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
}) {
    const editor = runtime.useEditorContext();

    return app.renderPanel({
        actor,
        editor,
        title: `Client ${app.title}`,
    });
}

function readInvitePeerId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('peer')?.trim() ?? '';
}

async function loadOrCreatePeerJsDocument<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    docId: string,
    schemaFingerprintHash: string,
): Promise<PersistedPeerJsDocument<TState>> {
    const existing = await loadPeerJsDocument<TState>(docId);
    if (existing && existing.appId === app.id) return existing;
    const fixture = loadBranchFreeSeedFixtureForApp(app, docId);
    if (fixture) {
        const now = new Date().toISOString();
        const document: PersistedPeerJsDocument<TState> = {
            docId,
            appId: app.id,
            schemaFingerprintHash,
            history: seedCrdtHistoryForApp(app, fixture),
            createdAt: fixture.createdAt || now,
            updatedAt: now,
        };
        await savePeerJsDocument(document);
        return document;
    }
    const now = new Date().toISOString();
    const document: PersistedPeerJsDocument<TState> = {
        docId,
        appId: app.id,
        schemaFingerprintHash,
        history: createInitialCrdtHistory(app),
        createdAt: now,
        updatedAt: now,
    };
    await savePeerJsDocument(document);
    return document;
}
