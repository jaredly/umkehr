import {
    useCallback,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';
import type {CrdtUpdate} from 'umkehr/crdt';
import {ReplicaHost} from './ReplicaHost';
import {SyncControls} from './SyncControls';
import {replicas, type ReceiveUpdate, type RegisterReplica, type ReplicaId} from './model';
import './style.css';

type TransportState = {
    syncEnabled: boolean;
    outbox: Record<ReplicaId, CrdtUpdate[]>;
};

type ReceiverRegistry = Partial<Record<ReplicaId, ReceiveUpdate>>;
type SetTransport = (next: TransportState) => void;

export function App() {
    const receivers = useRef<ReceiverRegistry>({});
    const [transport, setTransportState] = useState<TransportState>(() => ({
        syncEnabled: true,
        outbox: emptyOutbox(),
    }));
    const transportRef = useRef(transport);

    const setTransport = useCallback(
        (next: TransportState) => setTransportSnapshot(next, transportRef, setTransportState),
        [],
    );

    const registerReplica = useCallback<RegisterReplica>((id, receive) => {
        return registerReceiver(receivers.current, id, receive);
    }, []);

    const deliverUpdates = useCallback((from: ReplicaId, updates: CrdtUpdate[]) => {
        deliverTransportUpdates(receivers.current, from, updates);
    }, []);

    const broadcastUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            broadcastTransportUpdates(
                transportRef.current,
                setTransport,
                deliverUpdates,
                from,
                updates,
            );
        },
        [deliverUpdates, setTransport],
    );

    const toggleSync = useCallback(() => {
        toggleTransportSync(transportRef.current, setTransport, deliverUpdates);
    }, [deliverUpdates, setTransport]);

    return (
        <main className="collabShell">
            {replicas.map((replica, index) => (
                <ReplicaHost
                    key={replica.id}
                    id={replica.id}
                    title={replica.title}
                    queued={transport.outbox[replica.id]?.length ?? 0}
                    registerReplica={registerReplica}
                    onOutboundUpdates={broadcastUpdates}
                    gridSlot={index === 0 ? 'left' : 'right'}
                />
            ))}
            <SyncControls
                syncEnabled={transport.syncEnabled}
                queueCounts={replicas.map((replica) => ({
                    label: replica.label,
                    count: transport.outbox[replica.id]?.length ?? 0,
                }))}
                toggleSync={toggleSync}
            />
        </main>
    );
}

function emptyOutbox(): Record<ReplicaId, CrdtUpdate[]> {
    return Object.fromEntries(replicas.map((replica) => [replica.id, []]));
}

function setTransportSnapshot(
    next: TransportState,
    ref: MutableRefObject<TransportState>,
    setState: Dispatch<SetStateAction<TransportState>>,
) {
    ref.current = next;
    setState(next);
}

function registerReceiver(registry: ReceiverRegistry, id: ReplicaId, receive: ReceiveUpdate) {
    registry[id] = receive;
    return () => {
        if (registry[id] === receive) delete registry[id];
    };
}

function deliverTransportUpdates(
    registry: ReceiverRegistry,
    from: ReplicaId,
    updates: CrdtUpdate[],
) {
    for (const replica of replicas) {
        if (replica.id === from) continue;
        const receive = registry[replica.id];
        if (!receive) continue;
        for (const update of updates) receive(update);
    }
}

function broadcastTransportUpdates(
    current: TransportState,
    setTransport: SetTransport,
    deliverUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void,
    from: ReplicaId,
    updates: CrdtUpdate[],
) {
    if (!updates.length) return;
    if (current.syncEnabled) {
        deliverUpdates(from, updates);
        return;
    }
    setTransport({
        ...current,
        outbox: {
            ...current.outbox,
            [from]: [...(current.outbox[from] ?? []), ...updates],
        },
    });
}

function toggleTransportSync(
    current: TransportState,
    setTransport: SetTransport,
    deliverUpdates: (from: ReplicaId, updates: CrdtUpdate[]) => void,
) {
    if (current.syncEnabled) {
        setTransport({...current, syncEnabled: false});
        return;
    }

    const queued = current.outbox;
    setTransport({syncEnabled: true, outbox: emptyOutbox()});
    for (const replica of replicas) deliverUpdates(replica.id, queued[replica.id] ?? []);
}
