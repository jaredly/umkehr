import {useCallback, useEffect, useMemo, useRef} from 'react';
import Peer, {type DataConnection} from 'peerjs';
import {
    applyRemoteHistoryUpdate,
    createCrdtLocalHistory,
    hlc,
    type CrdtDocument,
    type CrdtLocalHistory,
    type CrdtUpdate,
} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import {createExternalStore} from '../store';
import {
    appendBatch,
    clearReplica,
    countBatches,
    countReceivedBatches,
    deleteBatch,
    hasReceivedBatch,
    listBatches,
    markReceivedBatch,
    saveReplica,
} from './persistence';
import {
    batchTimestampRange,
    advanceVector,
    vectorDominates,
    vectorForUpdates,
} from './vector';
import {batchKey, createRecentBatchCache} from './recentBatchCache';
import {
    LOCAL_FIRST_PROTOCOL_VERSION,
    parseLocalFirstMessage,
    type LocalFirstMessage,
    type LocalFirstProtocolConfig,
} from './protocol';
import type {
    LocalFirstConnectionInfo,
    LocalFirstPersistenceState,
    LocalFirstRole,
    LocalFirstStats,
    LocalFirstSync,
    LocalFirstSyncState,
    LocalFirstMember,
    PersistedBatch,
    PersistedReplica,
    ReplicaIdentity,
    VersionVector,
} from './types';

type ConnectionRecord<TState> = {
    conn: DataConnection;
    actor?: string;
    role?: LocalFirstRole;
    queued: LocalFirstMessage<TState>[];
    error?: string;
    lastSyncAt?: string;
};

type PendingSnapshot<TState> = {
    actor: string;
    document: CrdtDocument<TState>;
    compactedThrough: VersionVector;
};

export function useLocalFirstSync<TState>({
    docId,
    schema,
    tagKey,
    validateState,
    schemaFingerprint,
    identity,
    initialHistory,
    initialVector,
    initialCompactedThrough,
    source,
    initialPeerId,
    replaceHistory,
}: {
    docId: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    tagKey: string;
    validateState(input: unknown): IValidation<TState>;
    schemaFingerprint: string;
    identity: ReplicaIdentity;
    initialHistory: CrdtLocalHistory<TState>;
    initialVector: VersionVector;
    initialCompactedThrough?: VersionVector;
    source: 'created' | 'loaded';
    initialPeerId?: string;
    replaceHistory(history: CrdtLocalHistory<TState>): void;
}): LocalFirstSync<TState> {
    const historyRef = useRef(initialHistory);
    const vectorRef = useRef(initialVector);
    const compactedThroughRef = useRef<VersionVector | undefined>(initialCompactedThrough);
    const sourceRef = useRef(source);
    const clockRef = useRef(initialClock(identity.replicaId, initialVector));
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());
    const peerRef = useRef<Peer | null>(null);
    const connectionsRef = useRef(new Map<string, ConnectionRecord<TState>>());
    const connectRef = useRef<(peerId: string) => void>(() => {});
    const recentBatchesRef = useRef(createRecentBatchCache());
    const protocolRef = useRef<LocalFirstProtocolConfig<TState>>({
        docId,
        schema,
        tagKey,
        validateState,
    });
    const pendingSnapshotRef = useRef<PendingSnapshot<TState> | null>(null);
    const snapshotStatusRef = useRef<string | undefined>(undefined);
    const compactionStatusRef = useRef<string | undefined>(undefined);

    protocolRef.current = {docId, schema, tagKey, validateState};

    const stateStore = useMemo(
        () => createExternalStore<LocalFirstSyncState>({kind: 'offline', role: 'host'}),
        [],
    );
    const persistenceStore = useMemo(
        () =>
            createExternalStore<LocalFirstPersistenceState>({
                kind: 'ready',
                source,
                savedAt: new Date().toISOString(),
            }),
        [source],
    );
    const statsStore = useMemo(
        () =>
            createExternalStore<LocalFirstStats>({
                vector: initialVector,
                compactedThrough: initialCompactedThrough,
                retainedBatches: 0,
                receivedBatches: 0,
                pendingUpdates: initialHistory.doc.pending.length,
                snapshotStatus: undefined,
                pendingSnapshot: undefined,
                compactionStatus: undefined,
            }),
        [],
    );
    const connectionsStore = useMemo(
        () => createExternalStore<LocalFirstConnectionInfo[]>([]),
        [],
    );

    const publishConnections = useCallback(() => {
        connectionsStore.setSnapshot(
            [...connectionsRef.current.values()].map(({conn, actor, role, queued, error, lastSyncAt}) => ({
                peerId: conn.peer,
                actor,
                role,
                open: conn.open,
                queuedOutgoing: queued.length,
                error,
                lastSyncAt,
            })),
        );
    }, [connectionsStore]);

    const refreshCounts = useCallback(async () => {
        const [retainedBatches, receivedBatches] = await Promise.all([
            countBatches(docId),
            countReceivedBatches(docId),
        ]);
        statsStore.setSnapshot({
            vector: vectorRef.current,
            compactedThrough: compactedThroughRef.current,
            retainedBatches,
            receivedBatches,
            pendingUpdates: historyRef.current.doc.pending.length,
            snapshotStatus: snapshotStatusRef.current,
            pendingSnapshot: pendingSnapshotRef.current
                ? {
                      actor: pendingSnapshotRef.current.actor,
                      compactedActors: Object.keys(pendingSnapshotRef.current.compactedThrough).length,
                  }
                : undefined,
            compactionStatus: compactionStatusRef.current,
        });
    }, [docId, statsStore]);

    const persistReplica = useCallback(
        async (state: LocalFirstPersistenceState = persistenceStore.getSnapshot()) => {
            const previous =
                state.kind === 'ready' || state.kind === 'saving'
                    ? state
                    : {kind: 'ready' as const, source: sourceRef.current};
            persistenceStore.setSnapshot({
                kind: 'saving',
                source: previous.source,
                savedAt: previous.savedAt,
            });
            try {
                const savedAt = new Date().toISOString();
                await saveReplica<TState>({
                    docId,
                    storageVersion: 1,
                    protocolVersion: 1,
                    schemaFingerprint,
                    replicaId: identity.replicaId,
                    history: historyRef.current,
                    vector: vectorRef.current,
                    compactedThrough: compactedThroughRef.current,
                    updatedAt: savedAt,
                } satisfies PersistedReplica<TState>);
                persistenceStore.setSnapshot({
                    kind: 'ready',
                    source: sourceRef.current,
                    savedAt,
                });
                await refreshCounts();
            } catch (error) {
                persistenceStore.setSnapshot({
                    kind: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [docId, identity.replicaId, persistenceStore, refreshCounts, schemaFingerprint],
    );

    const saveHistory = useCallback(
        (history: CrdtLocalHistory<TState>) => {
            historyRef.current = history;
            void persistReplica();
        },
        [persistReplica],
    );

    const sendOrQueue = useCallback(
        (record: ConnectionRecord<TState>, message: LocalFirstMessage<TState>) => {
            if (record.conn.open) record.conn.send(message);
            else {
                record.queued.push(message);
                publishConnections();
            }
        },
        [publishConnections],
    );

    const flushQueued = useCallback(
        (peerId?: string) => {
            const records = peerId
                ? [connectionsRef.current.get(peerId)].filter(
                      (record): record is ConnectionRecord<TState> => Boolean(record),
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

    const sendHello = useCallback(
        (record: ConnectionRecord<TState>) => {
            sendOrQueue(record, {
                kind: 'hello',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: identity.replicaId,
                peerId: peerRef.current?.id,
                docId,
                role: 'host',
                vector: vectorRef.current,
            });
        },
        [docId, identity.replicaId, sendOrQueue],
    );

    const currentMembers = useCallback((): LocalFirstMember[] => {
        const selfPeerId = peerRef.current?.id;
        const members: LocalFirstMember[] = selfPeerId
            ? [
                  {
                      peerId: selfPeerId,
                      actor: identity.replicaId,
                      role: 'host',
                      vector: vectorRef.current,
                  },
              ]
            : [];
        for (const record of connectionsRef.current.values()) {
            if (!record.actor) continue;
            members.push({
                peerId: record.conn.peer,
                actor: record.actor,
                role: record.role ?? 'host',
                vector: {},
            });
        }
        return members;
    }, [identity.replicaId]);

    const sendMembers = useCallback(
        (record?: ConnectionRecord<TState>) => {
            const message: LocalFirstMessage<TState> = {
                kind: 'members',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: identity.replicaId,
                docId,
                members: currentMembers(),
            };
            if (record) {
                sendOrQueue(record, message);
                return;
            }
            for (const connection of connectionsRef.current.values()) {
                sendOrQueue(connection, message);
            }
        },
        [currentMembers, docId, identity.replicaId, sendOrQueue],
    );

    const requestSync = useCallback(
        (peerId?: string) => {
            const records = peerId
                ? [connectionsRef.current.get(peerId)].filter(
                      (record): record is ConnectionRecord<TState> => Boolean(record),
                  )
                : [...connectionsRef.current.values()];
            for (const record of records) {
                sendOrQueue(record, {
                    kind: 'syncRequest',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: identity.replicaId,
                    docId,
                    vector: vectorRef.current,
                });
            }
        },
        [docId, identity.replicaId, sendOrQueue],
    );

    const sendSnapshot = useCallback(
        (record: ConnectionRecord<TState>) => {
            sendOrQueue(record, {
                kind: 'snapshot',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: identity.replicaId,
                docId,
                document: historyRef.current.doc,
                compactedThrough: vectorRef.current,
            });
        },
        [docId, identity.replicaId, sendOrQueue],
    );

    const installSnapshot = useCallback(
        async (document: CrdtDocument<TState>, compactedThrough: VersionVector) => {
            await clearReplica(docId);
            recentBatchesRef.current.clear();
            pendingSnapshotRef.current = null;
            compactionStatusRef.current = undefined;
            const history = createCrdtLocalHistory(document);
            historyRef.current = history;
            vectorRef.current = compactedThrough;
            compactedThroughRef.current = compactedThrough;
            sourceRef.current = 'loaded';
            snapshotStatusRef.current = 'Accepted peer snapshot.';
            replaceHistory(history);
            await persistReplica();
        },
        [docId, persistReplica, replaceHistory],
    );

    const acceptSnapshot = useCallback(
        async (
            actor: string,
            document: CrdtDocument<TState>,
            compactedThrough: VersionVector,
        ) => {
            const hasLocalKnowledge = Object.keys(vectorRef.current).length > 0;
            if (hasLocalKnowledge) {
                pendingSnapshotRef.current = {actor, document, compactedThrough};
                snapshotStatusRef.current =
                    'Peer snapshot is available, but this replica has local state.';
                await refreshCounts();
                return;
            }

            snapshotStatusRef.current = 'Accepted peer snapshot.';
            await installSnapshot(document, compactedThrough);
        },
        [installSnapshot, refreshCounts],
    );

    const sendMissingBatches = useCallback(
        async (record: ConnectionRecord<TState>, since: VersionVector) => {
            const requiresSnapshot = compactedThroughRef.current
                ? !vectorDominates(since, compactedThroughRef.current)
                : false;
            if (requiresSnapshot) sendSnapshot(record);
            const batches = (await listBatches(docId)).filter(
                (batch) => !vectorDominates(since, vectorForUpdates(batch.updates)),
            );
            sendOrQueue(record, {
                kind: 'syncResponse',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: identity.replicaId,
                docId,
                since,
                batches,
                requiresSnapshot,
            });
        },
        [docId, identity.replicaId, sendOrQueue, sendSnapshot],
    );

    const broadcastBatch = useCallback(
        (batch: PersistedBatch, exceptPeerId?: string) => {
            const message: LocalFirstMessage<TState> = {
                kind: 'updates',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: identity.replicaId,
                docId,
                batch,
            };
            for (const record of connectionsRef.current.values()) {
                if (record.conn.peer === exceptPeerId) continue;
                sendOrQueue(record, message);
            }
        },
        [docId, identity.replicaId, sendOrQueue],
    );

    const acceptBatch = useCallback(
        async (batch: PersistedBatch, fromPeerId?: string) => {
            const key = batchKey(batch.docId, batch.origin, batch.batchId);
            if (recentBatchesRef.current.has(key)) return;
            if (await hasReceivedBatch(batch.docId, batch.origin, batch.batchId)) {
                recentBatchesRef.current.add(key);
                return;
            }

            recentBatchesRef.current.add(key);
            await markReceivedBatch({
                docId: batch.docId,
                origin: batch.origin,
                batchId: batch.batchId,
                receivedAt: new Date().toISOString(),
            });
            await appendBatch(batch);
            vectorRef.current = advanceVector(vectorRef.current, batch.updates);
            const ts = batch.maxTs;
            if (ts) clockRef.current = hlc.recv(clockRef.current, hlc.unpack(ts), Date.now());
            for (const update of batch.updates) {
                for (const listener of listenersRef.current) listener(update);
            }
            await persistReplica();
            broadcastBatch(batch, fromPeerId);
        },
        [broadcastBatch, persistReplica],
    );

    const handleMessage = useCallback(
        (conn: DataConnection, input: unknown) => {
            const message = parseLocalFirstMessage(input, protocolRef.current);
            const record = connectionsRef.current.get(conn.peer);
            if (!message) {
                if (record) record.error = `Rejected invalid message from ${conn.peer}.`;
                publishConnections();
                return;
            }

            if (record) {
                record.actor = message.actor;
                if (message.kind === 'hello') record.role = message.role;
                record.lastSyncAt = new Date().toISOString();
                publishConnections();
            }

            if (message.kind === 'hello') {
                if (record) {
                    sendSnapshot(record);
                    requestSync(conn.peer);
                    sendMembers(record);
                    sendMembers();
                }
                return;
            }

            if (message.kind === 'updates') {
                void acceptBatch(message.batch, conn.peer);
                return;
            }

            if (message.kind === 'syncRequest') {
                if (record) void sendMissingBatches(record, message.vector);
                return;
            }

            if (message.kind === 'syncResponse') {
                void (async () => {
                    for (const batch of message.batches) await acceptBatch(batch, conn.peer);
                })();
                return;
            }

            if (message.kind === 'snapshot') {
                void acceptSnapshot(message.actor, message.document, message.compactedThrough);
                return;
            }

            if (message.kind === 'members') {
                const selfPeerId = peerRef.current?.id;
                for (const member of message.members) {
                    if (member.peerId === selfPeerId || member.actor === identity.replicaId) {
                        continue;
                    }
                    const existing = connectionsRef.current.get(member.peerId);
                    if (existing?.conn.open) continue;
                    connectRef.current(member.peerId);
                }
            }
        },
        [
            acceptBatch,
            acceptSnapshot,
            identity.replicaId,
            publishConnections,
            requestSync,
            sendMembers,
            sendMissingBatches,
            sendSnapshot,
        ],
    );

    const trackConnection = useCallback(
        (conn: DataConnection) => {
            const existing = connectionsRef.current.get(conn.peer);
            const record =
                existing ??
                ({
                    conn,
                    queued: [],
                } satisfies ConnectionRecord<TState>);
            record.conn = conn;
            record.error = undefined;
            connectionsRef.current.set(conn.peer, record);

            conn.on('open', () => {
                sendHello(record);
                requestSync(conn.peer);
                sendMembers(record);
                flushQueued(conn.peer);
                publishConnections();
            });
            conn.on('data', (data) => handleMessage(conn, data));
            conn.on('close', () => publishConnections());
            conn.on('error', (error) => {
                record.error = error instanceof Error ? error.message : String(error);
                publishConnections();
            });

            publishConnections();
            return record;
        },
        [flushQueued, handleMessage, publishConnections, requestSync, sendHello],
    );

    const connect = useCallback(
        (peerId: string) => {
            const peer = peerRef.current;
            const trimmed = peerId.trim();
            if (!peer || !trimmed || trimmed === peer.id) return;
            const existing = connectionsRef.current.get(trimmed);
            if (existing?.conn.open) return;
            trackConnection(peer.connect(trimmed, {serialization: 'json'}));
        },
        [trackConnection],
    );

    connectRef.current = connect;

    const disconnect = useCallback(
        (peerId: string) => {
            connectionsRef.current.get(peerId)?.conn.close();
            publishConnections();
        },
        [publishConnections],
    );

    const publishLocalBatch = useCallback(
        async (updates: CrdtUpdate[]) => {
            if (!updates.length) return;
            const {minTs, maxTs} = batchTimestampRange(updates);
            vectorRef.current = advanceVector(vectorRef.current, updates);
            const batch: PersistedBatch = {
                docId,
                batchId: crypto.randomUUID(),
                origin: identity.replicaId,
                updates,
                minTs,
                maxTs,
                vectorAfter: vectorRef.current,
                receivedAt: new Date().toISOString(),
            };

            try {
                await appendBatch(batch);
                await markReceivedBatch({
                    docId,
                    origin: identity.replicaId,
                    batchId: batch.batchId,
                    receivedAt: batch.receivedAt,
                });
                recentBatchesRef.current.add(batchKey(docId, identity.replicaId, batch.batchId));
                await persistReplica();
                broadcastBatch(batch);
            } catch (error) {
                persistenceStore.setSnapshot({
                    kind: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [broadcastBatch, docId, identity.replicaId, persistReplica, persistenceStore],
    );

    const transport = useMemo(
        (): SyncedTransport => ({
            actor: identity.replicaId,
            tick() {
                clockRef.current = hlc.inc(clockRef.current, Date.now());
                return clockRef.current;
            },
            publish(updates) {
                void publishLocalBatch(updates);
            },
            subscribe(receive) {
                listenersRef.current.add(receive);
                return () => {
                    listenersRef.current.delete(receive);
                };
            },
        }),
        [identity.replicaId, publishLocalBatch],
    );

    const resetLocalReplica = useCallback(async () => {
        await clearReplica(docId);
        window.location.reload();
    }, [docId]);

    const compactRetainedLog = useCallback(async () => {
        const frontier = {...vectorRef.current};
        const batches = await listBatches(docId);
        const deletable = batches.filter((batch) =>
            vectorDominates(frontier, vectorForUpdates(batch.updates)),
        );
        await Promise.all(deletable.map(deleteBatch));
        compactedThroughRef.current = frontier;
        compactionStatusRef.current = `Compacted ${deletable.length} retained batch${
            deletable.length === 1 ? '' : 'es'
        }.`;
        await persistReplica();
        await refreshCounts();
    }, [docId, persistReplica, refreshCounts]);

    const discardLocalAndAcceptSnapshot = useCallback(async () => {
        const pending = pendingSnapshotRef.current;
        if (!pending) return;
        snapshotStatusRef.current = `Accepted snapshot from ${pending.actor} and discarded local retained log.`;
        await installSnapshot(pending.document, pending.compactedThrough);
        await refreshCounts();
    }, [installSnapshot, refreshCounts]);

    const replayLocalBatchesOnSnapshot = useCallback(async () => {
        const pending = pendingSnapshotRef.current;
        if (!pending) return;

        const localBatches = (await listBatches(docId)).filter(
            (batch) =>
                batch.origin === identity.replicaId &&
                !vectorDominates(pending.compactedThrough, vectorForUpdates(batch.updates)),
        );
        let history = createCrdtLocalHistory(pending.document);
        let vector = {...pending.compactedThrough};
        for (const batch of localBatches) {
            for (const update of batch.updates) {
                history = applyRemoteHistoryUpdate(history, update);
            }
            vector = advanceVector(vector, batch.updates);
        }

        await clearReplica(docId);
        recentBatchesRef.current.clear();
        pendingSnapshotRef.current = null;
        historyRef.current = history;
        vectorRef.current = vector;
        compactedThroughRef.current = pending.compactedThrough;
        sourceRef.current = 'loaded';
        snapshotStatusRef.current = `Replayed ${localBatches.length} local batch${
            localBatches.length === 1 ? '' : 'es'
        } on snapshot from ${pending.actor}.`;
        replaceHistory(history);
        await persistReplica();
        for (const batch of localBatches) {
            await appendBatch(batch);
            await markReceivedBatch({
                docId,
                origin: batch.origin,
                batchId: batch.batchId,
                receivedAt: new Date().toISOString(),
            });
        }
        await refreshCounts();
    }, [docId, identity.replicaId, persistReplica, refreshCounts, replaceHistory]);

    useEffect(() => {
        void refreshCounts();
    }, [refreshCounts]);

    useEffect(() => {
        const peer = new Peer({debug: 1});
        peerRef.current = peer;
        stateStore.setSnapshot({kind: 'initializing', role: 'host'});

        peer.on('open', (peerId) => {
            stateStore.setSnapshot({kind: 'ready', role: 'host', peerId});
            if (initialPeerId) connect(initialPeerId);
        });
        peer.on('connection', (conn) => {
            trackConnection(conn);
        });
        peer.on('error', (error) => {
            stateStore.setSnapshot({
                kind: 'error',
                role: 'host',
                message: error instanceof Error ? error.message : String(error),
            });
        });

        return () => {
            for (const record of connectionsRef.current.values()) record.conn.close();
            connectionsRef.current.clear();
            peer.destroy();
            if (peerRef.current === peer) peerRef.current = null;
            stateStore.setSnapshot({kind: 'offline', role: 'host'});
            publishConnections();
        };
    }, [connect, initialPeerId, publishConnections, stateStore, trackConnection]);

    return useMemo(
        () => ({
            transport,
            identity,
            stateStore,
            persistenceStore,
            statsStore,
            connectionsStore,
            connect,
            disconnect,
            requestSync,
            compactRetainedLog,
            discardLocalAndAcceptSnapshot,
            replayLocalBatchesOnSnapshot,
            saveHistory,
            resetLocalReplica,
        }),
        [
            compactRetainedLog,
            connect,
            connectionsStore,
            discardLocalAndAcceptSnapshot,
            disconnect,
            identity,
            persistenceStore,
            requestSync,
            replayLocalBatchesOnSnapshot,
            resetLocalReplica,
            saveHistory,
            stateStore,
            statsStore,
            transport,
        ],
    );
}

function initialClock(replicaId: string, vector: VersionVector) {
    const localTimestamp = vector[replicaId];
    return localTimestamp ? hlc.unpack(localTimestamp) : hlc.init(replicaId, Date.now());
}
