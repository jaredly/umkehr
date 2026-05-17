import {useCallback, useEffect, useMemo, useState} from 'react';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import {
    createInitialCrdtHistory,
    type AppDefinition,
    type CrdtRuntime,
} from '../crdtApp';
import {LocalFirstControls} from './LocalFirstControls';
import {loadOrCreateIdentity, loadReplica, saveReplica} from './persistence';
import {schemaFingerprint} from './schemaFingerprint';
import {acquireReplicaTabLock, type TabLock} from './tabLock';
import type {ReplicaIdentity, VersionVector} from './types';
import {useLocalFirstSync} from './useLocalFirstSync';

type Loaded<TState> = {
    identity: ReplicaIdentity;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
    source: 'created' | 'loaded';
    lock: Extract<TabLock, {kind: 'acquired'}>;
};

type LoadState<TState> =
    | {kind: 'loading'}
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'incompatible'; message: string}
    | {kind: 'error'; message: string};

export function LocalFirstApp<TState>({
    app,
    runtime,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
}) {
    const initialPeerId = readInvitePeerId();
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const [loadState, setLoadState] = useState<LoadState<TState>>({kind: 'loading'});

    useEffect(() => {
        let alive = true;
        let lock: Extract<TabLock, {kind: 'acquired'}> | null = null;
        loadInitialState(app, runtime, fingerprint)
            .then((loaded) => {
                lock = loaded.lock;
                if (alive) setLoadState({kind: 'ready', loaded});
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
    }, [app, fingerprint, runtime]);

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
            schemaFingerprint={fingerprint}
            loaded={loadState.loaded}
            initialPeerId={initialPeerId}
        />
    );
}

function LocalFirstReadyApp<TState>({
    app,
    runtime,
    schemaFingerprint,
    loaded,
    initialPeerId,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    schemaFingerprint: string;
    loaded: Loaded<TState>;
    initialPeerId: string;
}) {
    const [currentHistory, setCurrentHistory] = useState(loaded.history);
    const sync = useLocalFirstSync({
        docId: runtime.docId,
        schema: app.schema,
        schemaFingerprint,
        identity: loaded.identity,
        initialHistory: currentHistory,
        initialVector: loaded.vector,
        source: loaded.source,
        initialPeerId,
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
                docId={runtime.docId}
                schemaFingerprint={schemaFingerprint}
            />
        </main>
    );
}

function readInvitePeerId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('peer')?.trim() ?? '';
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
    runtime: CrdtRuntime<TState>,
    schemaFingerprint: string,
): Promise<Loaded<TState>> {
    const identity = await loadOrCreateIdentity();
    const lock = await acquireReplicaTabLock(runtime.docId, identity.replicaId);
    if (lock.kind === 'blocked') {
        throw new Error(lock.message);
    }

    const persisted = await loadReplica<TState>(runtime.docId);
    if (persisted) {
        if (persisted.schemaFingerprint !== schemaFingerprint) {
            throw new Error('Persisted document schema does not match this app version.');
        }
        return {
            identity,
            history: persisted.history,
            vector: persisted.vector,
            source: 'loaded',
            lock,
        };
    }

    const history = createInitialCrdtHistory(app);
    const vector: VersionVector = {};
    await saveReplica({
        docId: runtime.docId,
        storageVersion: 1,
        protocolVersion: 1,
        schemaFingerprint,
        replicaId: identity.replicaId,
        history,
        vector,
        updatedAt: new Date().toISOString(),
    });
    return {identity, history, vector, source: 'created', lock};
}
