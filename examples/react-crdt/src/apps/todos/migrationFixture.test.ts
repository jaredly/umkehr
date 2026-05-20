import {describe, expect, it} from 'vitest';
import type {AppDefinition} from '../../lib/crdtApp';
import {
    createMigratedReplica,
    findMigrationCandidate,
    normalizePersistedReplica,
} from '../../lib/local-first/migration';
import type {LocalFirstSchemaConfig} from '../../lib/local-first/schemaConfig';
import {batchTimestampRange, vectorForUpdates} from '../../lib/local-first/vector';
import {migrateServerDump, migrateServerReplica} from '../../lib/server/migration';
import type {PersistedServerBranch, PersistedServerReplica} from '../../lib/server/types';
import {
    TODO_FIXTURE_DOC_ID_V1,
    TODO_FIXTURE_DOC_ID_V2,
    TODO_FIXTURE_MIGRATED_AT,
    TODO_FIXTURE_TAG_KEY,
    createTodoFixtureCrdtHistoryV1,
    createTodoFixtureCrdtUpdatesV1,
    createTodoFixtureHistoryV1,
    todoFixtureMigration,
    todoFixtureMigrationConfig,
    todoFixtureServerUpdateEventsV1,
    todoFixtureV1Fingerprint,
    todoFixtureV1FingerprintHash,
    todoFixtureV2Fingerprint,
    todoFixtureV2FingerprintHash,
    todoFixtureV2Metadata,
    todoFixtureV2Schema,
    type TodoFixtureStateV2,
} from '../../../../migration-fixtures/todos';
import {migrateHistory} from 'umkehr/migration';

const fromV1 = {
    schemaVersion: 1,
    schemaFingerprint: todoFixtureV1Fingerprint,
    schemaFingerprintHash: todoFixtureV1FingerprintHash,
};

const expectedMigratedState: TodoFixtureStateV2 = {
    bgcolor: '#fff',
    todos: [
        {id: 'one', title: 'Write migration plan', done: true, priority: 'normal'},
        {id: 'two', title: 'Try CRDT sync', done: false, priority: 'normal'},
        {id: 'three', title: 'Ship fixture', done: false, priority: 'normal'},
    ],
};

const app: AppDefinition<TodoFixtureStateV2> = {
    id: 'todos-fixture',
    title: 'Todos Fixture',
    tagKey: TODO_FIXTURE_TAG_KEY,
    schema: todoFixtureV2Schema,
    validateState: todoFixtureV2Metadata.validateState,
    initialState: {
        bgcolor: '#fff',
        todos: [
            {id: 'one', title: 'Write README', done: true, priority: 'normal'},
            {id: 'two', title: 'Try CRDT sync', done: false, priority: 'normal'},
        ],
    },
    renderPanel() {
        return null as never;
    },
};

describe('todos migration fixture', () => {
    it('migrates non-CRDT local history fixture data', () => {
        const migrated = migrateHistory(
            todoFixtureMigrationConfig,
            createTodoFixtureHistoryV1(),
            fromV1,
        );

        expect(migrated.migrationIds).toEqual(['todos-fixture-v1-to-v2']);
        expect(migrated.value.current).toEqual(expectedMigratedState);
        expect(migrated.value.nodes['edit-1'].changes).toHaveLength(2);
        expect(migrated.value.nodes['edit-1'].changes[0]).toMatchObject({
            op: 'replace',
            path: [
                {type: 'key', key: 'todos'},
                {type: 'key', key: 0},
                {type: 'key', key: 'title'},
            ],
        });
        expect(migrated.value.nodes['edit-1'].changes[1]).toMatchObject({
            op: 'add',
            value: {id: 'three', title: 'Ship fixture', done: false, priority: 'normal'},
        });
    });

    it('migrates local-first retained batches and reconstructs history from them', () => {
        const sourceHistory = createTodoFixtureCrdtHistoryV1();
        const source = normalizePersistedReplica({
            docId: TODO_FIXTURE_DOC_ID_V1,
            storageVersion: 1,
            protocolVersion: 1,
            schemaVersion: 1,
            schemaFingerprint: todoFixtureV1Fingerprint,
            schemaFingerprintHash: todoFixtureV1FingerprintHash,
            replicaId: 'fixture',
            history: sourceHistory,
            vector: vectorForUpdates(sourceHistory.updates),
            updatedAt: TODO_FIXTURE_MIGRATED_AT,
        });
        const batches = [
            {
                docId: TODO_FIXTURE_DOC_ID_V1,
                batchId: 'fixture-batch',
                origin: 'fixture',
                updates: createTodoFixtureCrdtUpdatesV1(sourceHistory.base),
                ...batchTimestampRange(sourceHistory.updates),
                vectorAfter: vectorForUpdates(sourceHistory.updates),
                receivedAt: TODO_FIXTURE_MIGRATED_AT,
            },
        ];
        const schemaConfig: LocalFirstSchemaConfig<TodoFixtureStateV2> = {
            version: 2,
            previous: todoFixtureMigrationConfig.previous,
            migrations: [
                {
                    ...todoFixtureMigration,
                    fromFingerprint: todoFixtureV1Fingerprint,
                    toFingerprint: todoFixtureV2Fingerprint,
                    toDocId: TODO_FIXTURE_DOC_ID_V2,
                },
            ],
        };
        const candidate = findMigrationCandidate({
            source,
            current: schemaConfig,
            currentFingerprint: todoFixtureV2Fingerprint,
            currentFingerprintHash: todoFixtureV2FingerprintHash,
        });
        expect(candidate).not.toBeNull();
        if (!candidate) return;

        const migrated = createMigratedReplica({
            source,
            candidate,
            identity: {replicaId: 'fixture', createdAt: TODO_FIXTURE_MIGRATED_AT},
            schema: todoFixtureV2Schema,
            tagKey: TODO_FIXTURE_TAG_KEY,
            validateState: todoFixtureV2Metadata.validateState,
            batches,
            previous: todoFixtureMigrationConfig.previous,
            now: TODO_FIXTURE_MIGRATED_AT,
        });

        expect(migrated.replica.docId).toBe(TODO_FIXTURE_DOC_ID_V2);
        expect(migrated.replica.history.doc.state).toEqual(expectedMigratedState);
        expect(migrated.replica.history.updates).toEqual(migrated.batches.flatMap((batch) => batch.updates));
        expect(migrated.batches).toHaveLength(1);
        expect(migrated.batches[0].updates).toHaveLength(2);
        expect(migrated.replica.vector).toEqual(vectorForUpdates(migrated.batches[0].updates));
    });

    it('migrates server client local branch data and pending events', () => {
        const source = serverReplica(false);
        const migrated = migrateServerReplica({
            app,
            replica: source,
            schemaConfig: {version: 2, previous: todoFixtureMigrationConfig.previous, migrations: [todoFixtureMigration]},
            schemaFingerprint: todoFixtureV2Fingerprint,
            schemaFingerprintHash: todoFixtureV2FingerprintHash,
            now: TODO_FIXTURE_MIGRATED_AT,
        });

        expect(migrated.schemaFingerprintHash).toBe(todoFixtureV2FingerprintHash);
        expect(migrated.branches.main.history.doc.state).toEqual(expectedMigratedState);
        expect(migrated.branches.main.events).toHaveLength(2);
        expect(migrated.branches.main.events.every((event) => event.kind !== 'update' || event.recorded === false)).toBe(true);
        expect(migrated.branches.main.lastSeenEventIndex).toBe(2);
    });

    it('keeps old server client branch data intact when migration fails', () => {
        const source = serverReplica(false);
        const before = JSON.stringify(source);

        expect(() =>
            migrateServerReplica({
                app,
                replica: source,
                schemaConfig: {version: 2, previous: todoFixtureMigrationConfig.previous, migrations: []},
                schemaFingerprint: todoFixtureV2Fingerprint,
                schemaFingerprintHash: todoFixtureV2FingerprintHash,
                now: TODO_FIXTURE_MIGRATED_AT,
            }),
        ).toThrow();
        expect(JSON.stringify(source)).toBe(before);
        expect(source.schemaFingerprintHash).toBe(todoFixtureV1FingerprintHash);
        expect(source.branches.main.history.doc.state).toHaveProperty('legacyFilter');
    });

    it('builds a migrated server upload fixture from a server dump', () => {
        const upload = migrateServerDump({
            app,
            dump: {
                kind: 'serverMigrationDump',
                version: 3,
                docId: TODO_FIXTURE_DOC_ID_V1,
                sourceSchemaVersion: 1,
                sourceSchemaFingerprint: todoFixtureV1Fingerprint,
                sourceSchemaFingerprintHash: todoFixtureV1FingerprintHash,
                targetSchemaVersion: 2,
                targetSchemaFingerprint: todoFixtureV2Fingerprint,
                targetSchemaFingerprintHash: todoFixtureV2FingerprintHash,
                branches: serverReplica(true).branchList,
                events: todoFixtureServerUpdateEventsV1(),
            },
            schemaConfig: {version: 2, previous: todoFixtureMigrationConfig.previous, migrations: [todoFixtureMigration]},
            schemaFingerprint: todoFixtureV2Fingerprint,
            schemaFingerprintHash: todoFixtureV2FingerprintHash,
            now: TODO_FIXTURE_MIGRATED_AT,
        });

        expect(upload).toMatchObject({
            kind: 'serverMigrationUpload',
            docId: TODO_FIXTURE_DOC_ID_V1,
            sourceSchemaFingerprintHash: todoFixtureV1FingerprintHash,
            targetSchemaVersion: 2,
            targetSchemaFingerprintHash: todoFixtureV2FingerprintHash,
            migrationIds: ['todos-fixture-v1-to-v2'],
            migratedAt: TODO_FIXTURE_MIGRATED_AT,
        });
        expect(upload.events).toHaveLength(2);
        expect(upload.branches[0].tipEventIndex).toBe(2);
    });
});

function serverReplica(recorded: boolean): PersistedServerReplica<unknown> {
    const events = todoFixtureServerUpdateEventsV1().map((event) => ({...event, recorded}));
    const branch: PersistedServerBranch<unknown> = {
        branchId: 'main',
        history: createTodoFixtureCrdtHistoryV1(),
        lastSeenEventIndex: events.length,
        undoCheckpointEventIndex: 0,
        events,
        mirrored: true,
    };
    return {
        docId: TODO_FIXTURE_DOC_ID_V1,
        storageVersion: 3,
        protocolVersion: 3,
        schemaVersion: 1,
        schemaFingerprint: todoFixtureV1Fingerprint,
        schemaFingerprintHash: todoFixtureV1FingerprintHash,
        activeBranchId: 'main',
        branches: {main: branch},
        branchList: [
            {
                docId: TODO_FIXTURE_DOC_ID_V1,
                branchId: 'main',
                name: 'main',
                tipEventIndex: events.length,
                createdAt: TODO_FIXTURE_MIGRATED_AT,
                updatedAt: TODO_FIXTURE_MIGRATED_AT,
            },
        ],
        updatedAt: TODO_FIXTURE_MIGRATED_AT,
    };
}
