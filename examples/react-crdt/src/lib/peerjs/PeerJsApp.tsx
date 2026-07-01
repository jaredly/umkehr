import {useCallback, useEffect, useMemo, useState} from 'react';
import {createCrdtLocalHistory, type CrdtLocalHistory} from 'umkehr/crdt';
import {
    createInitialCrdtHistory,
    hydrateCrdtLocalHistoryForApp,
    initialArtifactsForApp,
    type AppDefinition,
    type CrdtRuntime,
} from '../crdtApp';
import {
    assertArchiveForApp,
    DocumentManagerModal,
    filterUnrealizedSeeds,
    localDocumentModalItems,
    validateCrdtLocalHistoryForApp,
    type DocumentArchive,
    type DocumentModalItem,
    type LocalDocumentSummary,
    type SeedModalItem,
} from '../documentArchive';
import {DemoTopBar, type DemoTopBarProps} from '../chrome/DemoTopBar';
import {schemaFingerprint, schemaFingerprintHash} from '../local-first/schemaFingerprint';
import {
    loadBranchFreeSeedFixtureForApp,
    seedModalItemsForApp,
    seedCrdtHistoryForApp,
} from '../seed/documents';
import {useStore} from '../store';
import {
    readActiveDocIdFromSearch,
    readOptionalActiveDocIdFromSearch,
    urlWithActiveDocId,
} from '../useUrlSelection';
import {PeerJsControls} from './PeerJsControls';
import {
    deletePeerJsDocument,
    listPeerJsDocumentSummaries,
    loadPeerJsDocument,
    savePeerJsDocument,
    type PersistedPeerJsDocument,
} from './persistence';
import type {PeerProtocolConfig} from './protocol';
import type {PeerJsSync, PeerRole} from './types';
import {usePeerJsSync} from './usePeerJsSync';
import {
    loadSerializedArtifacts,
    serializedArtifactsForStore,
    type ArtifactStore,
    type SerializedArtifact,
} from '../artifacts';

export function PeerJsApp<TState, EphemeralData = never>({
    app,
    runtime,
    topBar,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    topBar: DemoTopBarProps;
}) {
    const initialHostPeerId = readInvitePeerId();
    const [role, setRole] = useState<PeerRole>(() => (initialHostPeerId ? 'client' : 'host'));
    const defaultDocId = runtime.docId;
    const requiresDocumentInit = app.documentInit?.required === true;
    const [hasExplicitDoc, setHasExplicitDoc] = useState(
        () => readOptionalActiveDocIdFromSearch(window.location.search) !== undefined,
    );
    const [activeDocId, setActiveDocId] = useState(() =>
        readActiveDocIdFromSearch(window.location.search, defaultDocId),
    );
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const fingerprintHash = useMemo(() => schemaFingerprintHash(app), [app]);
    const [documents, setDocuments] = useState<LocalDocumentSummary[]>([]);
    const [needsDocument, setNeedsDocument] = useState(() => requiresDocumentInit && !hasExplicitDoc);
    const [hostHistory, setHostHistory] = useState(() => createInitialCrdtHistory(app));
    const [hostArtifacts, setHostArtifacts] = useState<SerializedArtifact[]>(() =>
        serializedArtifactsForStore(app.artifacts),
    );
    const activeTitle = documents.find((document) => document.docId === activeDocId)?.title ?? activeDocId;
    const actor = useMemo(() => `${role}-${crypto.randomUUID().slice(0, 8)}`, [role]);
    const protocol = useMemo(
        (): PeerProtocolConfig<TState> => ({
            docId: activeDocId,
            tagKey: app.tagKey,
            schema: app.schema,
            leafPlugins: app.leafPlugins,
            validateState: app.validateState,
        }),
        [activeDocId, app],
    );
    const sync = usePeerJsSync({
        role,
        actor,
        initialDocument: role === 'host' ? hostHistory.doc : undefined,
        initialArtifacts: role === 'host' ? hostArtifacts : [],
        onArtifacts: (artifacts) => loadSerializedArtifacts(app.artifacts, artifacts),
        protocol,
    });
    const {Provider} = runtime;

    const refreshDocuments = useCallback(() => {
        void listPeerJsDocumentSummaries().then(setDocuments);
    }, []);

    useEffect(() => {
        if (role !== 'host') return;
        let alive = true;
        if (requiresDocumentInit && !hasExplicitDoc) {
            setNeedsDocument(true);
            void refreshDocuments();
            return () => {
                alive = false;
            };
        }
        loadOrCreatePeerJsDocument(app, activeDocId, fingerprintHash, !requiresDocumentInit).then((document) => {
            if (!alive) return;
            if (!document) {
                setNeedsDocument(true);
                void refreshDocuments();
                return;
            }
            setNeedsDocument(false);
            setHostHistory(document.history);
            setHostArtifacts(document.artifacts ?? serializedArtifactsForStore(app.artifacts));
            loadSerializedArtifacts(app.artifacts, document.artifacts);
            sync.broadcastSnapshot(
                document.history.doc,
                document.artifacts ?? serializedArtifactsForStore(app.artifacts),
            );
            refreshDocuments();
        });
        return () => {
            alive = false;
        };
    }, [activeDocId, app, fingerprintHash, hasExplicitDoc, refreshDocuments, requiresDocumentInit, role, sync]);

    const switchDocument = useCallback((docId: string) => {
        setHasExplicitDoc(true);
        setNeedsDocument(false);
        window.history.pushState(
            window.history.state,
            '',
            urlWithActiveDocId(window.location.href, docId),
        );
        setActiveDocId(docId);
    }, []);

    const saveHostHistory = useCallback(
        (history: CrdtLocalHistory<TState>) => {
            const artifacts = artifactsForPeerJsHistorySave(app.artifacts);
            setHostHistory(history);
            setHostArtifacts(artifacts);
            sync.setSnapshotDocument(history.doc);
            const now = new Date().toISOString();
            void savePeerJsDocument({
                docId: activeDocId,
                appId: app.id,
                title: activeTitle,
                schemaVersion: app.schemaVersion,
                schemaFingerprintHash: fingerprintHash,
                history,
                artifacts,
                createdAt: now,
                updatedAt: now,
            }).then(refreshDocuments);
        },
        [activeDocId, activeTitle, app, fingerprintHash, refreshDocuments, sync],
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
                    payload: {
                        kind: 'peerjs',
                        history: hostHistory as any,
                        artifacts: hostArtifacts,
                    },
                };
            },
            async importArchive(archive: DocumentArchive) {
                if (role !== 'host') throw new Error('Only a PeerJS host can import a document.');
                assertArchiveForApp(archive, app as any, 'peerjs');
                const imported = validateCrdtLocalHistoryForApp(archive.payload.history, app);
                const artifacts = archive.payload.artifacts ?? serializedArtifactsForStore(app.artifacts);
                const now = new Date().toISOString();
                await savePeerJsDocument({
                    docId: archive.docId,
                    appId: app.id,
                    title: archive.docId,
                    schemaVersion: app.schemaVersion,
                    schemaFingerprintHash: fingerprintHash,
                    history: imported,
                    artifacts,
                    createdAt: now,
                    updatedAt: now,
                });
                setHostHistory(imported);
                setHostArtifacts(artifacts);
                loadSerializedArtifacts(app.artifacts, artifacts);
                sync.broadcastSnapshot(imported.doc, artifacts);
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
    const documentItems = useMemo(
        () => localDocumentModalItems(documents, app.id, 'peerjs'),
        [app.id, documents],
    );
    const seedItems = useMemo(
        () => filterUnrealizedSeeds(seedModalItemsForApp(app, 'peerjs'), documentItems),
        [app, documentItems],
    );
    const createBlankDocument = useCallback(
        async ({docId, title, initParams}: {docId: string; title: string; initParams?: unknown}) => {
            const now = new Date().toISOString();
            await savePeerJsDocument({
                artifacts: initialArtifactsForApp(app, initParams),
                docId,
                appId: app.id,
                title,
                schemaVersion: app.schemaVersion,
                schemaFingerprintHash: fingerprintHash,
                history: createInitialCrdtHistory(app, initParams),
                createdAt: now,
                updatedAt: now,
            });
            refreshDocuments();
        },
        [app, fingerprintHash, refreshDocuments],
    );
    const createSeedDocument = useCallback(
        async (seed: SeedModalItem) => {
            const fixture = loadBranchFreeSeedFixtureForApp(app, seed.docId);
            if (!fixture) throw new Error(`No seed document exists for "${seed.docId}".`);
            const now = new Date().toISOString();
            await savePeerJsDocument({
                docId: fixture.docId,
                appId: app.id,
                title: fixture.title || fixture.docId,
                schemaVersion: fixture.schemaVersion,
                schemaFingerprintHash: fixture.schemaFingerprintHash,
                history: seedCrdtHistoryForApp(app, fixture),
                artifacts: initialArtifactsForApp(app),
                createdAt: fixture.createdAt || now,
                updatedAt: now,
            });
            refreshDocuments();
        },
        [app, refreshDocuments],
    );
    const deleteLocalDocument = useCallback(
        async (document: DocumentModalItem) => {
            await deletePeerJsDocument(document.docId);
            const remaining = (await listPeerJsDocumentSummaries()).filter(
                (summary) =>
                    summary.appId === app.id &&
                    summary.payloadKind === 'peerjs' &&
                    summary.docId !== document.docId,
            );
            setDocuments(remaining);
            if (document.docId === activeDocId) switchDocument(remaining[0]?.docId ?? defaultDocId);
        },
        [activeDocId, app.id, defaultDocId, switchDocument],
    );
    const topBarControls = useMemo(
        () =>
            role === 'host'
                ? {
                      documentPicker: (
                          <DocumentManagerModal
                              documents={documentItems}
                              seeds={seedItems}
                              activeDocId={activeDocId}
                              createOptions={app.documentInit}
                              initialOpen={needsDocument}
                              onSwitchDocument={switchDocument}
                              onCreateDocument={createBlankDocument}
                              onCreateSeed={createSeedDocument}
                              onDeleteLocal={deleteLocalDocument}
                              archiveAdapter={archiveAdapter}
                              onChanged={refreshDocuments}
                          />
                      ),
                  }
                : {
                      statusMessage: (
                          <p className="topBarMessage">PeerJS clients follow the host document.</p>
                      ),
                  },
        [
            activeDocId,
            archiveAdapter,
            createBlankDocument,
            createSeedDocument,
            deleteLocalDocument,
            documentItems,
            refreshDocuments,
            role,
            seedItems,
            switchDocument,
        ],
    );
    return (
        <>
            <DemoTopBar {...topBar} controls={topBarControls} />
            <main className="peerShell">
                <PeerInviteConnector hostPeerId={initialHostPeerId} role={role} sync={sync} />
                <PeerJsControls
                    role={role}
                    setRole={setRole}
                    sync={sync}
                    docId={activeDocId}
                    initialHostPeerId={initialHostPeerId}
                    canInvite={role !== 'host' || !needsDocument}
                />
                {role === 'host' && needsDocument ? (
                    <section className="waitingPanel">
                        <h1>Choose a document</h1>
                        <p>Create or open a document to start.</p>
                    </section>
                ) : role === 'host' ? (
                    <Provider initial={hostHistory} transport={sync.transport} save={saveHostHistory}>
                        <PeerHostDocument actor={actor} sync={sync} app={app} runtime={runtime} />
                    </Provider>
                ) : (
                    <PeerClientDocument actor={actor} sync={sync} app={app} runtime={runtime} />
                )}
            </main>
        </>
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
                        : state.kind === 'error'
                          ? state.message
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

export function artifactsForPeerJsHistorySave(store?: ArtifactStore): SerializedArtifact[] {
    return serializedArtifactsForStore(store);
}

async function loadOrCreatePeerJsDocument<TState, EphemeralData>(
    app: AppDefinition<TState, EphemeralData>,
    docId: string,
    schemaFingerprintHash: string,
    allowCreate = true,
): Promise<PersistedPeerJsDocument<TState> | null> {
    const existing = await loadPeerJsDocument<TState>(docId);
    if (existing && existing.appId === app.id) return hydratePeerJsDocument(existing, app);
    const fixture = loadBranchFreeSeedFixtureForApp(app, docId);
    if (fixture) {
        const now = new Date().toISOString();
            const document: PersistedPeerJsDocument<TState> = {
                docId,
                appId: app.id,
            title: fixture.title || fixture.docId,
            schemaVersion: fixture.schemaVersion,
            schemaFingerprintHash: fixture.schemaFingerprintHash || schemaFingerprintHash,
            history: seedCrdtHistoryForApp(app, fixture),
            artifacts: initialArtifactsForApp(app),
            createdAt: fixture.createdAt || now,
            updatedAt: now,
        };
        await savePeerJsDocument(document);
        return document;
    }
    if (!allowCreate) return null;
    const now = new Date().toISOString();
    const document: PersistedPeerJsDocument<TState> = {
        docId,
        appId: app.id,
        title: docId,
        schemaVersion: app.schemaVersion,
        schemaFingerprintHash,
        history: createInitialCrdtHistory(app),
        artifacts: initialArtifactsForApp(app),
        createdAt: now,
        updatedAt: now,
    };
    await savePeerJsDocument(document);
    return document;
}

function hydratePeerJsDocument<TState, EphemeralData>(
    document: PersistedPeerJsDocument<TState>,
    app: AppDefinition<TState, EphemeralData>,
): PersistedPeerJsDocument<TState> {
    return {
        ...document,
        artifacts: document.artifacts ?? serializedArtifactsForStore(app.artifacts),
        history: hydrateCrdtLocalHistoryForApp(document.history, app),
    };
}
