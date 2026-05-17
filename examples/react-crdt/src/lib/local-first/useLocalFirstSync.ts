import {useCallback, useEffect, useMemo, useRef} from 'react';
import {hlc, type CrdtLocalHistory, type CrdtUpdate} from 'umkehr/crdt';
import type {SyncedTransport} from 'umkehr/react-crdt';
import {createExternalStore} from '../store';
import {
    appendBatch,
    clearReplica,
    countBatches,
    countReceivedBatches,
    saveReplica,
} from './persistence';
import {batchTimestampRange, advanceVector} from './vector';
import type {
    LocalFirstConnectionInfo,
    LocalFirstPersistenceState,
    LocalFirstRole,
    LocalFirstStats,
    LocalFirstSync,
    LocalFirstSyncState,
    PersistedBatch,
    PersistedReplica,
    ReplicaIdentity,
    VersionVector,
} from './types';

export function useLocalFirstSync<TState>({
    docId,
    schemaFingerprint,
    identity,
    initialHistory,
    initialVector,
    source,
}: {
    docId: string;
    schemaFingerprint: string;
    identity: ReplicaIdentity;
    initialHistory: CrdtLocalHistory<TState>;
    initialVector: VersionVector;
    source: 'created' | 'loaded';
}): LocalFirstSync<TState> {
    const historyRef = useRef(initialHistory);
    const vectorRef = useRef(initialVector);
    const sourceRef = useRef(source);
    const clockRef = useRef(initialClock(identity.replicaId, initialVector));
    const listenersRef = useRef(new Set<(update: CrdtUpdate) => void>());

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
                retainedBatches: 0,
                receivedBatches: 0,
                pendingUpdates: initialHistory.doc.pending.length,
            }),
        [initialHistory, initialVector],
    );
    const connectionsStore = useMemo(
        () => createExternalStore<LocalFirstConnectionInfo[]>([]),
        [],
    );

    const refreshCounts = useCallback(async () => {
        const [retainedBatches, receivedBatches] = await Promise.all([
            countBatches(docId),
            countReceivedBatches(docId),
        ]);
        statsStore.setSnapshot({
            vector: vectorRef.current,
            retainedBatches,
            receivedBatches,
            pendingUpdates: historyRef.current.doc.pending.length,
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
                await persistReplica();
            } catch (error) {
                persistenceStore.setSnapshot({
                    kind: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
        [docId, identity.replicaId, persistReplica, persistenceStore],
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

    useEffect(() => {
        void refreshCounts();
    }, [refreshCounts]);

    return useMemo(
        () => ({
            transport,
            identity,
            stateStore,
            persistenceStore,
            statsStore,
            connectionsStore,
            saveHistory,
            resetLocalReplica,
        }),
        [
            connectionsStore,
            identity,
            persistenceStore,
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
