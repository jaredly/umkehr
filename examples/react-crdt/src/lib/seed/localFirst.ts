import type {PersistedBatch, PersistedReplica, ReplicaIdentity, VersionVector} from '../local-first/types';
import {advanceVector, batchTimestampRange} from '../local-first/vector';
import {assertBranchFreeSeedFixture, mainBranchHistory, type SeedFixture} from './generate';

export function deterministicSeedIdentity(fixture: Pick<SeedFixture, 'docId' | 'createdAt'>): ReplicaIdentity {
    return {
        replicaId: `seed-replica-${fixture.docId}`,
        createdAt: fixture.createdAt,
    };
}

export function createLocalFirstSeedReplica<TState>({
    fixture,
    identity = deterministicSeedIdentity(fixture),
}: {
    fixture: SeedFixture<TState>;
    identity?: ReplicaIdentity;
}): {identity: ReplicaIdentity; replica: PersistedReplica<TState>; batches: PersistedBatch[]} {
    assertBranchFreeSeedFixture(fixture);
    const history = structuredClone(mainBranchHistory(fixture)) as import('umkehr/crdt').CrdtLocalHistory<TState>;
    let vector: VersionVector = {};
    const batches: PersistedBatch[] = [];

    for (const event of fixture.events) {
        if (event.kind !== 'update') continue;
        const updates = [event.update];
        vector = advanceVector(vector, updates);
        batches.push({
            docId: fixture.docId,
            batchId: `seed-${String(event.eventIndex).padStart(6, '0')}`,
            origin: event.origin,
            updates,
            ...batchTimestampRange(updates),
            vectorAfter: {...vector},
            receivedAt: event.receivedAt,
        });
    }

    return {
        identity,
        replica: {
            docId: fixture.docId,
            storageVersion: 1,
            protocolVersion: 1,
            schemaVersion: fixture.schemaVersion,
            schemaFingerprint: fixture.schemaFingerprint,
            schemaFingerprintHash: fixture.schemaFingerprintHash,
            replicaId: identity.replicaId,
            history,
            vector,
            updatedAt: fixture.lastAccessedAt,
        },
        batches,
    };
}
