import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    createCrdtUpdates,
    latestCrdtUpdateTimestamp,
    type CrdtDocument,
    type CrdtUpdate,
} from 'umkehr/crdt';
import {renameCrdtObjectField, schemaFingerprint, sha256Hex} from 'umkehr/migration';
import type {AppDefinition} from '../crdtApp';
import {migrateServerDump, migrateServerReplica} from './migration';
import type {ServerSchemaConfig} from './schemaConfig';
import type {PersistedServerBranch, PersistedServerReplica, ServerBranchEvent} from './types';

type V1 = {title: string};
type V2 = {label: string};

const v1Schema = objectSchema(['title'], {title: {type: 'string'}}) as IJsonSchemaCollection<'3.1', [V1]>;
const v2Schema = objectSchema(['label'], {label: {type: 'string'}}) as IJsonSchemaCollection<'3.1', [V2]>;
const oldFingerprint = schemaFingerprint(v1Schema, 'type');
const oldFingerprintHash = sha256Hex(oldFingerprint);
const newFingerprint = schemaFingerprint(v2Schema, 'type');
const newFingerprintHash = sha256Hex(newFingerprint);

const v1App: AppDefinition<V1> = {
    id: 'test',
    title: 'Test',
    schemaVersion: 1,
    tagKey: 'type',
    schema: v1Schema,
    initialState: {title: 'Draft'},
    validateState: validateV1,
    renderPanel() {
        return null as never;
    },
};

const v2App: AppDefinition<V2> = {
    id: 'test',
    title: 'Test',
    schemaVersion: 2,
    tagKey: 'type',
    schema: v2Schema,
    initialState: {label: 'Draft'},
    validateState: validateV2,
    renderPanel() {
        return null as never;
    },
};

const config: ServerSchemaConfig<V2> = {
    version: 2,
    previous: [
        {
            version: 1,
            schema: v1Schema,
            fingerprint: oldFingerprint,
            fingerprintHash: oldFingerprintHash,
            tagKey: 'type',
            validateState: validateV1,
        },
    ],
    migrations: [
        {
            id: 'v1-to-v2',
            fromVersion: 1,
            toVersion: 2,
            fromFingerprintHash: oldFingerprintHash,
            toFingerprintHash: newFingerprintHash,
            fromFingerprint: oldFingerprint,
            migrateState(input) {
                return {label: (input as V1).title};
            },
            migrateCrdtUpdate(input) {
                return renameCrdtObjectField(input, 'title', 'label');
            },
        },
    ],
};

describe('server client replica migration', () => {
    it('migrates branch update events, pending uploads, and rematerialized branch history', () => {
        const source = sourceReplica([
            updateEvent('main', 1, update(v1App, sourceDoc(), 'Main', ts('local', 10)), false),
        ]);

        const migrated = migrateServerReplica({
            app: v2App,
            replica: source,
            schemaConfig: config,
            schemaFingerprint: newFingerprint,
            schemaFingerprintHash: newFingerprintHash,
            now: '2026-05-20T00:00:00.000Z',
        });

        const [event] = migrated.branches.main.events;
        expect(migrated.schemaVersion).toBe(2);
        expect(migrated.schemaFingerprintHash).toBe(newFingerprintHash);
        expect(event).toMatchObject({kind: 'update', recorded: false});
        if (event.kind === 'update') {
            expect(event.update.op).toBe('set');
            if (event.update.op === 'set') {
                expect(event.update.path[0]).toMatchObject({type: 'objectField', key: 'label'});
            }
        }
        expect(migrated.branches.main.history.doc.state).toEqual({label: 'Main'});
    });

    it('keeps merge events structural and remaps source event indexes after update migration', () => {
        const base = sourceDoc();
        const featureUpdate = updateEvent('feature', 1, update(v1App, base, 'Feature', ts('feature', 10)), true);
        const merge: ServerBranchEvent = {
            kind: 'merge',
            mergeId: 'merge-1',
            docId: 'doc',
            branchId: 'main',
            eventIndex: 1,
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 1,
            actor: 'user:session',
            createdAt: '2026-05-20T00:00:00.000Z',
            recorded: false,
        };
        const source = sourceReplica([merge], {feature: branch('feature', [featureUpdate])});

        const migrated = migrateServerReplica({
            app: v2App,
            replica: source,
            schemaConfig: config,
            schemaFingerprint: newFingerprint,
            schemaFingerprintHash: newFingerprintHash,
            now: '2026-05-20T00:00:00.000Z',
        });

        expect(migrated.branches.main.events[0]).toMatchObject({
            kind: 'merge',
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 1,
            recorded: false,
        });
        expect(migrated.branches.main.history.doc.state).toEqual({label: 'Feature'});
    });

    it('fails local migration before connection when no migration path exists', () => {
        expect(() =>
            migrateServerReplica({
                app: v2App,
                replica: sourceReplica([
                    updateEvent('main', 1, update(v1App, sourceDoc(), 'Main', ts('local', 10)), false),
                ]),
                schemaConfig: {version: 2, migrations: []},
                schemaFingerprint: newFingerprint,
                schemaFingerprintHash: newFingerprintHash,
                now: '2026-05-20T00:00:00.000Z',
            }),
        ).toThrow();
    });

    it('builds a server migration upload package from a dump', () => {
        const event = updateEvent('main', 1, update(v1App, sourceDoc(), 'Main', ts('local', 10)), true);
        const upload = migrateServerDump({
            app: v2App,
            dump: {
                kind: 'serverMigrationDump',
                version: 3,
                docId: 'doc',
                sourceSchemaVersion: 1,
                sourceSchemaFingerprint: oldFingerprint,
                sourceSchemaFingerprintHash: oldFingerprintHash,
                targetSchemaVersion: 2,
                targetSchemaFingerprint: newFingerprint,
                targetSchemaFingerprintHash: newFingerprintHash,
                branches: [
                    {
                        docId: 'doc',
                        branchId: 'main',
                        name: 'main',
                        tipEventIndex: 1,
                        createdAt: '2026-05-20T00:00:00.000Z',
                        updatedAt: '2026-05-20T00:00:00.000Z',
                    },
                ],
                events: [event],
            },
            schemaConfig: config,
            schemaFingerprint: newFingerprint,
            schemaFingerprintHash: newFingerprintHash,
            now: '2026-05-20T00:00:00.000Z',
        });

        expect(upload).toMatchObject({
            kind: 'serverMigrationUpload',
            docId: 'doc',
            sourceSchemaFingerprintHash: oldFingerprintHash,
            targetSchemaVersion: 2,
            targetSchemaFingerprintHash: newFingerprintHash,
            migrationIds: ['v1-to-v2'],
            migratedAt: '2026-05-20T00:00:00.000Z',
        });
        expect(upload.branches).toHaveLength(1);
        expect(upload.events).toHaveLength(1);
        const [migratedEvent] = upload.events;
        expect(migratedEvent.kind).toBe('update');
        if (migratedEvent.kind === 'update' && migratedEvent.update.op === 'set') {
            expect(migratedEvent.update.path[0]).toMatchObject({type: 'objectField', key: 'label'});
        }
    });
});

function sourceReplica(
    mainEvents: ServerBranchEvent[],
    extraBranches: Record<string, PersistedServerBranch<V1>> = {},
): PersistedServerReplica<V1> {
    const branches = {
        main: branch('main', mainEvents),
        ...extraBranches,
    };
    return {
        docId: 'doc',
        storageVersion: 3,
        protocolVersion: 3,
        schemaVersion: 1,
        schemaFingerprint: oldFingerprint,
        schemaFingerprintHash: oldFingerprintHash,
        activeBranchId: 'main',
        branchList: Object.values(branches).map((item) => ({
            docId: 'doc',
            branchId: item.branchId,
            name: item.branchId,
            sourceBranchId: item.sourceBranchId,
            forkEventIndex: item.forkEventIndex,
            tipEventIndex: item.lastSeenEventIndex,
            createdAt: '2026-05-20T00:00:00.000Z',
            updatedAt: '2026-05-20T00:00:00.000Z',
        })),
        branches,
        updatedAt: '2026-05-20T00:00:00.000Z',
    };
}

function branch(branchId: string, events: ServerBranchEvent[]): PersistedServerBranch<V1> {
    return {
        branchId,
        sourceBranchId: branchId === 'main' ? undefined : 'main',
        forkEventIndex: branchId === 'main' ? undefined : 0,
        history: createCrdtLocalHistory(sourceDoc()),
        lastSeenEventIndex: Math.max(0, ...events.map((event) => event.eventIndex)),
        undoCheckpointEventIndex: 0,
        events,
        mirrored: true,
    };
}

function sourceDoc() {
    return createCrdtDocument(v1App.initialState, v1Schema, {timestamp: ts('seed', 0)});
}

function update(app: AppDefinition<V1>, doc: CrdtDocument<V1>, title: string, timestamp: string) {
    return createCrdtUpdates(
        doc,
        {
            op: 'replace',
            path: [{type: 'key', key: 'title'}],
            previous: app.initialState.title,
            value: title,
        },
        timestamp,
    )[0];
}

function updateEvent(branchId: string, eventIndex: number, update: CrdtUpdate, recorded: boolean): ServerBranchEvent {
    const hlcTimestamp = latestCrdtUpdateTimestamp(update);
    if (!hlcTimestamp) throw new Error('Expected update timestamp.');
    return {
        kind: 'update',
        docId: 'doc',
        branchId,
        eventIndex,
        origin: 'actor:session',
        hlcTimestamp,
        receivedAt: '2026-05-20T00:00:00.000Z',
        update,
        recorded,
    };
}

function objectSchema(required: string[], properties: Record<string, unknown>) {
    return {
        version: '3.1',
        schemas: [{type: 'object', required, properties}],
        components: {schemas: {}},
    };
}

function ts(node: string, value: number) {
    return `0000000000000${String(value).padStart(2, '0')}:00000:${node}`;
}

function validateV1(input: unknown): IValidation<V1> {
    return isRecord(input) && typeof input.title === 'string'
        ? {success: true, data: input as V1}
        : {success: false, data: input, errors: []};
}

function validateV2(input: unknown): IValidation<V2> {
    return isRecord(input) && typeof input.label === 'string'
        ? {success: true, data: input as V2}
        : {success: false, data: input, errors: []};
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}
