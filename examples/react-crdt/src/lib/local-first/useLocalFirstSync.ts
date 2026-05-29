import {useCallback, useEffect, useMemo, useRef} from 'react';
import Peer, {type DataConnection} from 'peerjs';
import {
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
    exportReplicaState,
    hasReceivedBatch,
    importReplicaState,
    listBatches,
    markReceivedBatch,
    saveReplica,
} from './persistence';
import {peerOptions} from '../peerjs/peerOptions';
import {batchTimestampRange, advanceVector, vectorDominates, vectorForUpdates} from './vector';
import {batchKey, createRecentBatchCache} from './recentBatchCache';
import {buildSnapshotReplayPreview, type PendingSnapshot, type ReplayPreview} from './replay';
import {type LocalFirstMessage, type LocalFirstProtocolConfig} from './protocol';
import {
    createMembersMessage,
    createHelloMessage,
    createSnapshotMessage,
    createSyncRequestMessage,
    createSyncResponseMessage,
    createUpdatesMessage,
    planConnectionOpened,
    planIncomingMessage,
    type LocalFirstSessionEffect,
    type LocalFirstSessionState,
} from './session';
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
    DocumentLineage,
} from './types';

type ConnectionRecord<TState> = {
    conn: DataConnection;
    actor?: string;
    role?: LocalFirstRole;
    vector?: VersionVector;
    docId?: string;
    schemaVersion?: number;
    schemaFingerprint?: string;
    schemaFingerprintHash?: string;
    queued: LocalFirstMessage<TState>[];
    error?: string;
    lastSyncAt?: string;
};

type DiscoveredMember = LocalFirstMember & {
    sourcePeerId: string;
    lastSeenAt: string;
};

export function useLocalFirstSync<TState>({
    docId,
    title,
    schema,
    tagKey,
    validateState,
    schemaFingerprint,
    schemaFingerprintHash,
    schemaVersion,
    lineage,
    identity,
    initialHistory,
    initialVector,
    initialCompactedThrough,
    source,
    initialPeerId,
    replaceHistory,
}: {
    docId: string;
    title: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    tagKey: string;
    validateState(input: unknown): IValidation<TState>;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    schemaVersion: number;
    lineage?: DocumentLineage;
    identity: ReplicaIdentity;
    initialHistory: CrdtLocalHistory<TState>;
    initialVector: VersionVector;
    initialCompactedThrough?: VersionVector;
    source: 'created' | 'loaded' | 'migrated';
    initialPeerId?: string;
    replaceHistory(history: CrdtLocalHistory<TState>): void;
}): LocalFirstSync<TState> {
    const historyRef = useRef(initialHistory);
    const vectorRef = useRef(initialVector);
    const compactedThroughRef = useRef<VersionVector | undefined>(initialCompactedThrough);
    const sourceRef = useRef(source);
    const roleRef = useRef<LocalFirstRole>(initialPeerId ? 'client' : 'host');
    const clockRef = useRef(initialClock(identity.replicaId, initialVector));
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());
    const peerRef = useRef<Peer | null>(null);
    const connectionsRef = useRef(new Map<string, ConnectionRecord<TState>>());
    const discoveredMembersRef = useRef(new Map<string, DiscoveredMember>());
    const lastMemberUpdateAtRef = useRef<string | undefined>(undefined);
    const connectRef = useRef<(peerId: string) => void>(() => {});
    const recentBatchesRef = useRef(createRecentBatchCache());
    const protocolRef = useRef<LocalFirstProtocolConfig<TState>>({
        docId,
        schema,
        tagKey,
        validateState,
        schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
    });
    const pendingSnapshotRef = useRef<PendingSnapshot<TState> | null>(null);
    const replayPreviewRef = useRef<ReplayPreview<TState> | null>(null);
    const snapshotStatusRef = useRef<string | undefined>(undefined);
    const compactionStatusRef = useRef<string | undefined>(undefined);

    protocolRef.current = {
        docId,
        schemaVersion,
        schemaFingerprint,
        schemaFingerprintHash,
        schema,
        tagKey,
        validateState,
    };

    const stateStore = useMemo(
        () => createExternalStore<LocalFirstSyncState>({kind: 'offline', role: roleRef.current}),
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
                schemaVersion,
                lineage,
                mesh: {
                    discoveredMembers: 0,
                    directConnections: 0,
                    connectedPeers: 0,
                    lastMemberUpdateAt: undefined,
                    compactionRisks: [],
                },
                snapshotStatus: undefined,
                pendingSnapshot: undefined,
                replayPreview: undefined,
                compactionStatus: undefined,
            }),
        [],
    );
    const connectionsStore = useMemo(() => createExternalStore<LocalFirstConnectionInfo[]>([]), []);

    const publishConnections = useCallback(() => {
        connectionsStore.setSnapshot(
            [...connectionsRef.current.values()].map(
                ({
                    conn,
                    actor,
                    role,
                    vector,
                    docId: connectionDocId,
                    schemaVersion: connectionSchemaVersion,
                    schemaFingerprint: connectionSchemaFingerprint,
                    schemaFingerprintHash: connectionSchemaFingerprintHash,
                    queued,
                    error,
                    lastSyncAt,
                }) => ({
                    peerId: conn.peer,
                    actor,
                    role,
                    vector,
                    docId: connectionDocId,
                    schemaVersion: connectionSchemaVersion,
                    schemaFingerprint: connectionSchemaFingerprint,
                    schemaFingerprintHash: connectionSchemaFingerprintHash,
                    open: conn.open,
                    queuedOutgoing: queued.length,
                    error,
                    lastSyncAt,
                }),
            ),
        );
    }, [connectionsStore]);

    const meshStats = useCallback((): LocalFirstStats['mesh'] => {
        const connections = [...connectionsRef.current.values()];
        return {
            discoveredMembers: discoveredMembersRef.current.size,
            directConnections: connections.length,
            connectedPeers: connections.filter(({conn}) => conn.open).length,
            lastMemberUpdateAt: lastMemberUpdateAtRef.current,
            compactionRisks: compactionRisksForFrontier(vectorRef.current, connections),
        };
    }, []);

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
            schemaVersion,
            lineage,
            mesh: meshStats(),
            snapshotStatus: snapshotStatusRef.current,
            pendingSnapshot: pendingSnapshotRef.current
                ? {
                      actor: pendingSnapshotRef.current.actor,
                      compactedActors: Object.keys(pendingSnapshotRef.current.compactedThrough)
                          .length,
                  }
                : undefined,
            replayPreview: replayPreviewRef.current
                ? {
                      actor: replayPreviewRef.current.actor,
                      localBatches: replayPreviewRef.current.localBatches.length,
                      skippedUpdates: replayPreviewRef.current.skippedUpdates,
                      state: replayPreviewRef.current.history.doc.state,
                  }
                : undefined,
            compactionStatus: compactionStatusRef.current,
        });
    }, [docId, lineage, meshStats, schemaVersion, statsStore]);

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
                    title,
                    storageVersion: 1,
                    protocolVersion: 1,
                    schemaVersion,
                    schemaFingerprint,
                    schemaFingerprintHash,
                    replicaId: identity.replicaId,
                    history: historyRef.current,
                    vector: vectorRef.current,
                    compactedThrough: compactedThroughRef.current,
                    lineage,
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
        [
            docId,
            title,
            identity.replicaId,
            lineage,
            persistenceStore,
            refreshCounts,
            schemaFingerprint,
            schemaFingerprintHash,
            schemaVersion,
        ],
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

    const sessionState = useCallback(
        (): LocalFirstSessionState<TState> => ({
            docId,
            schemaVersion,
            schemaFingerprint,
            schemaFingerprintHash,
            replicaId: identity.replicaId,
            role: roleRef.current,
            selfPeerId: peerRef.current?.id,
            vector: vectorRef.current,
            document: historyRef.current.doc,
            connections: [...connectionsRef.current.values()].map(
                ({
                    conn,
                    actor,
                    role,
                    vector,
                    docId: connectionDocId,
                    schemaVersion: connectionSchemaVersion,
                    schemaFingerprint: connectionSchemaFingerprint,
                    schemaFingerprintHash: connectionSchemaFingerprintHash,
                }) => ({
                    peerId: conn.peer,
                    actor,
                    role,
                    vector,
                    docId: connectionDocId,
                    schemaVersion: connectionSchemaVersion,
                    schemaFingerprint: connectionSchemaFingerprint,
                    schemaFingerprintHash: connectionSchemaFingerprintHash,
                    open: conn.open,
                }),
            ),
        }),
        [docId, identity.replicaId, schemaFingerprint, schemaFingerprintHash, schemaVersion],
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

    const requestSync = useCallback(
        (peerId?: string) => {
            const records = peerId
                ? [connectionsRef.current.get(peerId)].filter(
                      (record): record is ConnectionRecord<TState> => Boolean(record),
                  )
                : [...connectionsRef.current.values()];
            const message = createSyncRequestMessage(sessionState());
            for (const record of records) {
                sendOrQueue(record, message);
            }
        },
        [sendOrQueue, sessionState],
    );

    const sendSnapshot = useCallback(
        (record: ConnectionRecord<TState>) => {
            sendOrQueue(record, createSnapshotMessage(sessionState()));
        },
        [sendOrQueue, sessionState],
    );

    const publishNetworkState = useCallback(() => {
        const role = roleRef.current;
        const peerId = peerRef.current?.id;
        stateStore.setSnapshot(peerId ? {kind: 'ready', role, peerId} : {kind: 'offline', role});
    }, [stateStore]);

    const installSnapshot = useCallback(
        async (document: CrdtDocument<TState>, compactedThrough: VersionVector) => {
            await clearReplica(docId);
            recentBatchesRef.current.clear();
            pendingSnapshotRef.current = null;
            replayPreviewRef.current = null;
            compactionStatusRef.current = undefined;
            const history = createCrdtLocalHistory(document);
            historyRef.current = history;
            vectorRef.current = compactedThrough;
            compactedThroughRef.current = compactedThrough;
            sourceRef.current = 'loaded';
            snapshotStatusRef.current = 'Accepted peer snapshot.';
            replaceHistory(history);
            await persistReplica();
            publishNetworkState();
        },
        [docId, persistReplica, publishNetworkState, replaceHistory],
    );

    const acceptSnapshot = useCallback(
        async (actor: string, document: CrdtDocument<TState>, compactedThrough: VersionVector) => {
            const hasLocalKnowledge = Object.keys(vectorRef.current).length > 0;
            if (hasLocalKnowledge) {
                pendingSnapshotRef.current = {actor, document, compactedThrough};
                replayPreviewRef.current = null;
                snapshotStatusRef.current =
                    'Peer snapshot is available, but this replica has local state.';
                stateStore.setSnapshot({
                    kind: 'needs-rebase-or-discard',
                    role: roleRef.current,
                    peerId: peerRef.current?.id,
                    actor,
                    message: 'Peer snapshot is available, but this replica has local state.',
                });
                await refreshCounts();
                return;
            }

            snapshotStatusRef.current = 'Accepted peer snapshot.';
            await installSnapshot(document, compactedThrough);
        },
        [installSnapshot, refreshCounts, stateStore],
    );

    const buildReplayPreview = useCallback(async () => {
        const pending = pendingSnapshotRef.current;
        if (!pending) return null;

        return buildSnapshotReplayPreview({
            pending,
            localReplicaId: identity.replicaId,
            batches: await listBatches(docId),
        });
    }, [docId, identity.replicaId]);

    const sendMissingBatches = useCallback(
        async (record: ConnectionRecord<TState>, since: VersionVector) => {
            const requiresSnapshot = compactedThroughRef.current
                ? !vectorDominates(since, compactedThroughRef.current)
                : false;
            if (requiresSnapshot) sendSnapshot(record);
            const batches = (await listBatches(docId)).filter(
                (batch) => !vectorDominates(since, vectorForUpdates(batch.updates)),
            );
            sendOrQueue(
                record,
                createSyncResponseMessage({
                    state: sessionState(),
                    since,
                    batches,
                    requiresSnapshot,
                }),
            );
        },
        [docId, sendOrQueue, sendSnapshot, sessionState],
    );

    const broadcastBatch = useCallback(
        (batch: PersistedBatch, exceptPeerId?: string) => {
            const message = createUpdatesMessage(sessionState(), batch);
            for (const record of connectionsRef.current.values()) {
                if (record.conn.peer === exceptPeerId) continue;
                sendOrQueue(record, message);
            }
        },
        [sendOrQueue, sessionState],
    );

    const setRole = useCallback(
        (role: LocalFirstRole) => {
            roleRef.current = role;
            publishNetworkState();
            for (const record of connectionsRef.current.values()) {
                sendOrQueue(record, createHelloMessage(sessionState()));
                sendOrQueue(record, createMembersMessage(sessionState()));
            }
        },
        [publishNetworkState, sendOrQueue, sessionState],
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
            await appendBatch(batch);
            vectorRef.current = advanceVector(vectorRef.current, batch.updates);
            const ts = batch.maxTs;
            if (ts) clockRef.current = hlc.recv(clockRef.current, hlc.unpack(ts), Date.now());
            for (const update of batch.updates) {
                for (const listener of listenersRef.current) listener(update);
            }
            await persistReplica();
            await markReceivedBatch({
                docId: batch.docId,
                origin: batch.origin,
                batchId: batch.batchId,
                receivedAt: new Date().toISOString(),
            });
            await refreshCounts();
            broadcastBatch(batch, fromPeerId);
        },
        [broadcastBatch, persistReplica, refreshCounts],
    );

    const executeEffects = useCallback(
        (effects: LocalFirstSessionEffect<TState>[]) => {
            for (const effect of effects) {
                if (effect.kind === 'markConnection') {
                    const record = connectionsRef.current.get(effect.peerId);
                    if (!record) continue;
                    record.actor = effect.actor;
                    if (effect.role) record.role = effect.role;
                    if (effect.vector) record.vector = effect.vector;
                    record.docId = effect.docId;
                    record.schemaVersion = effect.schemaVersion;
                    record.schemaFingerprint = effect.schemaFingerprint;
                    record.schemaFingerprintHash = effect.schemaFingerprintHash;
                    record.lastSyncAt = new Date().toISOString();
                    publishConnections();
                    void refreshCounts();
                    continue;
                }

                if (effect.kind === 'connectionError') {
                    const record = connectionsRef.current.get(effect.peerId);
                    if (record) record.error = effect.message;
                    if (effect.code === 'schema-mismatch') {
                        stateStore.setSnapshot({
                            kind: 'incompatible',
                            role: roleRef.current,
                            peerId: peerRef.current?.id,
                            message: effect.message,
                        });
                    }
                    publishConnections();
                    continue;
                }

                if (effect.kind === 'recordMembers') {
                    const seenAt = new Date().toISOString();
                    lastMemberUpdateAtRef.current = seenAt;
                    for (const member of effect.members) {
                        if (
                            member.peerId === peerRef.current?.id ||
                            member.actor === identity.replicaId ||
                            member.docId !== docId ||
                            member.schemaVersion !== schemaVersion ||
                            member.schemaFingerprintHash !== schemaFingerprintHash
                        ) {
                            continue;
                        }
                        discoveredMembersRef.current.set(member.peerId, {
                            ...member,
                            sourcePeerId: effect.peerId,
                            lastSeenAt: seenAt,
                        });
                    }
                    void refreshCounts();
                    continue;
                }

                if (effect.kind === 'send') {
                    const record = connectionsRef.current.get(effect.peerId);
                    if (record) sendOrQueue(record, effect.message);
                    continue;
                }

                if (effect.kind === 'broadcastMembers') {
                    const message = createMembersMessage(sessionState());
                    for (const record of connectionsRef.current.values()) {
                        if (record.conn.peer === effect.exceptPeerId) continue;
                        sendOrQueue(record, message);
                    }
                    continue;
                }

                if (effect.kind === 'sendMissingBatches') {
                    const record = connectionsRef.current.get(effect.peerId);
                    if (record) void sendMissingBatches(record, effect.since);
                    continue;
                }

                if (effect.kind === 'acceptBatch') {
                    void acceptBatch(effect.batch, effect.fromPeerId);
                    continue;
                }

                if (effect.kind === 'acceptSnapshot') {
                    void acceptSnapshot(effect.actor, effect.document, effect.compactedThrough);
                    continue;
                }

                connectRef.current(effect.peerId);
            }
        },
        [
            acceptBatch,
            acceptSnapshot,
            docId,
            identity.replicaId,
            publishConnections,
            refreshCounts,
            schemaFingerprint,
            schemaFingerprintHash,
            schemaVersion,
            sendMissingBatches,
            sendOrQueue,
            sessionState,
        ],
    );

    const handleMessage = useCallback(
        (conn: DataConnection, input: unknown) => {
            executeEffects(
                planIncomingMessage({
                    state: sessionState(),
                    peerId: conn.peer,
                    input,
                    config: protocolRef.current,
                }),
            );
        },
        [executeEffects, sessionState],
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
                executeEffects(planConnectionOpened(sessionState(), conn.peer));
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
        [executeEffects, flushQueued, handleMessage, publishConnections, sessionState],
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
            publishEphemeral(_messages) {},
            subscribeEphemeral(_receive) {
                return () => {};
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

    const previewLocalBatchesOnSnapshot = useCallback(async () => {
        const preview = await buildReplayPreview();
        if (!preview) return;
        replayPreviewRef.current = preview;
        snapshotStatusRef.current = `Previewing ${preview.localBatches.length} local batch${
            preview.localBatches.length === 1 ? '' : 'es'
        } on snapshot from ${preview.actor}.`;
        await refreshCounts();
    }, [buildReplayPreview, refreshCounts]);

    const replayLocalBatchesOnSnapshot = useCallback(async () => {
        const preview = replayPreviewRef.current ?? (await buildReplayPreview());
        if (!preview) return;

        await clearReplica(docId);
        recentBatchesRef.current.clear();
        pendingSnapshotRef.current = null;
        replayPreviewRef.current = null;
        historyRef.current = preview.history;
        vectorRef.current = preview.vector;
        compactedThroughRef.current = preview.compactedThrough;
        sourceRef.current = 'loaded';
        snapshotStatusRef.current = `Replayed ${preview.localBatches.length} local batch${
            preview.localBatches.length === 1 ? '' : 'es'
        } on snapshot from ${preview.actor}.`;
        replaceHistory(preview.history);
        await persistReplica();
        for (const batch of preview.localBatches) {
            await appendBatch(batch);
            await markReceivedBatch({
                docId,
                origin: batch.origin,
                batchId: batch.batchId,
                receivedAt: new Date().toISOString(),
            });
        }
        await refreshCounts();
    }, [buildReplayPreview, docId, persistReplica, refreshCounts, replaceHistory]);

    const exportLocalState = useCallback(() => exportReplicaState<TState>(docId), [docId]);

    const importLocalState = useCallback(
        async (json: string) => {
            await importReplicaState<TState>({
                docId,
                schemaVersion,
                schemaFingerprint,
                schemaFingerprintHash,
                json,
            });
            window.location.reload();
        },
        [docId, schemaFingerprint, schemaFingerprintHash, schemaVersion],
    );

    useEffect(() => {
        void refreshCounts();
    }, [refreshCounts]);

    useEffect(() => {
        const peer = new Peer(peerOptions());
        peerRef.current = peer;
        stateStore.setSnapshot({kind: 'initializing', role: roleRef.current});

        peer.on('open', (peerId) => {
            stateStore.setSnapshot({kind: 'ready', role: roleRef.current, peerId});
            if (initialPeerId) connect(initialPeerId);
        });
        peer.on('connection', (conn) => {
            trackConnection(conn);
        });
        peer.on('error', (error) => {
            stateStore.setSnapshot({
                kind: 'error',
                role: roleRef.current,
                message: error instanceof Error ? error.message : String(error),
            });
        });

        return () => {
            for (const record of connectionsRef.current.values()) record.conn.close();
            connectionsRef.current.clear();
            peer.destroy();
            if (peerRef.current === peer) peerRef.current = null;
            stateStore.setSnapshot({kind: 'offline', role: roleRef.current});
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
            setRole,
            requestSync,
            compactRetainedLog,
            discardLocalAndAcceptSnapshot,
            previewLocalBatchesOnSnapshot,
            replayLocalBatchesOnSnapshot,
            exportLocalState,
            importLocalState,
            saveHistory,
            resetLocalReplica,
        }),
        [
            compactRetainedLog,
            connect,
            connectionsStore,
            discardLocalAndAcceptSnapshot,
            disconnect,
            exportLocalState,
            identity,
            importLocalState,
            persistenceStore,
            previewLocalBatchesOnSnapshot,
            requestSync,
            replayLocalBatchesOnSnapshot,
            resetLocalReplica,
            saveHistory,
            setRole,
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

function compactionRisksForFrontier<TState>(
    frontier: VersionVector,
    connections: ConnectionRecord<TState>[],
): LocalFirstStats['mesh']['compactionRisks'] {
    return connections
        .filter(({conn}) => conn.open)
        .flatMap<LocalFirstStats['mesh']['compactionRisks'][number]>(({conn, actor, vector}) => {
            if (!vector) return [{peerId: conn.peer, actor, reason: 'unknown' as const}];
            if (vectorDominates(vector, frontier)) return [];
            return [{peerId: conn.peer, actor, reason: 'behind' as const}];
        });
}
