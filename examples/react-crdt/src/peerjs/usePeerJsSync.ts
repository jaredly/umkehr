import {useCallback, useEffect, useMemo, useRef} from 'react';
import Peer, {type DataConnection} from 'peerjs';
import {
    hlc,
    latestCrdtUpdateBatchTimestamp,
    type CrdtDocument,
    type CrdtUpdate,
} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import type {State} from '../model';
import {createExternalStore} from '../store';
import {PEER_PROTOCOL_VERSION, parsePeerMessage, type PeerMessage} from './protocol';
import type {PeerConnectionInfo, PeerJsSync, PeerRole, PeerSyncState} from './types';

type ConnectionRecord = {
    conn: DataConnection;
    actor?: string;
    role?: PeerRole;
    queued: PeerMessage[];
    gotSnapshot: boolean;
    error?: string;
};

export function usePeerJsSync({
    role,
    actor,
    initialDocument,
    docId,
}: {
    role: PeerRole;
    actor: string;
    initialDocument?: CrdtDocument<State>;
    docId: string;
}): PeerJsSync {
    const peerRef = useRef<Peer | null>(null);
    const roleRef = useRef(role);
    const actorRef = useRef(actor);
    const docIdRef = useRef(docId);
    const clockRef = useRef(hlc.init(actor, Date.now()));
    const snapshotRef = useRef<CrdtDocument<State> | undefined>(initialDocument);
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());
    const connectionsRef = useRef(new Map<string, ConnectionRecord>());
    const lastHostPeerIdRef = useRef<string | null>(null);

    const stateStore = useMemo(
        () => createExternalStore<PeerSyncState>({kind: 'initializing', role}),
        [role],
    );
    const connectionsStore = useMemo(() => createExternalStore<PeerConnectionInfo[]>([]), []);
    const snapshotStore = useMemo(() => createExternalStore<CrdtDocument<State> | null>(null), []);

    roleRef.current = role;
    actorRef.current = actor;
    docIdRef.current = docId;
    snapshotRef.current = initialDocument ?? snapshotRef.current;

    const publishConnections = useCallback(() => {
        connectionsStore.setSnapshot(
            [...connectionsRef.current.values()].map(({conn, actor, role, queued, error}) => ({
                peerId: conn.peer,
                actor,
                role,
                open: conn.open,
                queuedOutgoing: queued.length,
                error,
            })),
        );
    }, [connectionsStore]);

    const setProtocolError = useCallback(
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

    const flushQueued = useCallback(
        (peerId?: string) => {
            const records = peerId
                ? [connectionsRef.current.get(peerId)].filter(
                      (record): record is ConnectionRecord => Boolean(record),
                  )
                : [...connectionsRef.current.values()];

            for (const record of records) {
                if (!record.conn.open || !record.queued.length) continue;
                const queued = record.queued;
                record.queued = [];
                for (const message of queued) record.conn.send(message);
            }
            publishConnections();
        },
        [publishConnections],
    );

    const sendOrQueue = useCallback(
        (record: ConnectionRecord, message: PeerMessage) => {
            if (record.conn.open) {
                record.conn.send(message);
            } else {
                record.queued.push(message);
                publishConnections();
            }
        },
        [publishConnections],
    );

    const sendHello = useCallback(
        (record: ConnectionRecord) => {
            sendOrQueue(record, {
                kind: 'hello',
                version: PEER_PROTOCOL_VERSION,
                actor: actorRef.current,
                docId: docIdRef.current,
                role: roleRef.current,
            });
        },
        [sendOrQueue],
    );

    const sendSnapshot = useCallback(
        (record: ConnectionRecord) => {
            if (roleRef.current !== 'host' || !snapshotRef.current) return;
            sendOrQueue(record, {
                kind: 'snapshot',
                version: PEER_PROTOCOL_VERSION,
                actor: actorRef.current,
                docId: docIdRef.current,
                document: snapshotRef.current,
            });
        },
        [sendOrQueue],
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
            const message = createUpdatesMessage(actorRef.current, docIdRef.current, updates);
            for (const record of connectionsRef.current.values()) {
                if (record.conn.peer === exceptPeerId) continue;
                sendOrQueue(record, message);
            }
        },
        [sendOrQueue],
    );

    const handleMessage = useCallback(
        (conn: DataConnection, input: unknown) => {
            const message = parsePeerMessage(input, docIdRef.current);
            if (!message) {
                setProtocolError(`Rejected invalid message from ${conn.peer}.`, conn);
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
                if (!current) {
                    snapshotStore.setSnapshot(message.document);
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
            }
        },
        [
            broadcastFromHost,
            deliverUpdates,
            flushQueued,
            publishConnections,
            setProtocolError,
            snapshotStore,
            stateStore,
        ],
    );

    const trackConnection = useCallback(
        (conn: DataConnection): ConnectionRecord => {
            const existing = connectionsRef.current.get(conn.peer);
            if (existing) return existing;

            const record: ConnectionRecord = {
                conn,
                queued: [],
                gotSnapshot: roleRef.current === 'host',
            };
            connectionsRef.current.set(conn.peer, record);
            publishConnections();

            conn.on('open', () => {
                sendHello(record);
                if (roleRef.current === 'host') sendSnapshot(record);
                if (roleRef.current === 'client' && record.gotSnapshot) flushQueued(conn.peer);
                publishConnections();
            });
            conn.on('data', (data) => handleMessage(conn, data));
            conn.on('close', () => publishConnections());
            conn.on('error', (error) => {
                record.error = error instanceof Error ? error.message : String(error);
                publishConnections();
            });

            return record;
        },
        [flushQueued, handleMessage, publishConnections, sendHello, sendSnapshot],
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
                    sendOrQueue(record, createUpdatesMessage(actorRef.current, docIdRef.current, updates));
                }
            },
            subscribe(receive) {
                listenersRef.current.add(receive);
                return () => {
                    listenersRef.current.delete(receive);
                };
            },
        }),
        [actor, broadcastFromHost, sendOrQueue],
    );

    const connect = useCallback(
        (peerId: string) => {
            const peer = peerRef.current;
            const trimmed = peerId.trim();
            if (!peer || !trimmed) return;
            lastHostPeerIdRef.current = trimmed;
            const conn = peer.connect(trimmed, {serialization: 'json'});
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
            connectionsRef.current.get(peerId)?.conn.close();
            connectionsRef.current.delete(peerId);
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

    const setSnapshotDocument = useCallback((document: CrdtDocument<State>) => {
        snapshotRef.current = document;
    }, []);

    useEffect(() => {
        const peer = new Peer({debug: 1});
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
            destroy,
        }),
        [
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

function createUpdatesMessage(actor: string, docId: string, updates: CrdtUpdate[]): PeerMessage {
    return {
        kind: 'updates',
        version: PEER_PROTOCOL_VERSION,
        actor,
        docId,
        batchId: crypto.randomUUID(),
        updates,
    };
}
