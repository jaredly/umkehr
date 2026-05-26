import {useCallback, useEffect, useMemo, useState} from 'react';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import {
    createInitialCrdtHistory,
    type AppDefinition,
    type CrdtRuntime,
} from '../crdtApp';
import {LocalFirstControls} from './LocalFirstControls';
import {
    hasReplica,
    listReplicas,
    listBatches,
    loadOrCreateIdentity,
    loadReplica,
    replaceReplicaState,
    saveIdentity,
    saveReplica,
} from './persistence';
import {
    DocumentArchiveControls,
    DocumentPicker,
    type DocumentArchive,
    type LocalDocumentSummary,
} from '../documentArchive';
import {useTopBarControls} from '../chrome/TopBarContext';
import {
    loadBranchFreeSeedFixtureForApp,
    mergeDocumentSummariesWithSeeds,
} from '../seed/documents';
import {readActiveDocIdFromSearch, urlWithActiveDocId} from '../useUrlSelection';
import {createLocalFirstSeedReplica} from '../seed/localFirst';
import {schemaFingerprint, schemaFingerprintHash} from './schemaFingerprint';
import {acquireReplicaTabLock, type TabLock} from './tabLock';
import type {DocumentLineage, PersistedReplica, ReplicaIdentity, VersionVector} from './types';
import {useLocalFirstSync} from './useLocalFirstSync';
import {defaultLocalFirstSchemaConfig, type LocalFirstSchemaConfig} from './schemaConfig';
import {
    createMigratedReplica,
    findMigrationCandidate,
    normalizePersistedReplica,
    retainedHistory,
    vectorForBatches,
    type MigrationCandidate,
} from './migration';

type Loaded<TState> = {
    identity: ReplicaIdentity;
    docId: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    compactedThrough?: VersionVector;
    lineage?: DocumentLineage;
    source: 'created' | 'loaded' | 'migrated';
    lock: Extract<TabLock, {kind: 'acquired'}>;
};

type LoadState<TState> =
    | {kind: 'loading'}
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {
          kind: 'migratable';
          identity: ReplicaIdentity;
          source: PersistedReplica<unknown>;
          candidate: MigrationCandidate<TState>;
          lock: Extract<TabLock, {kind: 'acquired'}>;
      }
    | {kind: 'incompatible'; message: string}
    | {kind: 'error'; message: string};

export function LocalFirstApp<TState, EphemeralData = never>({
    app,
    runtime,
    schemaConfig: schemaConfigProp,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    schemaConfig?: LocalFirstSchemaConfig<TState>;
}) {
    const initialPeerId = readInvitePeerId();
    const activeDocId = readActiveDocIdFromSearch(window.location.search, runtime.docId);
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const fingerprintHash = useMemo(() => schemaFingerprintHash(app), [app]);
    const schemaConfig = useMemo(
        () => schemaConfigProp ?? defaultLocalFirstSchemaConfig<TState>(),
        [schemaConfigProp],
    );
    const [loadState, setLoadState] = useState<LoadState<TState>>({kind: 'loading'});

    useEffect(() => {
        let alive = true;
        let lock: Extract<TabLock, {kind: 'acquired'}> | null = null;
        setLoadState({kind: 'loading'});
        loadInitialState(app, activeDocId, fingerprint, fingerprintHash, schemaConfig)
            .then((loaded) => {
                lock = loaded.kind === 'ready' ? loaded.loaded.lock : loaded.lock;
                if (alive) setLoadState(loaded.kind === 'ready' ? loaded : loaded);
                else lock.release();
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
            lock?.release();
        };
    }, [activeDocId, app, fingerprint, fingerprintHash, runtime, schemaConfig]);

    if (loadState.kind === 'loading') {
        return (
            <main className="localFirstShell">
                <section className="waitingPanel">
                    <h1>Loading local replica</h1>
                    <p>Reading durable state from this browser.</p>
                </section>
            </main>
        );
    }

    if (loadState.kind === 'migratable') {
        return (
            <MigrationPanel
                app={app}
                schemaConfig={schemaConfig}
                schemaFingerprint={fingerprint}
                loadState={loadState}
            />
        );
    }

    if (loadState.kind === 'incompatible' || loadState.kind === 'error') {
        return (
            <main className="localFirstShell">
                <section className="waitingPanel">
                    <h1>Local replica unavailable</h1>
                    <p>{loadState.message}</p>
                </section>
            </main>
        );
    }

    return (
        <LocalFirstReadyApp
            app={app}
            runtime={runtime}
            loaded={loadState.loaded}
            initialPeerId={initialPeerId}
        />
    );
}

function LocalFirstReadyApp<TState, EphemeralData>({
    app,
    runtime,
    loaded,
    initialPeerId,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    loaded: Loaded<TState>;
    initialPeerId: string;
}) {
    const [currentHistory, setCurrentHistory] = useState(loaded.history);
    const [documents, setDocuments] = useState<LocalDocumentSummary[]>([]);
    const sync = useLocalFirstSync({
        docId: loaded.docId,
        schema: app.schema,
        tagKey: app.tagKey,
        validateState: app.validateState,
        schemaFingerprint: loaded.schemaFingerprint,
        schemaFingerprintHash: loaded.schemaFingerprintHash,
        schemaVersion: loaded.schemaVersion,
        lineage: loaded.lineage,
        identity: loaded.identity,
        initialHistory: currentHistory,
        initialVector: loaded.vector,
        initialCompactedThrough: loaded.compactedThrough,
        source: loaded.source,
        initialPeerId,
        replaceHistory: setCurrentHistory,
    });
    const {Provider} = runtime;
    const saveHistory = useCallback(
        (history: CrdtLocalHistory<TState>) => {
            setCurrentHistory(history);
            sync.saveHistory(history);
        },
        [sync],
    );
    const refreshDocuments = useCallback(() => {
        void listReplicas().then((replicas) =>
            setDocuments(
                replicas.map((replica) => ({
                    docId: replica.docId,
                    appId: app.id,
                    title: replica.docId,
                    payloadKind: 'local-first',
                    schemaVersion: replica.schemaVersion,
                    schemaFingerprintHash: replica.schemaFingerprintHash,
                    createdAt: replica.updatedAt,
                    updatedAt: replica.updatedAt,
                })),
            ),
        );
    }, [app.id]);
    useEffect(() => {
        refreshDocuments();
    }, [refreshDocuments]);
    const switchDocument = useCallback((docId: string) => {
        window.history.pushState(window.history.state, '', urlWithActiveDocId(window.location.href, docId));
        window.location.reload();
    }, []);
    const archiveAdapter = useMemo(
        () => ({
            async exportArchive(): Promise<DocumentArchive> {
                const state = JSON.parse(await sync.exportLocalState()) as {
                    replica: unknown;
                    batches: unknown[];
                };
                return {
                    kind: 'umkehr.react-crdt.document',
                    archiveVersion: 1,
                    exportedAt: new Date().toISOString(),
                    appId: app.id,
                    docId: loaded.docId,
                    schemaVersion: loaded.schemaVersion,
                    schemaFingerprint: loaded.schemaFingerprint,
                    schemaFingerprintHash: loaded.schemaFingerprintHash,
                    exportedBy: {actor: loaded.identity.replicaId},
                    payload: {
                        kind: 'local-first',
                        replica: state.replica as any,
                        batches: state.batches as any,
                    },
                };
            },
            async importArchive(archive: DocumentArchive) {
                if (archive.appId !== app.id || archive.payload.kind !== 'local-first') {
                    throw new Error('Archive cannot be imported into local-first mode.');
                }
                await sync.importLocalState(
                    JSON.stringify({
                        replica: archive.payload.replica,
                        batches: archive.payload.batches,
                    }),
                );
            },
        }),
        [app.id, loaded, sync],
    );
    const topBarControls = useMemo(
        () => ({
            documentPicker: (
                <DocumentPicker
                    documents={mergeDocumentSummariesWithSeeds(
                        documents,
                        app.id,
                        'local-first',
                    )}
                    activeDocId={loaded.docId}
                    appId={app.id}
                    payloadKind="local-first"
                    onSwitchDocument={switchDocument}
                />
            ),
            archiveControls: (
                <DocumentArchiveControls
                    adapter={archiveAdapter}
                    appId={app.id}
                    docId={loaded.docId}
                    payloadKind="local-first"
                />
            ),
        }),
        [
            app.id,
            archiveAdapter,
            documents,
            loaded.docId,
            switchDocument,
        ],
    );
    useTopBarControls(topBarControls);

    return (
        <main className="localFirstShell">
            <Provider
                initial={currentHistory}
                transport={sync.transport}
                save={saveHistory}
            >
                <LocalFirstDocument app={app} runtime={runtime} actor={loaded.identity.replicaId} />
            </Provider>
            <LocalFirstControls
                sync={sync}
                docId={loaded.docId}
                schemaVersion={loaded.schemaVersion}
                schemaFingerprint={loaded.schemaFingerprint}
                schemaFingerprintHash={loaded.schemaFingerprintHash}
            />
        </main>
    );
}

function readInvitePeerId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('peer')?.trim() ?? '';
}

function readActiveDocId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('doc')?.trim() || undefined;
}

function LocalFirstDocument<TState, EphemeralData>({
    app,
    runtime,
    actor,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: CrdtRuntime<TState, EphemeralData>;
    actor: string;
}) {
    const editor = runtime.useEditorContext();

    return app.renderPanel({
        actor,
        editor,
        title: `${app.title}`,
        gridSlot: 'full',
    });
}

async function loadInitialState<TState>(
    app: AppDefinition<TState, any>,
    docId: string,
    schemaFingerprint: string,
    schemaFingerprintHash: string,
    schemaConfig: LocalFirstSchemaConfig<TState>,
): Promise<LoadState<TState> & {kind: 'ready' | 'migratable'}> {
    const seedFixture = loadBranchFreeSeedFixtureForApp(app, docId);
    const seeded = seedFixture ? createLocalFirstSeedReplica({fixture: seedFixture}) : null;
    const identity = seeded?.identity ?? await loadOrCreateIdentity();
    if (seeded) await saveIdentity(identity);
    const lock = await acquireReplicaTabLock(docId, identity.replicaId);
    if (lock.kind === 'blocked') {
        throw new Error(lock.message);
    }

    const persisted = await loadReplica<TState>(docId);
    if (persisted) {
        const normalized = normalizePersistedReplica(persisted);
        const batches = await listBatches(docId);
        if (normalized.schemaFingerprintHash !== schemaFingerprintHash) {
            const candidate = findMigrationCandidate({
                source: normalized,
                current: schemaConfig,
                currentFingerprint: schemaFingerprint,
                currentFingerprintHash: schemaFingerprintHash,
            });
            if (candidate) {
                return {kind: 'migratable', identity, source: normalized, candidate, lock};
            }
            throw new Error('Persisted document schema does not match this app version.');
        }
        const history = retainedHistory(normalized.history, batches);
        const vector = batches.length ? vectorForBatches(batches) : normalized.vector;
        return {
            kind: 'ready',
            loaded: {
                identity,
                docId,
                schemaVersion: normalized.schemaVersion,
                schemaFingerprint,
                schemaFingerprintHash,
                history,
                vector,
                compactedThrough: normalized.compactedThrough,
                lineage: normalized.lineage,
                source: normalized.lineage ? 'migrated' : 'loaded',
                lock,
            },
        };
    }

    if (seeded) {
        await replaceReplicaState(seeded.replica, seeded.batches);
        return {
            kind: 'ready',
            loaded: {
                identity,
                docId,
                schemaVersion: seeded.replica.schemaVersion,
                schemaFingerprint: seeded.replica.schemaFingerprint,
                schemaFingerprintHash: seeded.replica.schemaFingerprintHash,
                history: seeded.replica.history,
                vector: seeded.replica.vector,
                compactedThrough: seeded.replica.compactedThrough,
                lineage: seeded.replica.lineage,
                source: 'created',
                lock,
            },
        };
    }

    const history = createInitialCrdtHistory(app);
    const vector: VersionVector = {};
    await saveReplica({
        docId,
        storageVersion: 1,
        protocolVersion: 1,
        schemaVersion: schemaConfig.version,
        schemaFingerprint,
        schemaFingerprintHash,
        replicaId: identity.replicaId,
        history,
        vector,
        updatedAt: new Date().toISOString(),
    });
    return {
        kind: 'ready',
        loaded: {
            identity,
            docId,
            schemaVersion: schemaConfig.version,
            schemaFingerprint,
            schemaFingerprintHash,
            history,
            vector,
            compactedThrough: undefined,
            source: 'created',
            lock,
        },
    };
}

function MigrationPanel<TState>({
    app,
    schemaConfig,
    schemaFingerprint,
    loadState,
}: {
    app: AppDefinition<TState, any>;
    schemaConfig: LocalFirstSchemaConfig<TState>;
    schemaFingerprint: string;
    loadState: Extract<LoadState<TState>, {kind: 'migratable'}>;
}) {
    const [error, setError] = useState<string | null>(null);
    return (
        <main className="localFirstShell">
            <section className="waitingPanel">
                <h1>Schema migration available</h1>
                <p>
                    This browser has a local document on schema version{' '}
                    {loadState.candidate.sourceSchemaVersion}. A new document can be created on
                    schema version {loadState.candidate.targetSchemaVersion}; the old document will
                    remain unchanged.
                </p>
                <dl className="localFirstStats">
                    <dt>Source</dt>
                    <dd>{loadState.candidate.sourceDocId}</dd>
                    <dt>Target</dt>
                    <dd>{loadState.candidate.targetDocId}</dd>
                    <dt>Migration</dt>
                    <dd>{loadState.candidate.migrationIds.join(', ')}</dd>
                    <dt>Current schema</dt>
                    <dd>{schemaFingerprint.slice(0, 16)}</dd>
                </dl>
                {error ? <p>{error}</p> : null}
                <div className="connectionActions">
                    <button
                        type="button"
                        onClick={() =>
                            void createMigratedDocument({
                                app,
                                schemaConfig,
                                schemaFingerprint,
                                loadState,
                                setError,
                            })
                        }
                    >
                        Create migrated document
                    </button>
                    <button type="button" onClick={() => openDocument(loadState.candidate.targetDocId)}>
                        Open target document
                    </button>
                </div>
            </section>
        </main>
    );
}

async function createMigratedDocument<TState>({
    app,
    schemaConfig,
    schemaFingerprint: _schemaFingerprint,
    loadState,
    setError,
}: {
    app: AppDefinition<TState, any>;
    schemaConfig: LocalFirstSchemaConfig<TState>;
    schemaFingerprint: string;
    loadState: Extract<LoadState<TState>, {kind: 'migratable'}>;
    setError(message: string | null): void;
}) {
    try {
        if (await hasReplica(loadState.candidate.targetDocId)) {
            openDocument(loadState.candidate.targetDocId);
            return;
        }
        const migrated = createMigratedReplica({
            source: loadState.source,
            candidate: loadState.candidate,
            identity: loadState.identity,
            schema: app.schema,
            tagKey: app.tagKey,
            validateState: app.validateState,
            batches: await listBatches(loadState.source.docId),
            previous: schemaConfig.previous,
        });
        await replaceReplicaState(migrated.replica, migrated.batches);
        openDocument(migrated.replica.docId);
    } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
    }
}

function openDocument(docId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('doc', docId);
    url.hash = 'local-first';
    window.location.href = url.toString();
}
