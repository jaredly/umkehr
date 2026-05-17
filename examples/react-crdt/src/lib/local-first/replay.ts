import {applyRemoteHistoryUpdate, createCrdtLocalHistory, type CrdtDocument} from 'umkehr/crdt';
import type {CrdtLocalHistory} from 'umkehr/crdt';
import {advanceVector, vectorDominates, vectorForUpdates} from './vector';
import type {PersistedBatch, VersionVector} from './types';

export type PendingSnapshot<TState> = {
    actor: string;
    document: CrdtDocument<TState>;
    compactedThrough: VersionVector;
};

export type ReplayPreview<TState> = {
    actor: string;
    compactedThrough: VersionVector;
    localBatches: PersistedBatch[];
    skippedUpdates: number;
    history: CrdtLocalHistory<TState>;
    vector: VersionVector;
};

export function buildSnapshotReplayPreview<TState>({
    pending,
    localReplicaId,
    batches,
}: {
    pending: PendingSnapshot<TState>;
    localReplicaId: string;
    batches: PersistedBatch[];
}): ReplayPreview<TState> {
    const localBatches = batches.filter(
        (batch) =>
            batch.origin === localReplicaId &&
            !vectorDominates(pending.compactedThrough, vectorForUpdates(batch.updates)),
    );
    let history = createCrdtLocalHistory(pending.document);
    let vector = {...pending.compactedThrough};
    let skippedUpdates = 0;
    for (const batch of localBatches) {
        for (const update of batch.updates) {
            const before = history;
            try {
                history = applyRemoteHistoryUpdate(history, update);
                if (history.doc.pending.length > before.doc.pending.length) {
                    history = before;
                    skippedUpdates += 1;
                }
            } catch {
                skippedUpdates += 1;
            }
        }
        vector = advanceVector(vector, batch.updates);
    }
    return {
        actor: pending.actor,
        compactedThrough: pending.compactedThrough,
        localBatches,
        skippedUpdates,
        history,
        vector,
    };
}
