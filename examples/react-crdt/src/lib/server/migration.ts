import type {IJsonSchemaCollection, IValidation} from 'typia';
import {compareTimestamps} from 'umkehr/crdt';
import {
    migrateCrdtUpdates,
    sha256Hex,
    type SchemaMigrationConfig,
    type VersionedSchema,
} from 'umkehr/migration';
import {createInitialCrdtHistory, type AppDefinition} from '../crdtApp';
import {materializeServerBranch} from './materialize';
import {sortServerEvents} from './persistence';
import type {ServerSchemaConfig} from './schemaConfig';
import type {
    PersistedServerBranch,
    PersistedServerReplica,
    ServerBranch,
    ServerBranchEvent,
    ServerUpdateEvent,
} from './types';
import type {ServerClientMessage, ClientServerMessage} from './protocol';

export type NormalizedServerReplica<TState> = PersistedServerReplica<TState> & {
    schemaVersion: number;
    schemaFingerprintHash: string;
};

export function normalizeServerReplica<TState>(
    replica:
        | PersistedServerReplica<TState>
        | (Omit<PersistedServerReplica<TState>, 'schemaVersion' | 'appId'> & {
              schemaVersion?: number;
              appId?: string;
          }),
): NormalizedServerReplica<TState> {
    return {
        ...replica,
        appId: replica.appId ?? '',
        schemaVersion: replica.schemaVersion ?? 1,
        schemaFingerprintHash: replica.schemaFingerprintHash ?? sha256Hex(replica.schemaFingerprint),
    };
}

export function migrateServerReplica<TState>({
    app,
    replica,
    schemaConfig,
    schemaFingerprint,
    schemaFingerprintHash,
    now = new Date().toISOString(),
}: {
    app: AppDefinition<TState>;
    replica: PersistedServerReplica<unknown>;
    schemaConfig: ServerSchemaConfig<TState>;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    now?: string;
}): PersistedServerReplica<TState> {
    const source = normalizeServerReplica(replica);
    const migrationConfig = createMigrationConfig({
        app,
        source,
        schemaConfig,
        schemaFingerprint,
        schemaFingerprintHash,
    });
    const from = {
        schemaVersion: source.schemaVersion,
        schemaFingerprint: source.schemaFingerprint,
        schemaFingerprintHash: source.schemaFingerprintHash,
    };

    const indexMaps = new Map<string, Map<number, number>>();
    const migratedBranches: Record<string, PersistedServerBranch<TState>> = {};
    for (const [branchId, branch] of Object.entries(source.branches)) {
        const {events, indexMap} = migrateBranchEvents(migrationConfig, branch.events, from);
        indexMaps.set(branchId, indexMap);
        migratedBranches[branchId] = {
            ...branch,
            history: createInitialCrdtHistory(app),
            lastSeenEventIndex: mapEventIndex(indexMap, branch.lastSeenEventIndex),
            undoCheckpointEventIndex: mapEventIndex(indexMap, branch.undoCheckpointEventIndex),
            events,
        };
    }

    const branchList = source.branchList.map((branch) => ({
        ...branch,
        forkEventIndex: branch.forkEventIndex === undefined
            ? undefined
            : mapEventIndex(indexMaps.get(branch.sourceBranchId ?? branch.branchId), branch.forkEventIndex),
        tipEventIndex: mapEventIndex(indexMaps.get(branch.branchId), branch.tipEventIndex),
        updatedAt: now,
    } satisfies ServerBranch));

    for (const branch of Object.values(migratedBranches)) {
        branch.events = branch.events.map((event) => {
            if (event.kind === 'update') return event;
            return {
                ...event,
                sourceThroughEventIndex: mapEventIndex(
                    indexMaps.get(event.sourceBranchId),
                    event.sourceThroughEventIndex,
                ),
            };
        });
    }

    const migratedReplica: PersistedServerReplica<TState> = {
        ...source,
        schemaVersion: schemaConfig.version,
        schemaFingerprint,
        schemaFingerprintHash,
        branches: migratedBranches,
        branchList,
        updatedAt: now,
    };

    for (const branchId of Object.keys(migratedReplica.branches)) {
        migratedReplica.branches[branchId].history = materializeServerBranch({
            app,
            branches: migratedReplica.branches,
            branchId,
        });
    }
    return migratedReplica;
}

export function migrateServerDump<TState>({
    app,
    dump,
    schemaConfig,
    schemaFingerprint,
    schemaFingerprintHash,
    now = new Date().toISOString(),
}: {
    app: AppDefinition<TState>;
    dump: Extract<ServerClientMessage, {kind: 'serverMigrationDump'}>;
    schemaConfig: ServerSchemaConfig<TState>;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    now?: string;
}): Extract<ClientServerMessage, {kind: 'serverMigrationUpload'}> {
    const branches = Object.fromEntries(
        dump.branches.map((branch) => [
            branch.branchId,
            {
                branchId: branch.branchId,
                sourceBranchId: branch.sourceBranchId,
                forkEventIndex: branch.forkEventIndex,
                history: createInitialCrdtHistory(app),
                lastSeenEventIndex: branch.tipEventIndex,
                undoCheckpointEventIndex: 0,
                events: dump.events.filter((event) => event.branchId === branch.branchId),
                mirrored: true,
            } satisfies PersistedServerBranch<unknown>,
        ]),
    );
    const source: PersistedServerReplica<unknown> = {
        docId: dump.docId,
        appId: dump.appId ?? '',
        storageVersion: 4,
        protocolVersion: 3,
        schemaVersion: dump.sourceSchemaVersion,
        schemaFingerprint: dump.sourceSchemaFingerprint,
        schemaFingerprintHash: dump.sourceSchemaFingerprintHash,
        activeBranchId: dump.branches[0]?.branchId ?? 'main',
        branchList: dump.branches,
        branches,
        updatedAt: now,
    };
    const migrated = migrateServerReplica({
        app,
        replica: source,
        schemaConfig,
        schemaFingerprint,
        schemaFingerprintHash,
        now,
    });
    return {
        kind: 'serverMigrationUpload',
        version: 3,
        actor: '',
        userId: '',
        docId: dump.docId,
        appId: dump.appId ?? '',
        sourceSchemaFingerprintHash: dump.sourceSchemaFingerprintHash,
        targetSchemaVersion: schemaConfig.version,
        targetSchemaFingerprint: schemaFingerprint,
        targetSchemaFingerprintHash: schemaFingerprintHash,
        migrationIds: schemaConfig.migrations.map((migration) => migration.id),
        migratedAt: now,
        branches: migrated.branchList,
        events: Object.values(migrated.branches).flatMap((branch) => branch.events),
    };
}

function migrateBranchEvents<TState>(
    config: SchemaMigrationConfig<TState>,
    events: ServerBranchEvent[],
    from: {schemaVersion: number; schemaFingerprint: string; schemaFingerprintHash: string},
) {
    const migrated: ServerBranchEvent[] = [];
    const indexMap = new Map<number, number>();
    let nextIndex = 1;
    for (const event of sortServerEvents(events)) {
        if (event.kind === 'merge') {
            const eventIndex = nextIndex++;
            indexMap.set(event.eventIndex, eventIndex);
            migrated.push({...event, eventIndex});
            continue;
        }

        const updates = migrateCrdtUpdates(config, [event.update], from).value;
        if (!updates.length) {
            indexMap.set(event.eventIndex, nextIndex - 1);
            continue;
        }
        for (const update of updates) {
            const eventIndex = nextIndex++;
            indexMap.set(event.eventIndex, eventIndex);
            migrated.push({...event, eventIndex, update, hlcTimestamp: updateTimestamp(event, update)});
        }
    }
    return {events: sortServerEvents(migrated), indexMap};
}

function updateTimestamp(source: ServerUpdateEvent, update: ServerUpdateEvent['update']) {
    if (update.op !== 'setOrder') return update.ts;
    return Object.values(update.orders)
        .map(({ts}) => ts)
        .sort(compareTimestamps)
        .at(-1) ?? source.hlcTimestamp;
}

function mapEventIndex(indexMap: Map<number, number> | undefined, eventIndex: number) {
    if (!indexMap) return eventIndex;
    const direct = indexMap.get(eventIndex);
    if (direct !== undefined) return direct;
    let mapped = 0;
    for (const [oldIndex, newIndex] of indexMap.entries()) {
        if (oldIndex <= eventIndex && newIndex > mapped) mapped = newIndex;
    }
    return mapped;
}

function createMigrationConfig<TState>({
    app,
    source,
    schemaConfig,
    schemaFingerprint,
    schemaFingerprintHash,
}: {
    app: AppDefinition<TState>;
    source: NormalizedServerReplica<unknown>;
    schemaConfig: ServerSchemaConfig<TState>;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
}): SchemaMigrationConfig<TState> {
    const current: VersionedSchema<TState> = {
        version: schemaConfig.version,
        schema: app.schema,
        fingerprint: schemaFingerprint,
        fingerprintHash: schemaFingerprintHash,
        tagKey: app.tagKey,
        validateState: app.validateState,
    };
    const previous = schemaConfig.previous ?? [];
    const sourceSchema = versionedSchemaFromReplica(source);
    const includesSource = previous.some(
        (schema) =>
            schema.version === sourceSchema.version &&
            schema.fingerprintHash === sourceSchema.fingerprintHash,
    );
    let currentHash = source.schemaFingerprintHash;
    const migrations = schemaConfig.migrations.map((migration) => {
        const fromFingerprintHash = migration.fromFingerprintHash ?? currentHash;
        const toFingerprintHash =
            migration.toFingerprintHash ??
            (migration.toVersion === schemaConfig.version
                ? schemaFingerprintHash
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
        previous: includesSource ? previous : [sourceSchema, ...previous],
        migrations,
    };
}

function versionedSchemaFromReplica(source: NormalizedServerReplica<unknown>): VersionedSchema<unknown> {
    const schema = Object.values(source.branches)[0]?.history.base.schema;
    if (!schema) {
        return {
            version: source.schemaVersion,
            schema: {version: '3.1', schemas: [{}], components: {schemas: {}}} as IJsonSchemaCollection<'3.1', [unknown]>,
            fingerprint: source.schemaFingerprint,
            fingerprintHash: source.schemaFingerprintHash,
            tagKey: 'type',
            validateState,
        };
    }
    return {
        version: source.schemaVersion,
        schema: {
            version: '3.1',
            schemas: [schema.root],
            components: schema.components,
        } as IJsonSchemaCollection<'3.1', [unknown]>,
        fingerprint: source.schemaFingerprint,
        fingerprintHash: source.schemaFingerprintHash,
        tagKey: schema.tagKey,
        validateState,
    };
}

function validateState(input: unknown): IValidation<unknown> {
    return {success: true, data: input};
}
