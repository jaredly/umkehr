import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    type CrdtLocalHistory,
} from 'umkehr/crdt';
import {sha256Hex} from 'umkehr/migration';
import type {DocumentLineage, PersistedReplica, ReplicaIdentity} from './types';
import type {LocalFirstMigration, LocalFirstSchemaConfig} from './schemaConfig';

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
    targetSchemaFingerprint: string;
    migrationIds: string[];
    migrations: LocalFirstMigration<unknown, TState>[];
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
}: {
    source: PersistedReplica<unknown>;
    current: LocalFirstSchemaConfig<TState>;
    currentFingerprint: string;
}): MigrationCandidate<TState> | null {
    const normalized = normalizePersistedReplica(source);
    if (normalized.schemaFingerprint === currentFingerprint) return null;

    const migrations = findMigrationPath(
        normalized.schemaVersion,
        current.version,
        normalized.schemaFingerprint,
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
        targetSchemaFingerprint: currentFingerprint,
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
    now = new Date().toISOString(),
}: {
    source: PersistedReplica<unknown>;
    candidate: MigrationCandidate<TState>;
    identity: ReplicaIdentity;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    tagKey: string;
    validateState(input: unknown): IValidation<TState>;
    now?: string;
}): PersistedReplica<TState> {
    let state: unknown = source.history.doc.state;
    for (const migration of candidate.migrations) {
        state = migration.migrateState(state);
    }
    const validated = validateState(state);
    if (!validated.success) {
        throw new Error('Migrated state does not match the current schema.');
    }

    const history = createCrdtLocalHistory(
        createCrdtDocument(validated.data, schema, {
            timestamp: hlc.pack(hlc.init(identity.replicaId, Date.parse(now))),
            tagKey,
        }),
    );
    return {
        docId: candidate.targetDocId,
        storageVersion: 1,
        protocolVersion: 1,
        schemaVersion: candidate.targetSchemaVersion,
        schemaFingerprint: candidate.targetSchemaFingerprint,
        schemaFingerprintHash: sha256Hex(candidate.targetSchemaFingerprint),
        replicaId: identity.replicaId,
        history,
        vector: {},
        lineage: {
            sourceDocId: candidate.sourceDocId,
            sourceSchemaVersion: candidate.sourceSchemaVersion,
            sourceSchemaFingerprint: candidate.sourceSchemaFingerprint,
            migratedAt: now,
            migrationId: candidate.migrationIds.join(','),
        } satisfies DocumentLineage,
        updatedAt: now,
    };
}

function findMigrationPath<TState>(
    fromVersion: number,
    toVersion: number,
    fromFingerprint: string,
    migrations: LocalFirstMigration<unknown, TState>[],
) {
    const path: LocalFirstMigration<unknown, TState>[] = [];
    let current = fromVersion;
    let fingerprint: string | undefined = fromFingerprint;
    while (current < toVersion) {
        const next = migrations.find(
            (migration) =>
                migration.fromVersion === current &&
                migration.toVersion > migration.fromVersion &&
                migration.toVersion <= toVersion &&
                (migration.fromFingerprint === undefined ||
                    migration.fromFingerprint === fingerprint),
        );
        if (!next) return [];
        path.push(next);
        current = next.toVersion;
        fingerprint = undefined;
    }
    return current === toVersion ? path : [];
}
