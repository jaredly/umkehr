import {useEffect, useMemo, useState} from 'react';
import {createCrdtLocalHistory} from 'umkehr/crdt';
import type {CrdtAppDefinition} from '../crdtApp';
import {useStore} from '../store';
import {PeerJsControls} from './PeerJsControls';
import type {PeerProtocolConfig} from './protocol';
import type {PeerJsSync, PeerRole} from './types';
import {usePeerJsSync} from './usePeerJsSync';

export function PeerJsApp<TState>({app}: {app: CrdtAppDefinition<TState>}) {
    const initialHostPeerId = readInvitePeerId();
    const [role, setRole] = useState<PeerRole>(() => (initialHostPeerId ? 'client' : 'host'));
    const [hostInitial] = useState(app.createInitialHistory);
    const actor = useMemo(() => `${role}-${crypto.randomUUID().slice(0, 8)}`, [role]);
    const protocol = useMemo(
        (): PeerProtocolConfig<TState> => ({
            docId: app.docId,
            tagKey: app.tagKey,
            schema: app.schema,
            validateState: app.validateState,
        }),
        [app],
    );
    const sync = usePeerJsSync({
        role,
        actor,
        initialDocument: role === 'host' ? hostInitial.doc : undefined,
        protocol,
    });
    const {Provider} = app;

    return (
        <main className="peerShell">
            <PeerInviteConnector hostPeerId={initialHostPeerId} role={role} sync={sync} />
            <PeerJsControls
                role={role}
                setRole={setRole}
                sync={sync}
                initialHostPeerId={initialHostPeerId}
            />
            {role === 'host' ? (
                <Provider initial={hostInitial} transport={sync.transport}>
                    <PeerHostDocument actor={actor} sync={sync} app={app} />
                </Provider>
            ) : (
                <PeerClientDocument actor={actor} sync={sync} app={app} />
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

function PeerHostDocument<TState>({
    actor,
    sync,
    app,
}: {
    actor: string;
    sync: PeerJsSync<TState>;
    app: CrdtAppDefinition<TState>;
}) {
    const ctx = app.useSyncedContext();
    const history = ctx.useLocalHistory();
    const connections = useStore(sync.connectionsStore);

    useEffect(() => {
        sync.setSnapshotDocument(history.doc);
    }, [history.doc, sync]);

    return app.renderPanel({
        actor,
        title: `Host ${app.title}`,
        queued: queuedCount(connections),
    });
}

function PeerClientDocument<TState>({
    actor,
    sync,
    app,
}: {
    actor: string;
    sync: PeerJsSync<TState>;
    app: CrdtAppDefinition<TState>;
}) {
    const snapshot = useStore(sync.snapshotStore);
    const state = useStore(sync.stateStore);
    const connections = useStore(sync.connectionsStore);
    const initial = useMemo(() => (snapshot ? createCrdtLocalHistory(snapshot) : null), [snapshot]);
    const {Provider} = app;

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
            {app.renderPanel({
                actor,
                title: `Client ${app.title}`,
                queued: queuedCount(connections),
            })}
        </Provider>
    );
}

function queuedCount(
    connections: ReturnType<PeerJsSync<unknown>['connectionsStore']['getSnapshot']>,
) {
    return connections.reduce((total, connection) => total + connection.queuedOutgoing, 0);
}

function readInvitePeerId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('peer')?.trim() ?? '';
}
