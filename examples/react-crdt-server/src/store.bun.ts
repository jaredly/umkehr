import {afterEach, describe, expect, it} from 'bun:test';
import {unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
    TODO_FIXTURE_DOC_ID_V1,
    TODO_FIXTURE_MIGRATED_AT,
    todoFixtureServerUpdateEventsV1,
    todoFixtureV1Fingerprint,
    todoFixtureV1FingerprintHash,
    todoFixtureV2Fingerprint,
    todoFixtureV2FingerprintHash,
} from '../../migration-fixtures/todos';
import {ServerStore} from './store';
import type {SeedDatabasePayload} from './types';

const dbPaths: string[] = [];

afterEach(() => {
    for (const path of dbPaths.splice(0)) {
        try {
            unlinkSync(path);
        } catch {
            // Temp database may already be gone.
        }
    }
});

function createStore() {
    const path = join(tmpdir(), `umkehr-server-store-${crypto.randomUUID()}.sqlite`);
    dbPaths.push(path);
    return new ServerStore(path);
}

function seedPayload(): SeedDatabasePayload {
    return {
        generatedAt: '2026-01-02T00:00:00.000Z',
        users: [
            {userId: 'user-ada', nickname: 'Ada'},
            {userId: 'user-ben', nickname: 'Ben'},
        ],
        documents: [{
            docId: 'seed-doc',
            title: 'Seed document',
            sizeLabel: '3 events',
            sizeRank: 10,
            createdAt: '2026-01-02T00:00:00.000Z',
            lastAccessedAt: '2026-01-02T00:00:00.000Z',
            schemaVersion: 1,
            schemaFingerprint: 'schema',
            schemaFingerprintHash: 'schema-hash',
            branches: [
                {
                    docId: 'seed-doc',
                    branchId: 'main',
                    name: 'main',
                    tipEventIndex: 2,
                    createdAt: '2026-01-02T00:00:00.000Z',
                    updatedAt: '2026-01-02T00:00:02.000Z',
                },
                {
                    docId: 'seed-doc',
                    branchId: 'feature',
                    name: 'Feature',
                    sourceBranchId: 'main',
                    forkEventIndex: 1,
                    tipEventIndex: 1,
                    createdAt: '2026-01-02T00:00:01.000Z',
                    updatedAt: '2026-01-02T00:00:01.000Z',
                },
            ],
            events: [
                {
                    kind: 'update',
                    docId: 'seed-doc',
                    branchId: 'main',
                    eventIndex: 1,
                    origin: 'user-ada:session-a',
                    hlcTimestamp: '2026-01-02T00:00:00.000Z:user-ada:session-a',
                    receivedAt: '2026-01-02T00:00:00.000Z',
                    update: {
                        op: 'set',
                        path: [],
                        value: {todos: []},
                        ts: '2026-01-02T00:00:00.000Z:user-ada:session-a',
                    },
                },
                {
                    kind: 'merge',
                    docId: 'seed-doc',
                    branchId: 'main',
                    eventIndex: 2,
                    mergeId: 'merge-feature',
                    sourceBranchId: 'feature',
                    sourceThroughEventIndex: 1,
                    actor: 'user-ben:session-b',
                    createdAt: '2026-01-02T00:00:02.000Z',
                },
                {
                    kind: 'update',
                    docId: 'seed-doc',
                    branchId: 'feature',
                    eventIndex: 1,
                    origin: 'user-ben:session-b',
                    hlcTimestamp: '2026-01-02T00:00:01.000Z:user-ben:session-b',
                    receivedAt: '2026-01-02T00:00:01.000Z',
                    update: {
                        op: 'set',
                        path: [],
                        value: {todos: [{id: 'one', title: 'Seed', done: false}]},
                        ts: '2026-01-02T00:00:01.000Z:user-ben:session-b',
                    },
                },
            ],
        }],
    };
}

describe('ServerStore', () => {
    it('auto-creates main and assigns contiguous update event indexes', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema', 'schema-hash');

        expect(store.ensureMainBranch('doc').name).toBe('main');
        expect(store.listBranches('doc').map((branch) => branch.branchId)).toEqual(['main']);

        const first = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '001:user:session',
            update: {op: 'set', path: [], value: {}, ts: '001:user:session'},
        });
        const duplicate = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '001:user:session',
            update: {op: 'set', path: [], value: {}, ts: '001:user:session'},
        });
        const second = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '002:user:session',
            update: {op: 'set', path: [], value: {}, ts: '002:user:session'},
        });

        expect(first.eventIndex).toBe(1);
        expect(duplicate).toEqual(first);
        expect(second.eventIndex).toBe(2);
        expect(store.listEventsAfter('doc', 'main', 1)).toEqual([second]);
    });

    it('creates and renames branches with unique names', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema', 'schema-hash');

        const branch = store.createBranch({
            docId: 'doc',
            branchId: 'feature',
            sourceBranchId: 'main',
            forkEventIndex: 0,
            name: 'Feature',
        });

        expect(branch.branchId).toBe('feature');
        expect(branch.sourceBranchId).toBe('main');
        expect(branch.forkEventIndex).toBe(0);
        expect(store.createBranch({
            docId: 'doc',
            branchId: 'feature',
            sourceBranchId: 'main',
            forkEventIndex: 0,
            name: 'Feature',
        })).toEqual(branch);

        const renamed = store.renameBranch({docId: 'doc', branchId: 'feature', name: 'Review'});
        expect(renamed.name).toBe('Review');
        expect(() =>
            store.createBranch({
                docId: 'doc',
                branchId: 'other',
                sourceBranchId: 'main',
                forkEventIndex: 0,
                name: 'Review',
            }),
        ).toThrow();
    });

    it('deduplicates merge events by mergeId', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema', 'schema-hash');

        const first = store.appendMergeEvent({
            docId: 'doc',
            branchId: 'main',
            mergeId: 'merge-client-1',
            actor: 'user:session',
            sourceBranchId: 'main',
            sourceThroughEventIndex: 0,
        });
        const second = store.appendMergeEvent({
            docId: 'doc',
            branchId: 'main',
            mergeId: 'merge-client-1',
            actor: 'user:session',
            sourceBranchId: 'main',
            sourceThroughEventIndex: 0,
        });

        expect(second).toEqual(first);
        expect(store.listEventsAfter('doc', 'main', 0)).toEqual([first]);
        expect(store.ensureMainBranch('doc').tipEventIndex).toBe(1);
    });

    it('imports seeded users, document metadata, branches, and events', () => {
        const store = createStore();
        const payload = seedPayload();

        store.importSeedDatabase(payload);

        expect(store.listUsers()).toEqual([
            {userId: 'user-ada', nickname: 'Ada'},
            {userId: 'user-ben', nickname: 'Ben'},
        ]);
        expect(store.getDocument('seed-doc')).toEqual({
            appId: '',
            schemaVersion: 1,
            schemaFingerprint: 'schema',
            schemaFingerprintHash: 'schema-hash',
        });
        expect(store.summarizeDocuments()).toEqual([
            {
                docId: 'seed-doc',
                appId: '',
                schemaVersion: 1,
                schemaFingerprint: 'schema',
                schemaFingerprintHash: 'schema-hash',
                title: 'Seed document',
                sizeLabel: '3 events',
                sizeRank: 10,
                createdAt: '2026-01-02T00:00:00.000Z',
                lastAccessedAt: '2026-01-02T00:00:00.000Z',
                branchCount: 2,
                eventCount: 3,
            },
        ]);
        expect(store.listBranches('seed-doc').map((branch) => branch.branchId)).toEqual([
            'feature',
            'main',
        ]);
        expect(store.listEventsAfter('seed-doc', 'main', 0)).toMatchObject([
            {kind: 'update', eventIndex: 1, origin: 'user-ada:session-a'},
            {kind: 'merge', eventIndex: 2, actor: 'user-ben:session-b'},
        ]);
    });

    it('overwrites existing seeded database contents by default', () => {
        const store = createStore();
        store.importSeedDatabase(seedPayload());

        store.importSeedDatabase({
            generatedAt: '2026-01-03T00:00:00.000Z',
            users: [{userId: 'user-cy', nickname: 'Cy'}],
            documents: [{
                docId: 'second-doc',
                title: 'Second document',
                sizeLabel: 'empty',
                sizeRank: 1,
                createdAt: '2026-01-03T00:00:00.000Z',
                lastAccessedAt: '2026-01-03T00:00:00.000Z',
                schemaVersion: 1,
                schemaFingerprint: 'schema',
                schemaFingerprintHash: 'schema-hash',
                branches: [{
                    docId: 'second-doc',
                    branchId: 'main',
                    name: 'main',
                    tipEventIndex: 0,
                    createdAt: '2026-01-03T00:00:00.000Z',
                    updatedAt: '2026-01-03T00:00:00.000Z',
                }],
                events: [],
            }],
        });

        expect(store.listUsers()).toEqual([{userId: 'user-cy', nickname: 'Cy'}]);
        expect(store.summarizeDocuments().map((document) => document.docId)).toEqual([
            'second-doc',
        ]);
        expect(store.getDocument('seed-doc')).toBeNull();
    });

    it('keeps existing data when seed import validation fails', () => {
        const store = createStore();
        store.importSeedDatabase(seedPayload());

        expect(() =>
            store.importSeedDatabase({
                generatedAt: '2026-01-03T00:00:00.000Z',
                users: [],
                documents: [{
                    ...seedPayload().documents[0],
                    branches: [],
                    events: [],
                }],
            }),
        ).toThrow();

        expect(store.summarizeDocuments().map((document) => document.docId)).toEqual([
            'seed-doc',
        ]);
        expect(store.listUsers()).toHaveLength(2);
    });

    it('supports metadata upserts and access touches on normal documents', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema', 'schema-hash');

        expect(store.summarizeDocuments()).toMatchObject([
            {
                docId: 'doc',
                title: 'doc',
                sizeLabel: '',
                sizeRank: 0,
                branchCount: 1,
                eventCount: 0,
            },
        ]);

        store.upsertDocumentMetadata({
            docId: 'doc',
            title: 'Normal document',
            sizeLabel: 'empty',
            sizeRank: 5,
            createdAt: '2026-01-04T00:00:00.000Z',
            lastAccessedAt: '2026-01-04T00:00:00.000Z',
        });
        store.touchDocumentAccess('doc', '2026-01-05T00:00:00.000Z');

        expect(store.summarizeDocuments()[0]).toMatchObject({
            docId: 'doc',
            title: 'Normal document',
            sizeLabel: 'empty',
            sizeRank: 5,
            createdAt: '2026-01-04T00:00:00.000Z',
            lastAccessedAt: '2026-01-05T00:00:00.000Z',
        });
    });

    it('grants a migration lock and dumps all branch data', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema-v1', 'hash-v1');
        const event = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '001:user:session',
            update: {op: 'set', path: [], value: {}, ts: '001:user:session'},
        });

        const result = store.beginMigration({
            docId: 'doc',
            ownerActor: 'user:session',
            ownerUserId: 'user',
            ownerSessionId: 'session',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: 'schema-v2',
            targetSchemaFingerprintHash: 'hash-v2',
        });

        expect(result.kind).toBe('granted');
        if (result.kind !== 'granted') return;
        expect(result.dump).toMatchObject({
            docId: 'doc',
            sourceSchemaVersion: 1,
            sourceSchemaFingerprintHash: 'hash-v1',
            targetSchemaVersion: 2,
            targetSchemaFingerprintHash: 'hash-v2',
        });
        expect(result.dump.branches.map((branch) => branch.branchId)).toEqual(['main']);
        expect(result.dump.events).toEqual([event]);
    });

    it('blocks competing migration locks until the active lock expires', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema-v1', 'hash-v1');
        store.beginMigration({
            docId: 'doc',
            ownerActor: 'user:session',
            ownerUserId: 'user',
            ownerSessionId: 'session',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: 'schema-v2',
            targetSchemaFingerprintHash: 'hash-v2',
        });

        const competing = store.beginMigration({
            docId: 'doc',
            ownerActor: 'other:session',
            ownerUserId: 'other',
            ownerSessionId: 'session',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: 'schema-v2',
            targetSchemaFingerprintHash: 'hash-v2',
        });

        expect(competing.kind).toBe('locked');
        expect(store.expireMigrationLock('doc', new Date(Date.now() + 61_000))).toMatchObject({
            ownerActor: 'user:session',
        });
        expect(store.activeMigrationLock('doc')).toBeNull();
    });

    it('archives old data and activates uploaded migrated data atomically', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema-v1', 'hash-v1');
        const event = store.appendUpdateEvent({
            docId: 'doc',
            branchId: 'main',
            origin: 'user:session',
            hlcTimestamp: '001:user:session',
            update: {op: 'set', path: [], value: {}, ts: '001:user:session'},
        });
        store.beginMigration({
            docId: 'doc',
            ownerActor: 'user:session',
            ownerUserId: 'user',
            ownerSessionId: 'session',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: 'schema-v2',
            targetSchemaFingerprintHash: 'hash-v2',
        });

        const completed = store.completeMigration({
            ownerActor: 'user:session',
            upload: {
                docId: 'doc',
                sourceSchemaFingerprintHash: 'hash-v1',
                targetSchemaVersion: 2,
                targetSchemaFingerprint: 'schema-v2',
                targetSchemaFingerprintHash: 'hash-v2',
                migrationIds: ['v1-to-v2'],
                migratedAt: 'now',
                branches: [
                    {
                        docId: 'doc',
                        branchId: 'main',
                        name: 'main',
                        tipEventIndex: 1,
                        createdAt: 'now',
                        updatedAt: 'now',
                    },
                ],
                events: [{
                    ...event,
                    update: {op: 'set', path: [], value: {migrated: true}, ts: event.hlcTimestamp},
                }],
            },
        });

        expect(completed).toEqual({schemaVersion: 2, schemaFingerprintHash: 'hash-v2'});
        expect(store.getDocument('doc')).toMatchObject({schemaVersion: 2, schemaFingerprintHash: 'hash-v2'});
        expect(store.archivedSchemaHashes('doc')).toEqual(['hash-v1']);
        expect(store.listEventsAfter('doc', 'main', 0)[0]).toMatchObject({
            kind: 'update',
            update: {value: {migrated: true}},
        });
    });

    it('rejects migration uploads without a matching active lock and source hash', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema-v1', 'hash-v1');
        const upload = {
            docId: 'doc',
            sourceSchemaFingerprintHash: 'hash-v1',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: 'schema-v2',
            targetSchemaFingerprintHash: 'hash-v2',
            migrationIds: ['v1-to-v2'],
            migratedAt: 'now',
            branches: [
                {
                    docId: 'doc',
                    branchId: 'main',
                    name: 'main',
                    tipEventIndex: 0,
                    createdAt: 'now',
                    updatedAt: 'now',
                },
            ],
            events: [],
        };

        expect(() => store.completeMigration({ownerActor: 'user:session', upload})).toThrow();
        store.beginMigration({
            docId: 'doc',
            ownerActor: 'user:session',
            ownerUserId: 'user',
            ownerSessionId: 'session',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: 'schema-v2',
            targetSchemaFingerprintHash: 'hash-v2',
        });
        expect(() =>
            store.completeMigration({
                ownerActor: 'user:session',
                upload: {...upload, sourceSchemaFingerprintHash: 'wrong-hash'},
            }),
        ).toThrow();
    });

    it('rejects migrated branch events with incoherent indexes', () => {
        const store = createStore();
        store.ensureDocument('doc', '', 1, 'schema-v1', 'hash-v1');
        store.beginMigration({
            docId: 'doc',
            ownerActor: 'user:session',
            ownerUserId: 'user',
            ownerSessionId: 'session',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: 'schema-v2',
            targetSchemaFingerprintHash: 'hash-v2',
        });

        expect(() =>
            store.completeMigration({
                ownerActor: 'user:session',
                upload: {
                    docId: 'doc',
                    sourceSchemaFingerprintHash: 'hash-v1',
                    targetSchemaVersion: 2,
                    targetSchemaFingerprint: 'schema-v2',
                    targetSchemaFingerprintHash: 'hash-v2',
                    migrationIds: ['v1-to-v2'],
                    migratedAt: 'now',
                    branches: [
                        {
                            docId: 'doc',
                            branchId: 'main',
                            name: 'main',
                            tipEventIndex: 2,
                            createdAt: 'now',
                            updatedAt: 'now',
                        },
                    ],
                    events: [
                        {
                            kind: 'update',
                            docId: 'doc',
                            branchId: 'main',
                            eventIndex: 2,
                            origin: 'user:session',
                            hlcTimestamp: '002:user:session',
                            receivedAt: 'now',
                            update: {op: 'set', path: [], value: {}, ts: '002:user:session'},
                        },
                    ],
                },
            }),
        ).toThrow();
    });

    it('transactionally activates a migrated todos fixture upload', () => {
        const store = createStore();
        store.ensureDocument(
            TODO_FIXTURE_DOC_ID_V1,
            '',
            1,
            todoFixtureV1Fingerprint,
            todoFixtureV1FingerprintHash,
        );
        for (const event of todoFixtureServerUpdateEventsV1()) {
            store.appendUpdateEvent({
                docId: event.docId,
                branchId: event.branchId,
                origin: event.origin,
                hlcTimestamp: event.hlcTimestamp,
                update: event.update,
            });
        }
        store.beginMigration({
            docId: TODO_FIXTURE_DOC_ID_V1,
            ownerActor: 'fixture:local',
            ownerUserId: 'fixture',
            ownerSessionId: 'local',
            targetSchemaVersion: 2,
            targetSchemaFingerprint: todoFixtureV2Fingerprint,
            targetSchemaFingerprintHash: todoFixtureV2FingerprintHash,
        });

        const completed = store.completeMigration({
            ownerActor: 'fixture:local',
            upload: {
                docId: TODO_FIXTURE_DOC_ID_V1,
                sourceSchemaFingerprintHash: todoFixtureV1FingerprintHash,
                targetSchemaVersion: 2,
                targetSchemaFingerprint: todoFixtureV2Fingerprint,
                targetSchemaFingerprintHash: todoFixtureV2FingerprintHash,
                migrationIds: ['todos-fixture-v1-to-v2'],
                migratedAt: TODO_FIXTURE_MIGRATED_AT,
                branches: [
                    {
                        docId: TODO_FIXTURE_DOC_ID_V1,
                        branchId: 'main',
                        name: 'main',
                        tipEventIndex: 2,
                        createdAt: TODO_FIXTURE_MIGRATED_AT,
                        updatedAt: TODO_FIXTURE_MIGRATED_AT,
                    },
                ],
                events: todoFixtureServerUpdateEventsV1()
                    .filter((event) => event.eventIndex !== 2)
                    .map((event, index) => ({
                        ...event,
                        eventIndex: index + 1,
                        update:
                            event.update.op === 'set'
                                ? {
                                      ...event.update,
                                      path: event.update.path.map((segment) =>
                                          segment.type === 'objectField' && segment.key === 'text'
                                              ? {...segment, key: 'title'}
                                              : segment,
                                      ),
                                      value:
                                          event.eventIndex === 3
                                              ? {
                                                    id: 'three',
                                                    title: 'Ship fixture',
                                                    done: false,
                                                    priority: 'normal',
                                                }
                                              : event.update.value,
                                  }
                                : event.update,
                    })),
            },
        });

        expect(completed).toEqual({
            schemaVersion: 2,
            schemaFingerprintHash: todoFixtureV2FingerprintHash,
        });
        expect(store.archivedSchemaHashes(TODO_FIXTURE_DOC_ID_V1)).toEqual([
            todoFixtureV1FingerprintHash,
        ]);
        expect(store.listEventsAfter(TODO_FIXTURE_DOC_ID_V1, 'main', 0)).toHaveLength(2);
    });
});
