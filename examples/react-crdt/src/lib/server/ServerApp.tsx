import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {hlc, type CrdtUpdate} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import {
    createInitialCrdtHistory,
    hydrateCrdtLocalHistoryForApp,
    initialArtifactsForApp,
    type AppDefinition,
    type CrdtRuntime,
} from '../crdtApp';
import {useStore} from '../store';
import {schemaFingerprint, schemaFingerprintHash} from '../local-first/schemaFingerprint';
import {
    assertArchiveForApp,
    DocumentManagerModal,
    filterUnrealizedSeeds,
    validateCrdtUpdatesForApp,
    type DocumentArchive,
    type DocumentModalItem,
    type SeedModalItem,
} from '../documentArchive';
import {DemoTopBar, type DemoTopBarProps} from '../chrome/DemoTopBar';
import {ServerControls} from './ServerControls';
import {ServerHistoryView} from './ServerHistoryView';
import {
    clearServerUser,
    deleteServerReplica,
    loadServerUser,
    loadServerReplica,
    listServerReplicas,
    saveServerReplica,
    saveServerUser,
} from './persistence';
import {SERVER_HTTP_URL, SERVER_PROTOCOL_VERSION} from './protocol';
import {actorForSession, ensureServerSessionId} from './session';
import {useServerSync} from './useServerSync';
import {migrateServerReplica, normalizeServerReplica} from './migration';
import {defaultServerSchemaConfig, type ServerSchemaConfig} from './schemaConfig';
import {parseServerDocumentsResponse} from './documents';
import {loadBranchFreeSeedFixtureForApp, seedModalItemsForApp} from '../seed/documents';
import {createServerClientSeedReplica} from '../seed/serverClient';
import {urlWithActiveDocId} from '../useUrlSelection';
import type {
    PersistedServerReplica,
    ServerDocumentSummary,
    ServerOldPendingChangesPolicy,
    ServerSessionIdentity,
    ServerSync,
    ServerUser,
} from './types';
import {
    loadSerializedArtifacts,
    serializedArtifactsForStore,
} from '../artifacts';

type Loaded<TState> = {
    identity: ServerSessionIdentity;
    replica: PersistedServerReplica<TState>;
    source: 'created' | 'loaded';
};

type LoadState<TState> =
    | {kind: 'loading'}
    | {kind: 'needsUser'; sessionId: string; users: ServerUser[]; message?: string}
    | {kind: 'needsDocument'; identity: ServerSessionIdentity}
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'error'; message: string};

type DocumentsState =
    | {
          kind: 'loading';
          remoteDocuments: ServerDocumentSummary[];
          localDocuments: ServerDocumentSummary[];
      }
    | {
          kind: 'ready';
          remoteDocuments: ServerDocumentSummary[];
          localDocuments: ServerDocumentSummary[];
      }
    | {
          kind: 'error';
          remoteDocuments: ServerDocumentSummary[];
          localDocuments: ServerDocumentSummary[];
          message: string;
      };

export function ServerApp<TState, EphemeralData = never>({
    app,
    runtime,
    schemaConfig: schemaConfigProp,
    oldPendingChangesPolicy = {kind: 'auto-merge'},
    topBar,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    schemaConfig?: ServerSchemaConfig<TState>;
    oldPendingChangesPolicy?: ServerOldPendingChangesPolicy;
    topBar: DemoTopBarProps;
}) {
    const requiresDocumentInit = app.documentInit?.required === true;
    const [hasExplicitDoc, setHasExplicitDoc] = useState(() => readActiveDocId() !== undefined);
    const [activeDocId, setActiveDocId] = useState(() => readActiveDocId() ?? runtime.docId);
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const fingerprintHash = useMemo(() => schemaFingerprintHash(app), [app]);
    const schemaConfig = useMemo(
        () => schemaConfigProp ?? defaultServerSchemaConfig<TState>(),
        [schemaConfigProp],
    );
    const [loadState, setLoadState] = useState<LoadState<TState>>({kind: 'loading'});
    const [documentsState, setDocumentsState] = useState<DocumentsState>({
        kind: 'loading',
        remoteDocuments: [],
        localDocuments: [],
    });

    useEffect(() => {
        let alive = true;
        setDocumentsState((current) => ({
            kind: 'loading',
            remoteDocuments: current.remoteDocuments,
            localDocuments: current.localDocuments,
        }));
        Promise.all([fetchServerDocuments().catch(() => []), listLocalServerDocuments()])
            .then(([remoteDocuments, localDocuments]) => {
                if (alive) setDocumentsState({kind: 'ready', remoteDocuments, localDocuments});
            })
            .catch((error) => {
                if (!alive) return;
                setDocumentsState((current) => ({
                    kind: 'error',
                    remoteDocuments: current.remoteDocuments,
                    localDocuments: current.localDocuments,
                    message: error instanceof Error ? error.message : String(error),
                }));
            });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        let alive = true;
        setLoadState({kind: 'loading'});
        bootstrapInitialState(
            app,
            activeDocId,
            fingerprint,
            fingerprintHash,
            schemaConfig,
            !requiresDocumentInit,
            requiresDocumentInit && !hasExplicitDoc,
        )
            .then((loaded) => {
                if (!alive) return;
                if (loaded.kind === 'ready') {
                    setLoadState({kind: 'ready', loaded: loaded.loaded});
                } else {
                    setLoadState(loaded);
                }
            })
            .catch((error) => {
                if (!alive) return;
                setLoadState({
                    kind: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            });
        return () => {
            alive = false;
        };
    }, [activeDocId, app, fingerprint, fingerprintHash, hasExplicitDoc, requiresDocumentInit, schemaConfig]);

    const login = useCallback(
        async (sessionId: string, nickname: string) => {
            setLoadState({kind: 'loading'});
            try {
                const user = await loginServerUser(nickname);
                await saveServerUser(user);
                const identity = createSessionIdentity(user, sessionId);
                if (requiresDocumentInit && !hasExplicitDoc) {
                    setLoadState({kind: 'needsDocument', identity});
                    return;
                }
                const loaded = await loadInitialState(
                    app,
                    activeDocId,
                    fingerprint,
                    fingerprintHash,
                    schemaConfig,
                    identity,
                    !requiresDocumentInit,
                );
                setLoadState(loaded ? {kind: 'ready', loaded} : {kind: 'needsDocument', identity});
            } catch (error) {
                const users = await fetchKnownUsers().catch(() => []);
                setLoadState({
                    kind: 'needsUser',
                    sessionId,
                    users,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [activeDocId, app, fingerprint, fingerprintHash, hasExplicitDoc, requiresDocumentInit, schemaConfig],
    );

    const logout = useCallback(async () => {
        const sessionId = ensureServerSessionId();
        await clearServerUser();
        const users = await fetchKnownUsers().catch(() => []);
        setLoadState({kind: 'needsUser', sessionId, users});
    }, []);

    const switchDocument = useCallback(
        (docId: string) => {
            const nextDocId = docId.trim();
            if (!nextDocId || nextDocId === activeDocId) return;
            setHasExplicitDoc(true);
            writeActiveDocId(nextDocId);
            setActiveDocId(nextDocId);
        },
        [activeDocId],
    );

    if (loadState.kind === 'loading') {
        return (
            <>
                <DemoTopBar {...topBar} />
                <main className="serverShell">
                    <section className="waitingPanel">
                        <h1>Loading server replica</h1>
                        <p>Reading durable state from this browser.</p>
                    </section>
                </main>
            </>
        );
    }

    if (loadState.kind === 'error') {
        return (
            <>
                <DemoTopBar {...topBar} />
                <main className="serverShell">
                    <section className="waitingPanel">
                        <h1>Server replica unavailable</h1>
                        <p>{loadState.message}</p>
                    </section>
                </main>
            </>
        );
    }

    if (loadState.kind === 'needsUser') {
        return (
            <>
                <DemoTopBar {...topBar} />
                <main className="serverShell">
                    <ServerLogin
                        users={loadState.users}
                        message={loadState.message}
                        onLogin={(nickname) => void login(loadState.sessionId, nickname)}
                    />
                </main>
            </>
        );
    }

    if (loadState.kind === 'needsDocument') {
        return (
            <ServerNeedsDocumentApp
                app={app}
                docId={activeDocId}
                remoteDocuments={documentsState.remoteDocuments}
                localDocuments={documentsState.localDocuments}
                documentsUnavailableMessage={
                    documentsState.kind === 'error' ? documentsState.message : undefined
                }
                onSwitchDocument={switchDocument}
                onDocumentsChanged={(remoteDocuments, localDocuments) =>
                    setDocumentsState({kind: 'ready', remoteDocuments, localDocuments})
                }
                schemaFingerprint={fingerprint}
                schemaFingerprintHash={fingerprintHash}
                schemaConfig={schemaConfig}
                topBar={topBar}
            />
        );
    }

    return (
        <ServerReadyApp
            key={activeDocId}
            app={app}
            runtime={runtime}
            docId={activeDocId}
            remoteDocuments={documentsState.remoteDocuments}
            localDocuments={documentsState.localDocuments}
            documentsUnavailableMessage={
                documentsState.kind === 'error' ? documentsState.message : undefined
            }
            onSwitchDocument={switchDocument}
            onDocumentsChanged={(remoteDocuments, localDocuments) =>
                setDocumentsState({kind: 'ready', remoteDocuments, localDocuments})
            }
            schemaFingerprint={fingerprint}
            schemaFingerprintHash={fingerprintHash}
            schemaConfig={schemaConfig}
            oldPendingChangesPolicy={oldPendingChangesPolicy}
            loaded={loadState.loaded}
            onLogout={() => void logout()}
            topBar={topBar}
        />
    );
}

function ServerNeedsDocumentApp<TState, EphemeralData>({
    app,
    docId,
    remoteDocuments,
    localDocuments,
    documentsUnavailableMessage,
    onSwitchDocument,
    onDocumentsChanged,
    schemaFingerprint,
    schemaFingerprintHash,
    schemaConfig,
    topBar,
}: {
    app: AppDefinition<TState, EphemeralData>;
    docId: string;
    remoteDocuments: ServerDocumentSummary[];
    localDocuments: ServerDocumentSummary[];
    documentsUnavailableMessage?: string;
    onSwitchDocument(docId: string): void;
    onDocumentsChanged(
        remoteDocuments: ServerDocumentSummary[],
        localDocuments: ServerDocumentSummary[],
    ): void;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    schemaConfig: ServerSchemaConfig<TState>;
    topBar: DemoTopBarProps;
}) {
    const refreshDocuments = useCallback(async () => {
        const [nextRemoteDocuments, nextLocalDocuments] = await Promise.all([
            fetchServerDocuments().catch(() => remoteDocuments),
            listLocalServerDocuments(),
        ]);
        onDocumentsChanged(nextRemoteDocuments, nextLocalDocuments);
    }, [onDocumentsChanged, remoteDocuments]);
    const documentItems = useMemo(
        () =>
            classifyServerDocumentItems({
                appId: app.id,
                remoteDocuments,
                localDocuments,
            }),
        [app.id, localDocuments, remoteDocuments],
    );
    const seedItems = useMemo(
        () => filterUnrealizedSeeds(seedModalItemsForApp(app, 'server'), documentItems),
        [app, documentItems],
    );
    const createBlankDocument = useCallback(
        async ({docId: nextDocId, title, initParams}: {docId: string; title: string; initParams?: unknown}) => {
            await saveBlankServerReplica({
                app,
                docId: nextDocId,
                title,
                schemaVersion: schemaConfig.version,
                schemaFingerprint,
                schemaFingerprintHash,
                initParams,
            });
            await refreshDocuments();
        },
        [app, refreshDocuments, schemaConfig.version, schemaFingerprint, schemaFingerprintHash],
    );
    const createSeedDocument = useCallback(
        async (seed: SeedModalItem) => {
            const fixture = loadBranchFreeSeedFixtureForApp(app, seed.docId);
            if (!fixture) throw new Error(`No seed document exists for "${seed.docId}".`);
            await saveServerReplica({
                ...createServerClientSeedReplica({fixture, scenario: 'cached'}),
                title: fixture.title || fixture.docId,
                artifacts: initialArtifactsForApp(app),
            });
            await refreshDocuments();
        },
        [app, refreshDocuments],
    );
    const deleteLocalDocument = useCallback(
        async (document: DocumentModalItem) => {
            await deleteServerReplica(document.docId);
            await refreshDocuments();
        },
        [refreshDocuments],
    );
    const topBarControls = useMemo(
        () => ({
            documentPicker: (
                <DocumentManagerModal
                    documents={documentItems}
                    seeds={seedItems}
                    activeDocId={docId}
                    createOptions={app.documentInit}
                    initialOpen
                    onSwitchDocument={onSwitchDocument}
                    onCreateDocument={createBlankDocument}
                    onCreateSeed={createSeedDocument}
                    onDeleteLocal={deleteLocalDocument}
                    onChanged={() => void refreshDocuments()}
                />
            ),
            statusMessage: documentsUnavailableMessage ? (
                <p className="topBarMessage">{documentsUnavailableMessage}</p>
            ) : null,
        }),
        [
            app.documentInit,
            createBlankDocument,
            createSeedDocument,
            deleteLocalDocument,
            docId,
            documentItems,
            documentsUnavailableMessage,
            onSwitchDocument,
            refreshDocuments,
            seedItems,
        ],
    );
    return (
        <>
            <DemoTopBar {...topBar} controls={topBarControls} />
            <main className="serverShell">
                <section className="waitingPanel">
                    <h1>Choose a document</h1>
                    <p>Create or open a document to start.</p>
                </section>
            </main>
        </>
    );
}

function ServerReadyApp<TState, EphemeralData>({
    app,
    runtime,
    docId,
    remoteDocuments,
    localDocuments,
    documentsUnavailableMessage,
    onSwitchDocument,
    onDocumentsChanged,
    schemaFingerprint,
    schemaFingerprintHash,
    schemaConfig,
    oldPendingChangesPolicy,
    loaded,
    onLogout,
    topBar,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    docId: string;
    remoteDocuments: ServerDocumentSummary[];
    localDocuments: ServerDocumentSummary[];
    documentsUnavailableMessage?: string;
    onSwitchDocument(docId: string): void;
    onDocumentsChanged(
        remoteDocuments: ServerDocumentSummary[],
        localDocuments: ServerDocumentSummary[],
    ): void;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    schemaConfig: ServerSchemaConfig<TState>;
    oldPendingChangesPolicy: ServerOldPendingChangesPolicy;
    loaded: Loaded<TState>;
    onLogout(): void;
    topBar: DemoTopBarProps;
}) {
    const activeBranch = loaded.replica.branches[loaded.replica.activeBranchId];
    const [currentHistory, setCurrentHistory] = useState(activeBranch.history);
    const sync = useServerSync({
        app,
        docId,
        title: loaded.replica.title || docId,
        schema: app.schema,
        schemaVersion: loaded.replica.schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
        schemaConfig,
        oldPendingChangesPolicy,
        identity: loaded.identity,
        initialReplica: loaded.replica,
        replaceHistory: setCurrentHistory,
    });
    const syncState = useStore(sync.stateStore);
    const {Provider} = runtime;
    const refreshDocuments = useCallback(async () => {
        const [nextRemoteDocuments, nextLocalDocuments] = await Promise.all([
            fetchServerDocuments().catch(() => remoteDocuments),
            listLocalServerDocuments(),
        ]);
        onDocumentsChanged(nextRemoteDocuments, nextLocalDocuments);
    }, [onDocumentsChanged, remoteDocuments]);
    const archiveAdapter = useMemo(
        () => ({
            async exportArchive(): Promise<DocumentArchive> {
                return {
                    kind: 'umkehr.react-crdt.document',
                    archiveVersion: 1,
                    exportedAt: new Date().toISOString(),
                    appId: app.id,
                    docId,
                    schemaVersion: schemaConfig.version,
                    schemaFingerprint,
                    schemaFingerprintHash,
                    exportedBy: {actor: loaded.identity.actor},
                    payload: {
                        kind: 'server',
                        replica: sync.exportReplica() as any,
                        artifacts: sync.exportReplica().artifacts ?? serializedArtifactsForStore(app.artifacts),
                    },
                };
            },
            async importArchive(archive: DocumentArchive) {
                assertArchiveForApp(archive, app as any, 'server');
                const replica = archive.payload.replica as PersistedServerReplica<TState>;
                const artifacts =
                    archive.payload.artifacts ??
                    replica.artifacts ??
                    serializedArtifactsForStore(app.artifacts);
                loadSerializedArtifacts(app.artifacts, artifacts);
                if (replica.appId && replica.appId !== app.id) {
                    throw new Error('Archive server replica belongs to another app.');
                }
                if (replica.schemaFingerprintHash !== schemaFingerprintHash) {
                    throw new Error('Archive schema does not match this app version.');
                }
                for (const branch of Object.values(replica.branches)) {
                    for (const event of branch.events) {
                        if (event.kind === 'update') validateCrdtUpdatesForApp([event.update], app);
                    }
                }
                const normalized = hydrateServerReplica(
                    {...replica, appId: app.id, storageVersion: 4 as const, artifacts},
                    app,
                );
                await saveServerReplica(normalized);
                sync.replaceReplica(normalized);
                onSwitchDocument(archive.docId);
                await refreshDocuments();
            },
        }),
        [
            app,
            docId,
            loaded.identity.actor,
            onSwitchDocument,
            refreshDocuments,
            schemaConfig.version,
            schemaFingerprint,
            schemaFingerprintHash,
            sync,
        ],
    );
    const documentItems = useMemo(
        () =>
            classifyServerDocumentItems({
                appId: app.id,
                remoteDocuments,
                localDocuments: [...localDocuments, summaryForServerReplica(loaded.replica)],
            }),
        [app.id, loaded.replica, localDocuments, remoteDocuments],
    );
    const seedItems = useMemo(
        () => filterUnrealizedSeeds(seedModalItemsForApp(app, 'server'), documentItems),
        [app, documentItems],
    );
    const createBlankDocument = useCallback(
        async ({docId: nextDocId, title, initParams}: {docId: string; title: string; initParams?: unknown}) => {
            await saveBlankServerReplica({
                app,
                docId: nextDocId,
                title,
                schemaVersion: schemaConfig.version,
                schemaFingerprint,
                schemaFingerprintHash,
                initParams,
            });
            await refreshDocuments();
        },
        [app, refreshDocuments, schemaConfig.version, schemaFingerprint, schemaFingerprintHash],
    );
    const createSeedDocument = useCallback(
        async (seed: SeedModalItem) => {
            const fixture = loadBranchFreeSeedFixtureForApp(app, seed.docId);
            if (!fixture) throw new Error(`No seed document exists for "${seed.docId}".`);
            await saveServerReplica({
                ...createServerClientSeedReplica({fixture, scenario: 'cached'}),
                title: fixture.title || fixture.docId,
                artifacts: initialArtifactsForApp(app),
            });
            await refreshDocuments();
        },
        [app, refreshDocuments],
    );
    const deleteLocalDocument = useCallback(
        async (document: DocumentModalItem) => {
            await deleteServerReplica(document.docId);
            await refreshDocuments();
            if (document.docId === docId) {
                const fallback = documentItems.find((item) => item.docId !== document.docId);
                onSwitchDocument(fallback?.docId ?? runtime.docId);
            }
        },
        [docId, documentItems, onSwitchDocument, refreshDocuments, runtime.docId],
    );
    const topBarControls = useMemo(
        () => ({
            documentPicker: (
                <DocumentManagerModal
                    documents={documentItems}
                    seeds={seedItems}
                    activeDocId={docId}
                    createOptions={app.documentInit}
                    onSwitchDocument={onSwitchDocument}
                    onCreateDocument={createBlankDocument}
                    onCreateSeed={createSeedDocument}
                    onDeleteLocal={deleteLocalDocument}
                    archiveAdapter={archiveAdapter}
                    onChanged={() => void refreshDocuments()}
                />
            ),
            statusMessage: documentsUnavailableMessage ? (
                <p className="topBarMessage">{documentsUnavailableMessage}</p>
            ) : null,
        }),
        [
            archiveAdapter,
            createBlankDocument,
            createSeedDocument,
            deleteLocalDocument,
            docId,
            documentItems,
            documentsUnavailableMessage,
            onSwitchDocument,
            refreshDocuments,
            seedItems,
        ],
    );
    return (
        <>
            <DemoTopBar {...topBar} controls={topBarControls} />
            <main className="serverShell">
                <ServerControls sync={sync} onLogout={onLogout} />
                <section className="serverDocument">
                    {syncState.kind === 'merge-review-required' ? (
                        <ServerStaleMergeReview
                            app={app}
                            runtime={runtime}
                            actor={loaded.identity.actor}
                            sync={sync}
                        />
                    ) : (
                        <Provider
                            initial={currentHistory}
                            transport={sync.transport}
                            save={sync.saveHistory}
                            statuses={sync.statusStore}
                        >
                            <ServerDocumentWorkspace
                                app={app}
                                runtime={runtime}
                                actor={loaded.identity.actor}
                                sync={sync}
                            />
                        </Provider>
                    )}
                </section>
            </main>
        </>
    );
}

function ServerLogin({
    users,
    message,
    onLogin,
}: {
    users: ServerUser[];
    message?: string;
    onLogin(nickname: string): void;
}) {
    const [nickname, setNickname] = useState('');

    function submit(event: FormEvent) {
        event.preventDefault();
        const trimmed = nickname.trim();
        if (trimmed) onLogin(trimmed);
    }

    return (
        <section className="serverLogin waitingPanel">
            <h1>Log in to server sync</h1>
            <p>Choose a known nickname or enter a new one.</p>
            {users.length ? (
                <div className="serverKnownUsers">
                    {users.map((user) => (
                        <button
                            key={user.userId}
                            type="button"
                            onClick={() => onLogin(user.nickname)}
                        >
                            {user.nickname}
                        </button>
                    ))}
                </div>
            ) : null}
            <form className="serverLoginForm" onSubmit={submit}>
                <input
                    value={nickname}
                    onChange={(event) => setNickname(event.currentTarget.value)}
                    placeholder="Nickname"
                    aria-label="Nickname"
                />
                <button type="submit" disabled={!nickname.trim()}>
                    Log in
                </button>
            </form>
            {message ? <p className="serverLoginError">{message}</p> : null}
        </section>
    );
}

function ServerDocumentWorkspace<TState, EphemeralData>({
    app,
    runtime,
    actor,
    sync,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    actor: string;
    sync: ServerSync<TState>;
}) {
    const editor = runtime.useEditorContext();
    const [readOnly, setReadOnly] = useState(false);

    return (
        <>
            {app.renderPanel({
                actor,
                editor,
                title: `${app.title} server client`,
                gridSlot: 'full',
                readOnly,
                setPresenceSelection: sync.setPresenceSelection,
            })}
            <ServerHistoryView
                app={app}
                sync={sync}
                editor={editor}
                onPreviewingChange={setReadOnly}
            />
        </>
    );
}

function ServerStaleMergeReview<TState, EphemeralData>({
    app,
    runtime,
    actor,
    sync,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    actor: string;
    sync: ServerSync<TState>;
}) {
    const review = useStore(sync.staleMergeReviewStore);
    const [resultUpdates, setResultUpdates] = useState<CrdtUpdate[]>([]);
    const [forkName, setForkName] = useState('');

    useEffect(() => {
        setResultUpdates([]);
        setForkName('');
    }, [review?.sourceBranchId, review?.serverTipEventIndex]);

    const readonlyTransport = useMemo(() => noOpTransport(actor), [actor]);
    const resultTransport = useMemo(
        () =>
            captureTransport(actor, (updates) =>
                setResultUpdates((current) => [...current, ...updates]),
            ),
        [actor],
    );

    if (!review) {
        return (
            <section className="serverStaleReview">
                <h2>Preparing stale-change review</h2>
            </section>
        );
    }

    const {Provider} = runtime;
    const pendingLabel = `${review.pendingEventCount} pending ${
        review.pendingEventCount === 1 ? 'event' : 'events'
    }`;

    return (
        <section className="serverStaleReview" aria-label="Stale local changes review">
            <header className="serverStaleReviewHeader">
                <div>
                    <h2>Review local changes before upload</h2>
                    <p>
                        Branch {review.sourceBranchId} has {pendingLabel}. Oldest pending change:{' '}
                        {new Date(review.oldestPendingAt).toLocaleString()}.
                    </p>
                </div>
                <div className="serverStaleReviewActions">
                    <button type="button" onClick={() => sync.completeStaleMerge(resultUpdates)}>
                        Complete merge
                    </button>
                    <button type="button" onClick={() => sync.forkStaleLocalChanges(forkName)}>
                        Fork local changes
                    </button>
                    <button type="button" onClick={sync.discardStaleLocalChanges}>
                        Discard local changes
                    </button>
                </div>
            </header>
            <div className="serverStaleReviewFork">
                <input
                    value={forkName}
                    onChange={(event) => setForkName(event.currentTarget.value)}
                    placeholder={`${review.sourceBranchId}/sync-review-${Date.now()}`}
                    aria-label="Fork branch name"
                />
            </div>
            <div className="serverStaleReviewGrid">
                <Provider initial={review.clientHistory} transport={readonlyTransport}>
                    <ReviewPanel
                        app={app}
                        runtime={runtime}
                        actor={actor}
                        title="Your local changes"
                        readOnly
                    />
                </Provider>
                <Provider initial={review.serverHistory} transport={readonlyTransport}>
                    <ReviewPanel
                        app={app}
                        runtime={runtime}
                        actor={actor}
                        title="Server branch"
                        readOnly
                    />
                </Provider>
                <Provider initial={review.resultHistory} transport={resultTransport}>
                    <ReviewPanel
                        app={app}
                        runtime={runtime}
                        actor={actor}
                        title="Merge result"
                        readOnly={false}
                    />
                </Provider>
            </div>
        </section>
    );
}

function ReviewPanel<TState, EphemeralData>({
    app,
    runtime,
    actor,
    title,
    readOnly,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    actor: string;
    title: string;
    readOnly: boolean;
}) {
    const editor = runtime.useEditorContext();
    return app.renderPanel({
        actor,
        editor,
        title,
        gridSlot: 'full',
        readOnly,
    });
}

function noOpTransport(actor: string): SyncedTransport {
    let clock = hlc.init(actor, Date.now());
    return {
        actor,
        tick() {
            clock = hlc.inc(clock, Date.now());
            return clock;
        },
        publish() {},
        subscribe() {
            return () => {};
        },
        publishEphemeral() {},
        subscribeEphemeral() {
            return () => {};
        },
    };
}

function captureTransport(
    actor: string,
    onPublish: (updates: CrdtUpdate[]) => void,
): SyncedTransport {
    const transport = noOpTransport(actor);
    return {
        ...transport,
        publish(updates) {
            if (updates.length) onPublish(updates);
        },
    };
}

async function loadInitialState<TState>(
    app: AppDefinition<TState, any>,
    docId: string,
    fingerprint: string,
    fingerprintHash: string,
    schemaConfig: ServerSchemaConfig<TState>,
    identity: ServerSessionIdentity,
    allowCreate = true,
): Promise<Loaded<TState> | null> {
    const persisted = await loadServerReplica<TState>(docId);
    if (persisted) {
        const normalized = hydrateServerReplica(normalizeServerReplica(persisted), app);
        normalized.artifacts ??= serializedArtifactsForStore(app.artifacts);
        loadSerializedArtifacts(app.artifacts, normalized.artifacts);
        normalized.appId ||= app.id;
        if (normalized.schemaFingerprintHash === fingerprintHash) {
            if (normalized.appId !== app.id)
                throw new Error(
                    `Persisted document belongs to another app. ${app.id} vs ${normalized.appId}`,
                );
            return {
                identity,
                replica: normalized,
                source: 'loaded',
            };
        }
        const migrated = migrateServerReplica({
            app,
            replica: normalized,
            schemaConfig,
            schemaFingerprint: fingerprint,
            schemaFingerprintHash: fingerprintHash,
        });
        await saveServerReplica(migrated);
        return {
            identity,
            replica: migrated,
            source: 'loaded',
        };
    }

    if (!allowCreate) return null;
    const replica = createBlankServerReplica({
        app,
        docId,
        title: docId,
        schemaVersion: schemaConfig.version,
        schemaFingerprint: fingerprint,
        schemaFingerprintHash: fingerprintHash,
    });
    await saveServerReplica(replica);
    return {
        identity,
        replica,
        source: 'created',
    };
}

type BlankServerReplicaInput<TState> = {
    app: AppDefinition<TState, any>;
    docId: string;
    title: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    initParams?: unknown;
};

function createBlankServerReplica<TState>({
    app,
    docId,
    title,
    schemaVersion,
    schemaFingerprint,
    schemaFingerprintHash,
    initParams,
}: BlankServerReplicaInput<TState>): PersistedServerReplica<TState> {
    const history = createInitialCrdtHistory(app, initParams);
    const now = new Date().toISOString();
    return {
        docId,
        appId: app.id,
        title,
        storageVersion: 4,
        protocolVersion: SERVER_PROTOCOL_VERSION,
        schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
        activeBranchId: 'main',
        branchList: [
            {
                docId,
                branchId: 'main',
                name: 'main',
                tipEventIndex: 0,
                createdAt: now,
                updatedAt: now,
            },
        ],
        branches: {
            main: {
                branchId: 'main',
                history,
                lastSeenEventIndex: 0,
                undoCheckpointEventIndex: 0,
                events: [],
                mirrored: true,
            },
        },
        artifacts: initialArtifactsForApp(app, initParams),
        updatedAt: now,
    };
}

async function saveBlankServerReplica<TState>(input: BlankServerReplicaInput<TState>) {
    await saveServerReplica(createBlankServerReplica(input));
}

function hydrateServerReplica<TState>(
    replica: PersistedServerReplica<TState>,
    app: AppDefinition<TState, any>,
): PersistedServerReplica<TState> {
    return {
        ...replica,
        artifacts: replica.artifacts ?? serializedArtifactsForStore(app.artifacts),
        branches: Object.fromEntries(
            Object.entries(replica.branches).map(([branchId, branch]) => [
                branchId,
                {
                    ...branch,
                    history: hydrateCrdtLocalHistoryForApp(branch.history, app),
                },
            ]),
        ) as PersistedServerReplica<TState>['branches'],
    };
}

async function bootstrapInitialState<TState>(
    app: AppDefinition<TState, any>,
    docId: string,
    fingerprint: string,
    fingerprintHash: string,
    schemaConfig: ServerSchemaConfig<TState>,
    allowCreate: boolean,
    needsExplicitDocument: boolean,
): Promise<
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'needsUser'; sessionId: string; users: ServerUser[]; message?: string}
    | {kind: 'needsDocument'; identity: ServerSessionIdentity}
> {
    const sessionId = ensureServerSessionId();
    const user = await loadServerUser();
    if (!user) {
        const users = await fetchKnownUsers();
        return {kind: 'needsUser', sessionId, users};
    }
    const identity = createSessionIdentity(user, sessionId);
    if (needsExplicitDocument) return {kind: 'needsDocument', identity};
    const loaded = await loadInitialState(
        app,
        docId,
        fingerprint,
        fingerprintHash,
        schemaConfig,
        identity,
        allowCreate,
    );
    if (!loaded) return {kind: 'needsDocument', identity};
    return {kind: 'ready', loaded};
}

function createSessionIdentity(user: ServerUser, sessionId: string): ServerSessionIdentity {
    return {
        user,
        sessionId,
        actor: actorForSession(user.userId, sessionId),
        createdAt: new Date().toISOString(),
    };
}

async function fetchKnownUsers(): Promise<ServerUser[]> {
    const response = await fetchWithTimeout(`${SERVER_HTTP_URL}/users`);
    const body = await parseJsonResponse(response);
    if (!isRecord(body) || !Array.isArray(body.users)) {
        throw new Error('Server returned an invalid user list.');
    }
    const users: ServerUser[] = [];
    for (const user of body.users) {
        if (!isServerUser(user)) throw new Error('Server returned an invalid user.');
        users.push(user);
    }
    return users;
}

async function fetchServerDocuments(): Promise<ServerDocumentSummary[]> {
    const response = await fetchWithTimeout(`${SERVER_HTTP_URL}/documents`);
    const body = await parseJsonResponse(response);
    return parseServerDocumentsResponse(body);
}

async function listLocalServerDocuments(): Promise<ServerDocumentSummary[]> {
    const replicas = await listServerReplicas();
    return replicas.map(summaryForServerReplica);
}

function summaryForServerReplica(replica: PersistedServerReplica<unknown>): ServerDocumentSummary {
    return {
        docId: replica.docId,
        appId: replica.appId,
        schemaVersion: replica.schemaVersion,
        schemaFingerprint: replica.schemaFingerprint,
        schemaFingerprintHash: replica.schemaFingerprintHash,
        title: replica.title || replica.docId,
        sizeLabel: 'local',
        sizeRank: 0,
        createdAt: replica.updatedAt,
        lastAccessedAt: replica.updatedAt,
        branchCount: replica.branchList.length,
        eventCount: Object.values(replica.branches).reduce(
            (count, branch) => count + branch.events.length,
            0,
        ),
        artifacts: replica.artifacts,
    };
}

function classifyServerDocumentItems({
    appId,
    remoteDocuments,
    localDocuments,
}: {
    appId: string;
    remoteDocuments: ServerDocumentSummary[];
    localDocuments: ServerDocumentSummary[];
}): DocumentModalItem[] {
    const relevant = (document: ServerDocumentSummary) =>
        document.appId === appId || document.appId === '';
    const remoteById = new Map(
        remoteDocuments.filter(relevant).map((document) => [document.docId, document]),
    );
    const localById = new Map(
        localDocuments.filter(relevant).map((document) => [document.docId, document]),
    );
    const ids = new Set([...remoteById.keys(), ...localById.keys()]);
    return [...ids]
        .map((docId) => {
            const remote = remoteById.get(docId);
            const local = localById.get(docId);
            const primary = remote ?? local;
            if (!primary) throw new Error('Missing server document summary.');
            return {
                docId,
                appId: primary.appId || appId,
                title: primary.title || docId,
                payloadKind: 'server' as const,
                schemaVersion: primary.schemaVersion,
                schemaFingerprintHash: primary.schemaFingerprintHash,
                createdAt: primary.createdAt,
                updatedAt: primary.lastAccessedAt,
                source: remote && local ? 'local-and-server' : remote ? 'server' : 'local',
                canDeleteLocal: Boolean(local),
                metrics: {
                    sizeLabel: primary.sizeLabel,
                    branchCount: primary.branchCount,
                    eventCount: primary.eventCount,
                },
            } satisfies DocumentModalItem;
        })
        .sort((a, b) => a.title.localeCompare(b.title) || a.docId.localeCompare(b.docId));
}

async function loginServerUser(nickname: string): Promise<ServerUser> {
    const response = await fetchWithTimeout(`${SERVER_HTTP_URL}/users/login`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({nickname}),
    });
    const body = await parseJsonResponse(response);
    if (!response.ok) {
        const message =
            isRecord(body) && typeof body.error === 'string' ? body.error : response.statusText;
        throw new Error(message);
    }
    if (!isRecord(body) || !isServerUser(body.user)) {
        throw new Error('Server returned an invalid user.');
    }
    return body.user;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
        return await fetch(input, {...init, signal: controller.signal});
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('Timed out connecting to the React CRDT server.');
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

async function parseJsonResponse(response: Response) {
    try {
        return await response.json();
    } catch {
        throw new Error(`Server returned invalid JSON from ${response.url}.`);
    }
}

function isServerUser(value: unknown): value is ServerUser {
    return (
        isRecord(value) &&
        typeof value.userId === 'string' &&
        value.userId.length > 0 &&
        typeof value.nickname === 'string' &&
        value.nickname.length > 0
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readActiveDocId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('doc')?.trim() || undefined;
}

function writeActiveDocId(docId: string) {
    window.history.pushState(null, '', urlWithActiveDocId(window.location.href, docId));
}
