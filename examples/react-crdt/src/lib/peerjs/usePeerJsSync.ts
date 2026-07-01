import {useCallback, useEffect, useMemo, useRef} from 'react';
import Peer, {type DataConnection} from 'peerjs';
import type {EphemeralMessage} from 'umkehr';
import {hlc, latestCrdtUpdateBatchTimestamp, type CrdtDocument, type CrdtUpdate} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import {createExternalStore} from '../store';
import {
    PEER_PROTOCOL_VERSION,
    parsePeerMessage,
    type PeerMessage,
    type PeerProtocolConfig,
} from './protocol';
import {peerOptions} from './peerOptions';
import type {PeerConnectionInfo, PeerJsSync, PeerRole, PeerSyncState} from './types';
import type {SerializedArtifact} from '../artifacts';

type ConnectionRecord<TState> = {
    conn: DataConnection;
    actor?: string;
    role?: PeerRole;
    open: boolean;
    queued: PeerMessage<TState>[];
    gotSnapshot: boolean;
    error?: string;
};

export function usePeerJsSync<TState>({
    role,
    actor,
    initialDocument,
    initialArtifacts = [],
    onArtifacts,
    protocol,
}: {
    role: PeerRole;
    actor: string;
    initialDocument?: CrdtDocument<TState>;
    initialArtifacts?: SerializedArtifact[];
    onArtifacts?: (artifacts: SerializedArtifact[]) => void;
    protocol: PeerProtocolConfig<TState>;
}): PeerJsSync<TState> {
    const peerRef = useRef<Peer | null>(null);
    const roleRef = useRef(role);
    const actorRef = useRef(actor);
    const protocolRef = useRef(protocol);
    const clockRef = useRef(hlc.init(actor, Date.now()));
    const snapshotRef = useRef<CrdtDocument<TState> | undefined>(initialDocument);
    const artifactsRef = useRef<SerializedArtifact[]>(initialArtifacts);
    const onArtifactsRef = useRef(onArtifacts);
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());
    const ephemeralListenersRef = useRef(new Set<(message: EphemeralMessage<unknown>) => void>());
    const connectionsRef = useRef(new Map<string, ConnectionRecord<TState>>());
    const lastHostPeerIdRef = useRef<string | null>(null);

    const stateStore = useMemo(
        () => createExternalStore<PeerSyncState>({kind: 'initializing', role}),
        [role],
    );
    const connectionsStore = useMemo(() => createExternalStore<PeerConnectionInfo[]>([]), []);
    const snapshotStore = useMemo(() => createExternalStore<CrdtDocument<TState> | null>(null), []);

    roleRef.current = role;
    actorRef.current = actor;
    protocolRef.current = protocol;
    snapshotRef.current = initialDocument ?? snapshotRef.current;
    artifactsRef.current = initialArtifacts;
    onArtifactsRef.current = onArtifacts;

    const publishConnections = useCallback(() => {
        connectionsStore.setSnapshot(
            [...connectionsRef.current.values()].map(({conn, actor, role, open, queued, error}) => ({
                peerId: conn.peer,
                actor,
                role,
                open: open && conn.open,
                queuedOutgoing: queued.length,
                error,
            })),
        );
    }, [connectionsStore]);

    const setPeerError = useCallback(
        (message: string, conn?: DataConnection) => {
            if (conn) {
                const record = connectionsRef.current.get(conn.peer);
                if (record) record.error = message;
                publishConnections();
            }
            stateStore.setSnapshot({kind: 'error', role: roleRef.current, message});
        },
        [publishConnections, stateStore],
    );

    const sendOrQueue = useCallback(
        (record: ConnectionRecord<TState>, message: PeerMessage<TState>) => {
            if (record.open && record.conn.open) {
                try {
                    record.conn.send(message);
                } catch (error) {
                    setPeerError(
                        `Failed to send ${message.kind} message to ${record.conn.peer}: ${errorMessage(error)}`,
                        record.conn,
                    );
                }
            } else {
                record.queued.push(message);
                publishConnections();
            }
        },
        [publishConnections, setPeerError],
    );

    const flushQueued = useCallback(
        (peerId?: string) => {
            const records = peerId
                ? [connectionsRef.current.get(peerId)].filter(
                      (record): record is ConnectionRecord<TState> => Boolean(record),
                  )
                : [...connectionsRef.current.values()];

            for (const record of records) {
                if (!record.open || !record.conn.open || !record.queued.length) continue;
                const queued = record.queued;
                record.queued = [];
                for (const message of queued) sendOrQueue(record, message);
            }
            publishConnections();
        },
        [publishConnections, sendOrQueue],
    );

    const sendHello = useCallback(
        (record: ConnectionRecord<TState>) => {
            sendOrQueue(record, {
                kind: 'hello',
                version: PEER_PROTOCOL_VERSION,
                actor: actorRef.current,
                docId: protocolRef.current.docId,
                role: roleRef.current,
            });
        },
        [sendOrQueue],
    );

    const sendSnapshot = useCallback(
        (
            record: ConnectionRecord<TState>,
            document = snapshotRef.current,
            artifacts = artifactsRef.current,
        ) => {
            if (roleRef.current !== 'host' || !document) return;
            sendOrQueue(record, {
                kind: 'snapshot',
                version: PEER_PROTOCOL_VERSION,
                actor: actorRef.current,
                docId: protocolRef.current.docId,
                document,
                artifacts,
            });
        },
        [sendOrQueue],
    );

    const broadcastSnapshot = useCallback(
        (document: CrdtDocument<TState>, artifacts: SerializedArtifact[] = artifactsRef.current) => {
            if (roleRef.current !== 'host') return;
            snapshotRef.current = document;
            artifactsRef.current = artifacts;
            for (const record of connectionsRef.current.values()) sendSnapshot(record, document, artifacts);
        },
        [sendSnapshot],
    );

    const deliverUpdates = useCallback((updates: readonly CrdtUpdate[]) => {
        const ts = latestCrdtUpdateBatchTimestamp(updates);
        if (ts) clockRef.current = hlc.recv(clockRef.current, hlc.unpack(ts), Date.now());
        for (const update of updates) {
            for (const listener of listenersRef.current) listener(update);
        }
    }, []);

    const broadcastFromHost = useCallback(
        (updates: CrdtUpdate[], exceptPeerId?: string) => {
            if (!updates.length) return;
            const message = createUpdatesMessage<TState>(
                actorRef.current,
                protocolRef.current.docId,
                updates,
            );
            for (const record of connectionsRef.current.values()) {
                if (record.conn.peer === exceptPeerId) continue;
                sendOrQueue(record, message);
            }
        },
        [sendOrQueue],
    );

    const deliverEphemeral = useCallback((messages: readonly EphemeralMessage<unknown>[]) => {
        for (const message of messages) {
            for (const listener of ephemeralListenersRef.current) listener(message);
        }
    }, []);

    const broadcastEphemeralFromHost = useCallback(
        (messages: EphemeralMessage<unknown>[], exceptPeerId?: string) => {
            if (!messages.length) return;
            const peerMessages = createEphemeralMessages<TState>(
                protocolRef.current.docId,
                messages,
            );
            for (const record of connectionsRef.current.values()) {
                if (record.conn.peer === exceptPeerId) continue;
                for (const message of peerMessages) sendOrQueue(record, message);
            }
        },
        [sendOrQueue],
    );

    const handleMessage = useCallback(
        (conn: DataConnection, input: unknown) => {
            const message = parsePeerMessage(input, protocolRef.current);
            if (!message) {
                setPeerError(`Rejected invalid message from ${conn.peer}.`, conn);
                return;
            }

            const record = connectionsRef.current.get(conn.peer);
            if (record) {
                record.actor = message.actor;
                if (message.kind === 'hello') record.role = message.role;
                publishConnections();
            }

            if (message.kind === 'hello') {
                if (roleRef.current === 'host') sendSnapshot(record ?? trackConnection(conn));
                return;
            }

            if (message.kind === 'snapshot') {
                if (roleRef.current !== 'client') return;
                const current = snapshotStore.getSnapshot();
                if (message.artifacts?.length) onArtifactsRef.current?.(message.artifacts);
                snapshotStore.setSnapshot(message.document);
                if (!current) {
                    if (record) record.gotSnapshot = true;
                    stateStore.setSnapshot({
                        kind: 'ready',
                        role: 'client',
                        peerId: peerRef.current?.id ?? '',
                    });
                    flushQueued(conn.peer);
                }
                return;
            }

            if (message.kind === 'updates') {
                deliverUpdates(message.updates);
                if (roleRef.current === 'host') broadcastFromHost(message.updates, conn.peer);
                return;
            }

            if (message.kind === 'ephemeral') {
                deliverEphemeral(message.messages);
                if (roleRef.current === 'host') {
                    broadcastEphemeralFromHost(message.messages, conn.peer);
                }
            }
        },
        [
            broadcastEphemeralFromHost,
            broadcastFromHost,
            deliverEphemeral,
            deliverUpdates,
            flushQueued,
            publishConnections,
            setPeerError,
            snapshotStore,
            stateStore,
        ],
    );

    const trackConnection = useCallback(
        (conn: DataConnection): ConnectionRecord<TState> => {
            const existing = connectionsRef.current.get(conn.peer);
            const record =
                existing ??
                ({
                    conn,
                    open: conn.open,
                    queued: [],
                    gotSnapshot: roleRef.current === 'host',
                } satisfies ConnectionRecord<TState>);

            record.conn = conn;
            record.open = conn.open;
            record.error = undefined;
            connectionsRef.current.set(conn.peer, record);

            conn.on('open', () => {
                record.open = true;
                sendHello(record);
                if (roleRef.current === 'host') sendSnapshot(record);
                if (record.gotSnapshot || roleRef.current === 'host') flushQueued(conn.peer);
                publishConnections();
            });
            conn.on('data', (data) => handleMessage(conn, data));
            conn.on('close', () => {
                record.open = false;
                publishConnections();
            });
            conn.on('iceStateChanged', (state) => {
                if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                    record.open = false;
                    publishConnections();
                    return;
                }
                if (state === 'connected' || state === 'completed') {
                    record.open = conn.open;
                    publishConnections();
                }
            });
            conn.on('error', (error) => {
                setPeerError(`Peer connection error with ${conn.peer}: ${errorMessage(error)}`, conn);
            });

            publishConnections();
            return record;
        },
        [flushQueued, handleMessage, publishConnections, sendHello, sendSnapshot, setPeerError],
    );

    const transport = useMemo(
        (): SyncedTransport => ({
            actor,
            tick() {
                clockRef.current = hlc.inc(clockRef.current, Date.now());
                return clockRef.current;
            },
            publish(updates) {
                if (!updates.length) return;
                if (roleRef.current === 'host') {
                    broadcastFromHost(updates);
                    return;
                }

                const hostPeerId = lastHostPeerIdRef.current;
                const record = hostPeerId ? connectionsRef.current.get(hostPeerId) : undefined;
                if (record) {
                    sendOrQueue(
                        record,
                        createUpdatesMessage<TState>(
                            actorRef.current,
                            protocolRef.current.docId,
                            updates,
                        ),
                    );
                }
            },
            subscribe(receive) {
                listenersRef.current.add(receive);
                return () => {
                    listenersRef.current.delete(receive);
                };
            },
            publishEphemeral<Data>(messages: EphemeralMessage<Data>[]) {
                if (!messages.length) return;
                if (roleRef.current === 'host') {
                    broadcastEphemeralFromHost(messages);
                    return;
                }

                const hostPeerId = lastHostPeerIdRef.current;
                const record = hostPeerId ? connectionsRef.current.get(hostPeerId) : undefined;
                if (record) {
                    sendOrQueue(
                        record,
                        createEphemeralMessage<TState>(
                            actorRef.current,
                            protocolRef.current.docId,
                            messages,
                        ),
                    );
                }
            },
            subscribeEphemeral<Data>(receive: (message: EphemeralMessage<Data>) => void) {
                const listener = receive as (message: EphemeralMessage<unknown>) => void;
                ephemeralListenersRef.current.add(listener);
                return () => {
                    ephemeralListenersRef.current.delete(listener);
                };
            },
        }),
        [actor, broadcastEphemeralFromHost, broadcastFromHost, sendOrQueue],
    );

    const connect = useCallback(
        (peerId: string) => {
            const peer = peerRef.current;
            const trimmed = peerId.trim();
            if (!peer || !trimmed) return;
            lastHostPeerIdRef.current = trimmed;
            const conn = peer.connect(trimmed, {serialization: 'binary'});
            trackConnection(conn);
            if (roleRef.current === 'client') {
                stateStore.setSnapshot({
                    kind: 'waiting-for-snapshot',
                    role: 'client',
                    peerId: peer.id,
                    hostPeerId: trimmed,
                });
            }
        },
        [stateStore, trackConnection],
    );

    const disconnect = useCallback(
        (peerId: string) => {
            const record = connectionsRef.current.get(peerId);
            if (record) {
                record.open = false;
                record.conn.close();
            }
            publishConnections();
        },
        [publishConnections],
    );

    const destroy = useCallback(() => {
        for (const record of connectionsRef.current.values()) record.conn.close();
        connectionsRef.current.clear();
        peerRef.current?.destroy();
        peerRef.current = null;
        publishConnections();
    }, [publishConnections]);

    const setSnapshotDocument = useCallback((document: CrdtDocument<TState>) => {
        snapshotRef.current = document;
    }, []);

    useEffect(() => {
        const peer = new Peer(peerOptions());
        peerRef.current = peer;
        stateStore.setSnapshot({kind: 'initializing', role});

        peer.on('open', (peerId) => {
            stateStore.setSnapshot({kind: 'ready', role, peerId});
        });
        peer.on('connection', (conn) => {
            trackConnection(conn);
        });
        peer.on('error', (error) => {
            stateStore.setSnapshot({
                kind: 'error',
                role,
                message: error instanceof Error ? error.message : String(error),
            });
        });

        return () => {
            peer.destroy();
            if (peerRef.current === peer) peerRef.current = null;
            connectionsRef.current.clear();
            publishConnections();
        };
    }, [publishConnections, role, stateStore, trackConnection]);

    return useMemo(
        () => ({
            transport,
            stateStore,
            connectionsStore,
            snapshotStore,
            connect,
            disconnect,
            flushQueued,
            setSnapshotDocument,
            broadcastSnapshot,
            destroy,
        }),
        [
            broadcastSnapshot,
            connect,
            connectionsStore,
            destroy,
            disconnect,
            flushQueued,
            setSnapshotDocument,
            snapshotStore,
            stateStore,
            transport,
        ],
    );
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function createUpdatesMessage<TState>(
    actor: string,
    docId: string,
    updates: CrdtUpdate[],
): PeerMessage<TState> {
    return {
        kind: 'updates',
        version: PEER_PROTOCOL_VERSION,
        actor,
        docId,
        batchId: crypto.randomUUID(),
        updates,
    };
}

function createEphemeralMessage<TState>(
    actor: string,
    docId: string,
    messages: EphemeralMessage<unknown>[],
): PeerMessage<TState> {
    return {
        kind: 'ephemeral',
        version: PEER_PROTOCOL_VERSION,
        actor,
        docId,
        messages,
    };
}

function createEphemeralMessages<TState>(
    docId: string,
    messages: EphemeralMessage<unknown>[],
): PeerMessage<TState>[] {
    const messagesByActor = new Map<string, EphemeralMessage<unknown>[]>();
    for (const message of messages) {
        const group = messagesByActor.get(message.actor);
        if (group) {
            group.push(message);
        } else {
            messagesByActor.set(message.actor, [message]);
        }
    }
    return [...messagesByActor].map(([actor, group]) =>
        createEphemeralMessage<TState>(actor, docId, group),
    );
}
