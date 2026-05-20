import {useCallback, useEffect, useMemo, useState} from 'react';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import {
    createInitialCrdtHistory,
    type AppDefinition,
    type CrdtRuntime,
} from '../crdtApp';
import {LocalFirstControls} from './LocalFirstControls';
import {hasReplica, loadOrCreateIdentity, loadReplica, saveReplica} from './persistence';
import {schemaFingerprint, schemaFingerprintHash} from './schemaFingerprint';
import {acquireReplicaTabLock, type TabLock} from './tabLock';
import type {DocumentLineage, PersistedReplica, ReplicaIdentity, VersionVector} from './types';
import {useLocalFirstSync} from './useLocalFirstSync';
import {defaultLocalFirstSchemaConfig, type LocalFirstSchemaConfig} from './schemaConfig';
import {
    createMigratedReplica,
    findMigrationCandidate,
    normalizePersistedReplica,
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

export function LocalFirstApp<TState>({
    app,
    runtime,
    schemaConfig: schemaConfigProp,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    schemaConfig?: LocalFirstSchemaConfig<TState>;
}) {
    const initialPeerId = readInvitePeerId();
    const activeDocId = readActiveDocId() ?? runtime.docId;
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

function LocalFirstReadyApp<TState>({
    app,
    runtime,
    loaded,
    initialPeerId,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    loaded: Loaded<TState>;
    initialPeerId: string;
}) {
    const [currentHistory, setCurrentHistory] = useState(loaded.history);
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

function LocalFirstDocument<TState>({
    app,
    runtime,
    actor,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    actor: string;
}) {
    const editor = runtime.useEditorContext();
    editor.useLocalHistory();

    return app.renderPanel({
        actor,
        editor,
        title: `${app.title}`,
        gridSlot: 'full',
    });
}

async function loadInitialState<TState>(
    app: AppDefinition<TState>,
    docId: string,
    schemaFingerprint: string,
    schemaFingerprintHash: string,
    schemaConfig: LocalFirstSchemaConfig<TState>,
): Promise<LoadState<TState> & {kind: 'ready' | 'migratable'}> {
    const identity = await loadOrCreateIdentity();
    const lock = await acquireReplicaTabLock(docId, identity.replicaId);
    if (lock.kind === 'blocked') {
        throw new Error(lock.message);
    }

    const persisted = await loadReplica<TState>(docId);
    if (persisted) {
        const normalized = normalizePersistedReplica(persisted);
        if (normalized.schemaFingerprint !== schemaFingerprint) {
            const candidate = findMigrationCandidate({
                source: normalized,
                current: schemaConfig,
                currentFingerprint: schemaFingerprint,
            });
            if (candidate) {
                return {kind: 'migratable', identity, source: normalized, candidate, lock};
            }
            throw new Error('Persisted document schema does not match this app version.');
        }
        return {
            kind: 'ready',
            loaded: {
                identity,
                docId,
                schemaVersion: normalized.schemaVersion,
                schemaFingerprint,
                schemaFingerprintHash,
                history: normalized.history,
                vector: normalized.vector,
                compactedThrough: normalized.compactedThrough,
                lineage: normalized.lineage,
                source: normalized.lineage ? 'migrated' : 'loaded',
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
    app: AppDefinition<TState>;
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
    schemaConfig: _schemaConfig,
    schemaFingerprint: _schemaFingerprint,
    loadState,
    setError,
}: {
    app: AppDefinition<TState>;
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
        });
        await saveReplica(migrated);
        openDocument(migrated.docId);
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
