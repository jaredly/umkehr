import {useEffect, useMemo, useState} from 'react';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import {
    createInitialCrdtHistory,
    type AppDefinition,
    type CrdtRuntime,
} from '../crdtApp';
import {schemaFingerprint} from '../local-first/schemaFingerprint';
import {ServerControls} from './ServerControls';
import {ServerHistoryView} from './ServerHistoryView';
import {
    loadOrCreateServerIdentity,
    loadServerReplica,
    saveServerReplica,
} from './persistence';
import {SERVER_PROTOCOL_VERSION} from './protocol';
import {useServerSync} from './useServerSync';
import type {PersistedServerReplica, ServerReplicaIdentity} from './types';

type Loaded<TState> = {
    identity: ServerReplicaIdentity;
    history: CrdtLocalHistory<TState>;
    lastSeenMessageIndex: number;
    changes: PersistedServerReplica<TState>['changes'];
    source: 'created' | 'loaded';
};

type LoadState<TState> =
    | {kind: 'loading'}
    | {kind: 'ready'; loaded: Loaded<TState>}
    | {kind: 'error'; message: string};

export function ServerApp<TState>({
    app,
    runtime,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
}) {
    const activeDocId = readActiveDocId() ?? runtime.docId;
    const fingerprint = useMemo(() => schemaFingerprint(app), [app]);
    const [loadState, setLoadState] = useState<LoadState<TState>>({kind: 'loading'});

    useEffect(() => {
        let alive = true;
        setLoadState({kind: 'loading'});
        loadInitialState(app, activeDocId, fingerprint)
            .then((loaded) => {
                if (alive) setLoadState({kind: 'ready', loaded});
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
    }, [activeDocId, app, fingerprint]);

    if (loadState.kind === 'loading') {
        return (
            <main className="serverShell">
                <section className="waitingPanel">
                    <h1>Loading server replica</h1>
                    <p>Reading durable state from this browser.</p>
                </section>
            </main>
        );
    }

    if (loadState.kind === 'error') {
        return (
            <main className="serverShell">
                <section className="waitingPanel">
                    <h1>Server replica unavailable</h1>
                    <p>{loadState.message}</p>
                </section>
            </main>
        );
    }

    return (
        <ServerReadyApp
            app={app}
            runtime={runtime}
            docId={activeDocId}
            schemaFingerprint={fingerprint}
            loaded={loadState.loaded}
        />
    );
}

function ServerReadyApp<TState>({
    app,
    runtime,
    docId,
    schemaFingerprint,
    loaded,
}: {
    app: AppDefinition<TState>;
    runtime: CrdtRuntime<TState>;
    docId: string;
    schemaFingerprint: string;
    loaded: Loaded<TState>;
}) {
    const [currentHistory, setCurrentHistory] = useState(loaded.history);
    const sync = useServerSync({
        docId,
        schema: app.schema,
        schemaFingerprint,
        identity: loaded.identity,
        initialHistory: currentHistory,
        initialLastSeenMessageIndex: loaded.lastSeenMessageIndex,
        initialChanges: loaded.changes,
        replaceHistory: setCurrentHistory,
    });
    const {Provider} = runtime;

    return (
        <main className="serverShell">
            <section className="serverDocument">
                <Provider
                    initial={currentHistory}
                    transport={sync.transport}
                    save={sync.saveHistory}
                >
                    <ServerDocument app={app} runtime={runtime} actor={loaded.identity.replicaId} />
                </Provider>
                <ServerHistoryView app={app} sync={sync} />
            </section>
            <ServerControls sync={sync} />
        </main>
    );
}

function ServerDocument<TState>({
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
        title: `${app.title} server client`,
        gridSlot: 'full',
    });
}

async function loadInitialState<TState>(
    app: AppDefinition<TState>,
    docId: string,
    fingerprint: string,
): Promise<Loaded<TState>> {
    const identity = await loadOrCreateServerIdentity();
    const persisted = await loadServerReplica<TState>(docId);
    if (persisted) {
        if (persisted.schemaFingerprint !== fingerprint) {
            throw new Error('Persisted server replica schema does not match this app version.');
        }
        return {
            identity,
            history: persisted.history,
            lastSeenMessageIndex: persisted.lastSeenMessageIndex,
            changes: persisted.changes,
            source: 'loaded',
        };
    }

    const history = createInitialCrdtHistory(app);
    const replica: PersistedServerReplica<TState> = {
        docId,
        storageVersion: 1,
        protocolVersion: SERVER_PROTOCOL_VERSION,
        schemaFingerprint: fingerprint,
        replicaId: identity.replicaId,
        history,
        lastSeenMessageIndex: 0,
        changes: [],
        updatedAt: new Date().toISOString(),
    };
    await saveServerReplica(replica);
    return {
        identity,
        history,
        lastSeenMessageIndex: 0,
        changes: [],
        source: 'created',
    };
}

function readActiveDocId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('doc')?.trim() || undefined;
}
