import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    applyCrdtUpdate,
    type CrdtLocalHistory,
} from 'umkehr/crdt';
import {
    migrateCrdtHistory,
    migrateCrdtUpdates,
    sha256Hex,
    type SchemaMigrationConfig,
    type VersionedSchema,
} from 'umkehr/migration';
import type {DocumentLineage, PersistedBatch, PersistedReplica, ReplicaIdentity, VersionVector} from './types';
import type {LocalFirstMigration, LocalFirstSchemaConfig} from './schemaConfig';
import {batchTimestampRange, compareBatches, vectorForUpdates} from './vector';

export const DEFAULT_SCHEMA_VERSION = 1;

export type NormalizedPersistedReplica<TState> = PersistedReplica<TState> & {
    schemaVersion: number;
    schemaFingerprintHash: string;
};

export type MigrationCandidate<TState> = {
    sourceDocId: string;
    targetDocId: string;
    sourceSchemaVersion: number;
    targetSchemaVersion: number;
    sourceSchemaFingerprint: string;
    sourceSchemaFingerprintHash: string;
    targetSchemaFingerprint: string;
    targetSchemaFingerprintHash: string;
    migrationIds: string[];
    migrations: LocalFirstMigration<unknown, unknown>[];
};

export function normalizePersistedReplica<TState>(
    replica: PersistedReplica<TState> | (Omit<PersistedReplica<TState>, 'schemaVersion'> & {schemaVersion?: number}),
): NormalizedPersistedReplica<TState> {
    return {
        ...replica,
        schemaVersion: replica.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
        schemaFingerprintHash:
            replica.schemaFingerprintHash ?? sha256Hex(replica.schemaFingerprint),
    };
}

export function findMigrationCandidate<TState>({
    source,
    current,
    currentFingerprint,
    currentFingerprintHash,
}: {
    source: PersistedReplica<unknown>;
    current: LocalFirstSchemaConfig<TState>;
    currentFingerprint: string;
    currentFingerprintHash: string;
}): MigrationCandidate<TState> | null {
    const normalized = normalizePersistedReplica(source);
    if (normalized.schemaFingerprintHash === currentFingerprintHash) return null;

    const migrations = findMigrationPath(
        normalized.schemaVersion,
        current.version,
        normalized.schemaFingerprint,
        normalized.schemaFingerprintHash,
        currentFingerprintHash,
        current.migrations,
    );
    if (!migrations.length) return null;
    const finalMigration = migrations.at(-1)!;
    const targetDocId =
        typeof finalMigration.toDocId === 'function'
            ? finalMigration.toDocId(normalized.docId)
            : finalMigration.toDocId;
    return {
        sourceDocId: normalized.docId,
        targetDocId,
        sourceSchemaVersion: normalized.schemaVersion,
        targetSchemaVersion: current.version,
        sourceSchemaFingerprint: normalized.schemaFingerprint,
        sourceSchemaFingerprintHash: normalized.schemaFingerprintHash,
        targetSchemaFingerprint: currentFingerprint,
        targetSchemaFingerprintHash: currentFingerprintHash,
        migrationIds: migrations.map(({id}) => id),
        migrations,
    };
}

export function createMigratedReplica<TState>({
    source,
    candidate,
    identity,
    schema,
    tagKey,
    validateState,
    batches = [],
    previous,
    now = new Date().toISOString(),
}: {
    source: PersistedReplica<unknown>;
    candidate: MigrationCandidate<TState>;
    identity: ReplicaIdentity;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    tagKey: string;
    validateState(input: unknown): IValidation<TState>;
    batches?: PersistedBatch[];
    previous?: VersionedSchema<unknown>[];
    now?: string;
}): {replica: PersistedReplica<TState>; batches: PersistedBatch[]} {
    const sortedBatches = batches.toSorted(compareBatches);
    const sourceHistory = retainedHistory(source.history, sortedBatches);
    const migrationConfig = createMigrationConfig({
        source,
        candidate,
        schema,
        tagKey,
        validateState,
        previous,
    });
    const from = {
        schemaVersion: candidate.sourceSchemaVersion,
        schemaFingerprintHash: candidate.sourceSchemaFingerprintHash,
        schemaFingerprint: candidate.sourceSchemaFingerprint,
    };
    const migratedHistory = migrateCrdtHistory(migrationConfig, sourceHistory, from).value;
    const migratedBatches = sortedBatches.flatMap((batch) => {
        const updates = migrateCrdtUpdates(migrationConfig, batch.updates, from).value;
        if (!updates.length) return [];
        return [
            {
                ...batch,
                docId: candidate.targetDocId,
                updates,
                ...batchTimestampRange(updates),
                vectorAfter: vectorForUpdates(updates),
            },
        ];
    });
    const vector = vectorForBatches(migratedBatches);

    const replica: PersistedReplica<TState> = {
        docId: candidate.targetDocId,
        storageVersion: 1,
        protocolVersion: 1,
        schemaVersion: candidate.targetSchemaVersion,
        schemaFingerprint: candidate.targetSchemaFingerprint,
        schemaFingerprintHash: candidate.targetSchemaFingerprintHash,
        replicaId: identity.replicaId,
        history: migratedHistory,
        vector,
        lineage: {
            sourceDocId: candidate.sourceDocId,
            sourceSchemaVersion: candidate.sourceSchemaVersion,
            sourceSchemaFingerprint: candidate.sourceSchemaFingerprint,
            migratedAt: now,
            migrationId: candidate.migrationIds.join(','),
        } satisfies DocumentLineage,
        updatedAt: now,
    };
    return {replica, batches: migratedBatches};
}

function findMigrationPath<TState>(
    fromVersion: number,
    toVersion: number,
    fromFingerprint: string,
    fromFingerprintHash: string,
    targetFingerprintHash: string,
    migrations: LocalFirstMigration<unknown, unknown>[],
) {
    const path: LocalFirstMigration<unknown, unknown>[] = [];
    let current = fromVersion;
    let fingerprint: string | undefined = fromFingerprint;
    let fingerprintHash: string | undefined = fromFingerprintHash;
    while (current < toVersion) {
        const next = migrations.find(
            (migration) =>
                migration.fromVersion === current &&
                migration.toVersion > migration.fromVersion &&
                migration.toVersion <= toVersion &&
                (migration.fromFingerprint === undefined ||
                    migration.fromFingerprint === fingerprint) &&
                (migration.fromFingerprintHash === undefined ||
                    migration.fromFingerprintHash === fingerprintHash),
        );
        if (!next) return [];
        path.push(next);
        current = next.toVersion;
        fingerprint = next.toFingerprint;
        fingerprintHash =
            next.toFingerprintHash ??
            (next.toVersion === toVersion ? targetFingerprintHash : undefined);
    }
    return current === toVersion ? path : [];
}

function createMigrationConfig<TState>({
    source,
    candidate,
    schema,
    tagKey,
    validateState,
    previous,
}: {
    source: PersistedReplica<unknown>;
    candidate: MigrationCandidate<TState>;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    tagKey: string;
    validateState(input: unknown): IValidation<TState>;
    previous?: VersionedSchema<unknown>[];
}): SchemaMigrationConfig<TState> {
    const current: VersionedSchema<TState> = {
        version: candidate.targetSchemaVersion,
        schema,
        fingerprint: candidate.targetSchemaFingerprint,
        fingerprintHash: candidate.targetSchemaFingerprintHash,
        tagKey,
        validateState,
    };
    const sourceSchema = versionedSchemaFromDocument(source, candidate);
    const registeredPrevious = previous ?? [];
    const hasSource = registeredPrevious.some(
        (item) =>
            item.version === sourceSchema.version &&
            item.fingerprintHash === sourceSchema.fingerprintHash,
    );

    let currentHash = candidate.sourceSchemaFingerprintHash;
    const migrations = candidate.migrations.map((migration) => {
        const fromFingerprintHash = migration.fromFingerprintHash ?? currentHash;
        const toFingerprintHash =
            migration.toFingerprintHash ??
            (migration.toVersion === candidate.targetSchemaVersion
                ? candidate.targetSchemaFingerprintHash
                : sha256Hex(migration.toFingerprint ?? migration.id));
        currentHash = toFingerprintHash;
        return {
            id: migration.id,
            fromVersion: migration.fromVersion,
            toVersion: migration.toVersion,
            fromFingerprintHash,
            toFingerprintHash,
            migrateState: migration.migrateState,
            migratePatch: migration.migratePatch,
            migrateCrdtUpdate: migration.migrateCrdtUpdate,
        };
    });

    return {
        current,
        previous: hasSource ? registeredPrevious : [sourceSchema, ...registeredPrevious],
        migrations,
    };
}

function versionedSchemaFromDocument<TState>(
    source: PersistedReplica<unknown>,
    candidate: MigrationCandidate<TState>,
): VersionedSchema<unknown> {
    const documentSchema = source.history.base.schema;
    return {
        version: candidate.sourceSchemaVersion,
        schema: {
            version: '3.1',
            schemas: [documentSchema.root],
            components: documentSchema.components,
        } as IJsonSchemaCollection<'3.1', [unknown]>,
        fingerprint: candidate.sourceSchemaFingerprint,
        fingerprintHash: candidate.sourceSchemaFingerprintHash,
        tagKey: documentSchema.tagKey,
        validateState(input): IValidation<unknown> {
            return {success: true, data: input};
        },
    };
}

export function retainedHistory<TState>(
    history: CrdtLocalHistory<TState>,
    batches: PersistedBatch[],
): CrdtLocalHistory<TState> {
    if (!batches.length) return history;
    const sorted = batches.toSorted(compareBatches);
    const updates = sorted.flatMap((batch) => batch.updates);
    let doc = history.base;
    for (const update of updates) doc = applyCrdtUpdate(doc, update);
    return {
        base: history.base,
        doc,
        updates,
    };
}

export function vectorForBatches(batches: PersistedBatch[]): VersionVector {
    return vectorForUpdates(batches.flatMap((batch) => batch.updates));
}
