import {useEffect, useMemo, useState} from 'react';
import {createCrdtLocalHistory} from 'umkehr/crdt';
import {PeerJsControls} from './peerjs/PeerJsControls';
import {TODO_DOC_ID} from './peerjs/protocol';
import type {PeerJsSync, PeerRole} from './peerjs/types';
import {usePeerJsSync} from './peerjs/usePeerJsSync';
import {TodoPanel} from './TodoPanel';
import {ProvideTodos, createInitialHistory, useTodos} from './model';
import {useStore} from './store';

export function PeerJsApp() {
    const initialHostPeerId = readInvitePeerId();
    const [role, setRole] = useState<PeerRole>(() => (initialHostPeerId ? 'client' : 'host'));
    const [hostInitial] = useState(createInitialHistory);
    const actor = useMemo(() => `${role}-${crypto.randomUUID().slice(0, 8)}`, [role]);
    const sync = usePeerJsSync({
        role,
        actor,
        initialDocument: role === 'host' ? hostInitial.doc : undefined,
        docId: TODO_DOC_ID,
    });

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
                <ProvideTodos initial={hostInitial} transport={sync.transport}>
                    <PeerHostDocument actor={actor} sync={sync} />
                </ProvideTodos>
            ) : (
                <PeerClientDocument actor={actor} sync={sync} />
            )}
        </main>
    );
}

function PeerInviteConnector({
    hostPeerId,
    role,
    sync,
}: {
    hostPeerId: string;
    role: PeerRole;
    sync: PeerJsSync;
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

function PeerHostDocument({actor, sync}: {actor: string; sync: PeerJsSync}) {
    const ctx = useTodos();
    const history = ctx.useLocalHistory();
    const connections = useStore(sync.connectionsStore);

    useEffect(() => {
        sync.setSnapshotDocument(history.doc);
    }, [history.doc, sync]);

    return <TodoPanel replicaId={actor} title="Host Todos" queued={queuedCount(connections)} />;
}

function PeerClientDocument({actor, sync}: {actor: string; sync: PeerJsSync}) {
    const snapshot = useStore(sync.snapshotStore);
    const state = useStore(sync.stateStore);
    const connections = useStore(sync.connectionsStore);
    const initial = useMemo(() => (snapshot ? createCrdtLocalHistory(snapshot) : null), [snapshot]);

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
        <ProvideTodos initial={initial} transport={sync.transport}>
            <TodoPanel replicaId={actor} title="Client Todos" queued={queuedCount(connections)} />
        </ProvideTodos>
    );
}

function queuedCount(connections: ReturnType<PeerJsSync['connectionsStore']['getSnapshot']>) {
    return connections.reduce((total, connection) => total + connection.queuedOutgoing, 0);
}

function readInvitePeerId() {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('peer')?.trim() ?? '';
}
