import {useCallback, useMemo, useRef, type MutableRefObject} from 'react';
import type {CrdtUpdate} from 'umkehr/crdt';
import {createStatusStore, type EphemeralMessage, type StatusStore} from 'umkehr/react-crdt';
import {createExternalStore, type ExternalStore} from '../store';
import {createDemoTransport, replicas, type DemoTransport, type ReplicaId} from './model';
import {statusForWhiteboardSelection, whiteboardSelectionStatusId} from '../server/presence';
import type {ServerPresenceSession} from '../server/types';

export type TransportState = {
    syncEnabled: boolean;
    outbox: Record<ReplicaId, CrdtUpdate[]>;
};

type SetTransport = (next: TransportState) => void;
type PublishUpdates = (from: ReplicaId, updates: CrdtUpdate[]) => void;
type PublishEphemeral = (from: ReplicaId, messages: EphemeralMessage<unknown>[]) => void;

export type DemoSync = {
    stateStore: ExternalStore<TransportState>;
    transports: Record<ReplicaId, DemoTransport>;
    statusStores: Record<ReplicaId, StatusStore>;
    toggleSync(): void;
    setPresenceSelection(from: ReplicaId, elementId: string | null): void;
};

export function useLocalDemoSync() {
    const publishRef = useRef<PublishUpdates>(() => {});
    const publishEphemeralRef = useRef<PublishEphemeral>(() => {});
    const stateStore = useMemo(
        () => createExternalStore<TransportState>({syncEnabled: true, outbox: emptyOutbox()}),
        [],
    );
    const transports = useMemo(() => createDemoTransports(publishRef, publishEphemeralRef), []);
    const statusStores = useMemo(() => createStatusStores(), []);

    const setTransport = useCallback(
        (next: TransportState) => stateStore.setSnapshot(next),
        [stateStore],
    );

    const deliverUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            deliverTransportUpdates(transports, from, updates);
        },
        [transports],
    );

    const publishUpdates = useCallback(
        (from: ReplicaId, updates: CrdtUpdate[]) => {
            broadcastTransportUpdates(
                stateStore.getSnapshot(),
                setTransport,
                deliverUpdates,
                from,
                updates,
            );
        },
        [deliverUpdates, setTransport, stateStore],
    );

    const publishEphemeralMessages = useCallback(
        (from: ReplicaId, messages: EphemeralMessage<unknown>[]) => {
            broadcastTransportEphemeral(
                stateStore.getSnapshot(),
                (source, nextMessages) => {
                    deliverTransportEphemeral(transports, source, nextMessages);
                },
                from,
                messages,
            );
        },
        [stateStore, transports],
    );

    const toggleSync = useCallback(() => {
        toggleTransportSync(stateStore.getSnapshot(), setTransport, deliverUpdates);
    }, [deliverUpdates, setTransport, stateStore]);

    const setPresenceSelection = useCallback(
        (from: ReplicaId, elementId: string | null) => {
            broadcastPresenceSelection(statusStores, from, elementId);
        },
        [statusStores],
    );

    publishRef.current = publishUpdates;
    publishEphemeralRef.current = publishEphemeralMessages;

    return useMemo(
        (): DemoSync => ({
            stateStore,
            transports,
            statusStores,
            toggleSync,
            setPresenceSelection,
        }),
        [setPresenceSelection, stateStore, statusStores, transports, toggleSync],
    );
}

function createDemoTransports(
    ref: MutableRefObject<PublishUpdates>,
    ephemeralRef: MutableRefObject<PublishEphemeral>,
) {
    return Object.fromEntries(
        replicas.map((replica) => [
            replica.id,
            createDemoTransport(
                replica.id,
                (from, updates) => ref.current(from, updates),
                (from, messages) => ephemeralRef.current(from, messages),
            ),
        ]),
    ) as Record<ReplicaId, DemoTransport>;
}

function emptyOutbox(): Record<ReplicaId, CrdtUpdate[]> {
    return Object.fromEntries(replicas.map((replica) => [replica.id, []]));
}

function createStatusStores() {
    return Object.fromEntries(
        replicas.map((replica) => [replica.id, createStatusStore()]),
    ) as Record<ReplicaId, StatusStore>;
}

function deliverTransportUpdates(
    transports: Record<ReplicaId, DemoTransport>,
    from: ReplicaId,
    updates: CrdtUpdate[],
) {
    for (const replica of replicas) {
        if (replica.id === from) continue;
        const transport = transports[replica.id];
        for (const update of updates) transport.receive(update);
    }
}

function deliverTransportEphemeral(
    transports: Record<ReplicaId, DemoTransport>,
    from: ReplicaId,
    messages: EphemeralMessage<unknown>[],
) {
    for (const replica of replicas) {
        if (replica.id === from) continue;
        const transport = transports[replica.id];
        for (const message of messages) transport.receiveEphemeral(message);
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

function broadcastTransportEphemeral(
    current: TransportState,
    deliverEphemeral: (from: ReplicaId, messages: EphemeralMessage<unknown>[]) => void,
    from: ReplicaId,
    messages: EphemeralMessage<unknown>[],
) {
    if (!messages.length || !current.syncEnabled) return;
    deliverEphemeral(from, messages);
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

function broadcastPresenceSelection(
    statusStores: Record<ReplicaId, StatusStore>,
    from: ReplicaId,
    elementId: string | null,
) {
    const session = sessionForReplica(from);
    for (const replica of replicas) {
        if (replica.id === from) continue;
        const store = statusStores[replica.id];
        store.clear(whiteboardSelectionStatusId(from));
        if (!elementId) continue;
        store.add([
            statusForWhiteboardSelection({
                session,
                elementId,
                receivedAt: new Date().toISOString(),
            }),
        ]);
    }
}

export const __localDemoSyncTest = {
    broadcastPresenceSelection,
    broadcastTransportEphemeral,
    deliverTransportEphemeral,
};

function sessionForReplica(replicaId: ReplicaId): ServerPresenceSession {
    const replica = replicas.find((candidate) => candidate.id === replicaId);
    const nickname = replica?.title ?? replicaId;
    return {
        actor: replicaId,
        userId: replicaId,
        sessionId: replicaId,
        nickname,
        color: replicaId === 'replica-a' ? '#2563eb' : '#16a34a',
        online: true,
        lastSeenAt: new Date().toISOString(),
    };
}
