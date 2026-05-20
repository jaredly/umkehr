import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    createCrdtUpdates,
    hlc,
    type CrdtDocument,
} from 'umkehr/crdt';
import {createRecentBatchCache, batchKey} from './recentBatchCache';
import {
    LOCAL_FIRST_PROTOCOL_VERSION,
    parseLocalFirstMessage,
    type LocalFirstProtocolConfig,
} from './protocol';
import {buildSnapshotReplayPreview} from './replay';
import type {PersistedBatch, PersistedReplica, VersionVector} from './types';
import {
    advanceVector,
    batchTimestampRange,
    mergeVectors,
    vectorDominates,
    vectorForUpdates,
} from './vector';
import {
    createMembersMessage,
    planConnectionOpened,
    planIncomingMessage,
    type LocalFirstSessionState,
} from './session';
import {
    createMigratedReplica,
    findMigrationCandidate,
    normalizePersistedReplica,
} from './migration';
import type {LocalFirstSchemaConfig} from './schemaConfig';

type Todo = {id: string; title: string; done: boolean};
type State = {
    title: string;
    todos: Todo[];
};

const schema = {
    schemas: [
        {
            type: 'object',
            properties: {
                title: {type: 'string'},
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: {type: 'string'},
                            title: {type: 'string'},
                            done: {type: 'boolean'},
                        },
                    },
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [State]>;

const initial: State = {
    title: 'Draft',
    todos: [{id: 'one', title: 'One', done: false}],
};

const doc = (state: State = initial, timestamp = ts('seed', 1)) =>
    createCrdtDocument(state, schema, {timestamp});

const ts = (node: string, value: number) => hlc.pack({node, ts: value, count: 0});

const validateState = (input: unknown): IValidation<State> => {
    if (
        typeof input === 'object' &&
        input !== null &&
        !Array.isArray(input) &&
        typeof (input as State).title === 'string' &&
        Array.isArray((input as State).todos)
    ) {
        return {success: true, data: input as State};
    }
    return {success: false, data: input, errors: []};
};

const config: LocalFirstProtocolConfig<State> = {
    docId: 'todos',
    schemaVersion: 1,
    schemaFingerprint: 'test-schema',
    schemaFingerprintHash: 'test-schema-hash',
    schema,
    tagKey: 'type',
    validateState,
};

const schemaHeader = {
    schemaVersion: 1,
    schemaFingerprint: 'test-schema',
    schemaFingerprintHash: 'test-schema-hash',
};

function titleUpdate(document: CrdtDocument<State>, title: string, timestamp: string) {
    return createCrdtUpdates(
        document,
        {
            op: 'replace',
            path: [{type: 'key', key: 'title'}],
            previous: document.state.title,
            value: title,
        },
        timestamp,
    )[0];
}

function batch({
    batchId = 'batch-1',
    docId = 'todos',
    origin = 'local',
    timestamp = ts(origin, 10),
    document = doc(),
    title = 'Edited',
}: {
    batchId?: string;
    docId?: string;
    origin?: string;
    timestamp?: string;
    document?: CrdtDocument<State>;
    title?: string;
} = {}): PersistedBatch {
    const updates = [titleUpdate(document, title, timestamp)];
    return {
        docId,
        batchId,
        origin,
        updates,
        ...batchTimestampRange(updates),
        vectorAfter: vectorForUpdates(updates),
        receivedAt: '2026-05-17T00:00:00.000Z',
    };
}

describe('local-first vector helpers', () => {
    it('tracks the newest timestamp per actor and compares vectors', () => {
        const first = batch({origin: 'local', timestamp: ts('local', 10)});
        const second = batch({origin: 'remote', timestamp: ts('remote', 20), batchId: 'batch-2'});

        const vector = advanceVector(vectorForUpdates(first.updates), second.updates);
        expect(vector).toEqual({
            local: ts('local', 10),
            remote: ts('remote', 20),
        });
        expect(vectorDominates(vector, {local: ts('local', 9)})).toBe(true);
        expect(vectorDominates({local: ts('local', 9)}, vector)).toBe(false);
        expect(mergeVectors({local: ts('local', 8)}, {local: ts('local', 10)})).toEqual({
            local: ts('local', 10),
        });
    });

    it('includes setOrder timestamps when advancing a vector', () => {
        const document = doc({
            title: 'Draft',
            todos: [
                {id: 'one', title: 'One', done: false},
                {id: 'two', title: 'Two', done: false},
            ],
        });
        const updates = createCrdtUpdates(
            document,
            {op: 'reorder', path: [{type: 'key', key: 'todos'}], indices: [1, 0]},
            ts('local', 25),
        );

        expect(vectorForUpdates(updates)).toEqual({local: ts('local', 25)});
    });
});

describe('local-first protocol validation', () => {
    it('accepts valid update batches for the configured document', () => {
        const parsed = parseLocalFirstMessage(
            {
                kind: 'updates',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: 'local',
                docId: 'todos',
                ...schemaHeader,
                batch: batch(),
            },
            config,
        );

        expect(parsed?.kind).toBe('updates');
        expect(parsed?.kind === 'updates' ? parsed.batch.updates : []).toHaveLength(1);
    });

    it('rejects messages for another document or protocol version', () => {
        expect(
            parseLocalFirstMessage(
                {
                    kind: 'hello',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: 'local',
                    docId: 'other',
                    ...schemaHeader,
                    role: 'host',
                    vector: {},
                },
                config,
            ),
        ).toBeNull();
        expect(
            parseLocalFirstMessage(
                {
                    kind: 'hello',
                    version: 2,
                    actor: 'local',
                    docId: 'todos',
                    ...schemaHeader,
                    role: 'host',
                    vector: {},
                },
                config,
            ),
        ).toBeNull();
    });

    it('rejects messages for another schema version or fingerprint', () => {
        expect(
            parseLocalFirstMessage(
                {
                    kind: 'hello',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: 'local',
                    docId: 'todos',
                    schemaVersion: 2,
                    schemaFingerprint: 'test-schema',
                    role: 'host',
                    vector: {},
                },
                config,
            ),
        ).toBeNull();
        expect(
            parseLocalFirstMessage(
                {
                    kind: 'hello',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: 'local',
                    docId: 'todos',
                    schemaVersion: 1,
                    schemaFingerprint: 'other-schema',
                    role: 'host',
                    vector: {},
                },
                config,
            ),
        ).toBeNull();
    });

    it('rejects malformed HLC timestamps in vectors and batches', () => {
        expect(
            parseLocalFirstMessage(
                {
                    kind: 'hello',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: 'local',
                    docId: 'todos',
                    ...schemaHeader,
                    role: 'host',
                    vector: {local: 'not-a-timestamp'},
                },
                config,
            ),
        ).toBeNull();

        expect(
            parseLocalFirstMessage(
                {
                    kind: 'updates',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: 'local',
                    docId: 'todos',
                    ...schemaHeader,
                    batch: {...batch(), maxTs: 'not-a-timestamp'},
                },
                config,
            ),
        ).toBeNull();
    });

    it('rejects malformed batches and member announcements', () => {
        const invalidBatch = {...batch(), updates: [{op: 'definitely-not-a-crdt-update'}]};
        expect(
            parseLocalFirstMessage(
                {
                    kind: 'updates',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: 'local',
                    docId: 'todos',
                    ...schemaHeader,
                    batch: invalidBatch,
                },
                config,
            ),
        ).toBeNull();
        expect(
            parseLocalFirstMessage(
                {
                    kind: 'members',
                    version: LOCAL_FIRST_PROTOCOL_VERSION,
                    actor: 'local',
                    docId: 'todos',
                    ...schemaHeader,
                    members: [
                        {
                            peerId: '',
                            actor: 'remote',
                            role: 'host',
                            vector: {},
                            docId: 'todos',
                            ...schemaHeader,
                        },
                    ],
                },
                config,
            ),
        ).toBeNull();
    });

    it('validates snapshots against state and schema context', () => {
        const snapshot = {
            kind: 'snapshot',
            version: LOCAL_FIRST_PROTOCOL_VERSION,
            actor: 'remote',
            docId: 'todos',
            ...schemaHeader,
            document: doc({title: 'Remote', todos: []}, ts('remote', 1)),
            compactedThrough: {remote: ts('remote', 1)},
        };

        expect(parseLocalFirstMessage(snapshot, config)?.kind).toBe('snapshot');
        expect(
            parseLocalFirstMessage(
                {
                    ...snapshot,
                    document: {
                        ...snapshot.document,
                        schema: {...snapshot.document.schema, tagKey: 'kind'},
                    },
                },
                config,
            ),
        ).toBeNull();
        expect(
            parseLocalFirstMessage(
                {
                    ...snapshot,
                    document: {
                        ...snapshot.document,
                        state: {title: 123, todos: []},
                    },
                },
                config,
            ),
        ).toBeNull();
    });
});

describe('local-first recent batch cache', () => {
    it('deduplicates batch keys and evicts the oldest entries', () => {
        const cache = createRecentBatchCache(2);
        const one = batchKey('todos', 'local', 'one');
        const two = batchKey('todos', 'local', 'two');
        const three = batchKey('todos', 'local', 'three');

        cache.add(one);
        cache.add(one);
        cache.add(two);
        cache.add(three);

        expect(cache.has(one)).toBe(false);
        expect(cache.has(two)).toBe(true);
        expect(cache.has(three)).toBe(true);
        cache.clear();
        expect(cache.has(two)).toBe(false);
    });
});

describe('local-first snapshot replay preview', () => {
    it('previews local retained batches over a peer snapshot', () => {
        const peerSnapshot = doc({title: 'Remote', todos: []}, ts('remote', 1));
        const localBatch = batch({
            origin: 'local',
            document: peerSnapshot,
            timestamp: ts('local', 10),
            title: 'Local over remote',
        });
        const remoteBatch = batch({
            origin: 'remote',
            batchId: 'remote-batch',
            document: peerSnapshot,
            timestamp: ts('remote', 12),
            title: 'Ignored remote',
        });

        const preview = buildSnapshotReplayPreview({
            pending: {
                actor: 'remote',
                document: peerSnapshot,
                compactedThrough: {remote: ts('remote', 1)},
            },
            localReplicaId: 'local',
            batches: [remoteBatch, localBatch],
        });

        expect(preview.localBatches.map(({batchId}) => batchId)).toEqual(['batch-1']);
        expect(preview.skippedUpdates).toBe(0);
        expect(preview.history.doc.state.title).toBe('Local over remote');
        expect(preview.vector).toEqual({remote: ts('remote', 1), local: ts('local', 10)});
    });

    it('skips local batches already dominated by the snapshot frontier', () => {
        const peerSnapshot = doc({title: 'Remote', todos: []}, ts('remote', 1));
        const dominatedLocalBatch = batch({
            origin: 'local',
            document: peerSnapshot,
            timestamp: ts('local', 10),
            title: 'Already compacted',
        });

        const preview = buildSnapshotReplayPreview({
            pending: {
                actor: 'remote',
                document: peerSnapshot,
                compactedThrough: {remote: ts('remote', 1), local: ts('local', 10)},
            },
            localReplicaId: 'local',
            batches: [dominatedLocalBatch],
        });

        expect(preview.localBatches).toEqual([]);
        expect(preview.skippedUpdates).toBe(0);
        expect(preview.history.doc.state.title).toBe('Remote');
    });

    it('reports retained local updates that cannot be replayed on the snapshot', () => {
        const peerSnapshot = doc({title: 'Remote', todos: []}, ts('remote', 1));
        const invalidLocalBatch = batch({
            origin: 'local',
            document: peerSnapshot,
            timestamp: ts('local', 10),
            title: 'Local over remote',
        });
        invalidLocalBatch.updates = invalidLocalBatch.updates.map((update) => ({
            ...update,
            path: [{type: 'objectField', key: 'missing', parentCreated: ts('seed', 1)}],
        }));

        const preview = buildSnapshotReplayPreview({
            pending: {
                actor: 'remote',
                document: peerSnapshot,
                compactedThrough: {remote: ts('remote', 1)},
            },
            localReplicaId: 'local',
            batches: [invalidLocalBatch],
        });

        expect(preview.localBatches.map(({batchId}) => batchId)).toEqual(['batch-1']);
        expect(preview.skippedUpdates).toBe(1);
        expect(preview.history.doc.state.title).toBe('Remote');
    });
});

describe('local-first session planning', () => {
    const session = (
        overrides: Partial<LocalFirstSessionState<State>> = {},
    ): LocalFirstSessionState<State> => ({
        docId: 'todos',
        ...schemaHeader,
        replicaId: 'local',
        role: 'host',
        selfPeerId: 'peer-local',
        vector: {local: ts('local', 10)},
        document: doc({title: 'Local', todos: []}, ts('local', 1)),
        connections: [{peerId: 'peer-remote', open: true}],
        ...overrides,
    });

    it('plans the connection-open handshake without using a transport', () => {
        const effects = planConnectionOpened(session(), 'peer-remote');

        expect(effects.map((effect) => effect.kind)).toEqual(['send', 'send', 'send']);
        expect(
            effects.map((effect) => (effect.kind === 'send' ? effect.message.kind : undefined)),
        ).toEqual(['hello', 'syncRequest', 'members']);
    });

    it('plans hello responses as snapshot, sync request, and membership gossip', () => {
        const effects = planIncomingMessage({
            state: session(),
            peerId: 'peer-remote',
            input: {
                kind: 'hello',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: 'remote',
                peerId: 'peer-remote',
                docId: 'todos',
                ...schemaHeader,
                role: 'client',
                vector: {remote: ts('remote', 1)},
            },
            config,
        });

        expect(effects.map((effect) => effect.kind)).toEqual([
            'markConnection',
            'send',
            'send',
            'send',
            'broadcastMembers',
        ]);
        expect(
            effects.map((effect) => (effect.kind === 'send' ? effect.message.kind : undefined)),
        ).toEqual([undefined, 'snapshot', 'syncRequest', 'members', undefined]);
        expect(effects[0]).toMatchObject({
            kind: 'markConnection',
            peerId: 'peer-remote',
            actor: 'remote',
            role: 'client',
        });
    });

    it('turns invalid input into a connection error effect', () => {
        expect(
            planIncomingMessage({
                state: session(),
                peerId: 'peer-remote',
                input: {
                    kind: 'hello',
                    version: 2,
                    actor: 'remote',
                    docId: 'todos',
                    ...schemaHeader,
                },
                config,
            }),
        ).toEqual([
            {
                kind: 'connectionError',
                peerId: 'peer-remote',
                message: 'Rejected invalid message from peer-remote.',
            },
        ]);
    });

    it('plans sync requests and sync responses as transport-independent effects', () => {
        const syncRequestEffects = planIncomingMessage({
            state: session(),
            peerId: 'peer-remote',
            input: {
                kind: 'syncRequest',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: 'remote',
                docId: 'todos',
                ...schemaHeader,
                vector: {remote: ts('remote', 1)},
            },
            config,
        });
        expect(syncRequestEffects).toMatchObject([
            {kind: 'markConnection', peerId: 'peer-remote', actor: 'remote'},
            {kind: 'sendMissingBatches', peerId: 'peer-remote', since: {remote: ts('remote', 1)}},
        ]);

        const remoteBatch = batch({origin: 'remote', timestamp: ts('remote', 20)});
        const syncResponseEffects = planIncomingMessage({
            state: session(),
            peerId: 'peer-remote',
            input: {
                kind: 'syncResponse',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: 'remote',
                docId: 'todos',
                ...schemaHeader,
                since: {},
                batches: [remoteBatch],
            },
            config,
        });
        expect(syncResponseEffects).toMatchObject([
            {kind: 'markConnection', peerId: 'peer-remote', actor: 'remote'},
            {kind: 'acceptBatch', fromPeerId: 'peer-remote', batch: remoteBatch},
        ]);
    });

    it('plans snapshots and discovered mesh peers without PeerJS', () => {
        const snapshot = doc({title: 'Remote snapshot', todos: []}, ts('remote', 1));
        const snapshotEffects = planIncomingMessage({
            state: session(),
            peerId: 'peer-remote',
            input: {
                kind: 'snapshot',
                version: LOCAL_FIRST_PROTOCOL_VERSION,
                actor: 'remote',
                docId: 'todos',
                ...schemaHeader,
                document: snapshot,
                compactedThrough: {remote: ts('remote', 1)},
            },
            config,
        });
        expect(snapshotEffects).toMatchObject([
            {kind: 'markConnection', peerId: 'peer-remote', actor: 'remote'},
            {
                kind: 'acceptSnapshot',
                actor: 'remote',
                document: snapshot,
                compactedThrough: {remote: ts('remote', 1)},
            },
        ]);

        const members = createMembersMessage(
            session({
                replicaId: 'remote',
                selfPeerId: 'peer-remote',
                connections: [
                    {peerId: 'peer-local', actor: 'local', role: 'host', open: true},
                    {peerId: 'peer-third', actor: 'third', role: 'client', open: true},
                ],
            }),
        );
        const memberEffects = planIncomingMessage({
            state: session(),
            peerId: 'peer-remote',
            input: members,
            config,
        });

        expect(memberEffects).toMatchObject([
            {kind: 'markConnection', peerId: 'peer-remote', actor: 'remote'},
            {kind: 'recordMembers', peerId: 'peer-remote'},
            {kind: 'connect', peerId: 'peer-third'},
        ]);
    });

    it('does not connect to discovered members for another document schema', () => {
        const members = createMembersMessage(
            session({
                replicaId: 'remote',
                selfPeerId: 'peer-remote',
                connections: [
                    {
                        peerId: 'peer-other-schema',
                        actor: 'other',
                        role: 'client',
                        docId: 'todos',
                        schemaVersion: 2,
                        schemaFingerprint: 'other-schema',
                        open: true,
                    },
                ],
            }),
        );
        const effects = planIncomingMessage({
            state: session(),
            peerId: 'peer-remote',
            input: members,
            config,
        });

        expect(effects.some((effect) => effect.kind === 'connect')).toBe(false);
    });
});

describe('local-first new-document migrations', () => {
    const sourceReplica = () =>
        ({
        docId: 'todos-v1',
        storageVersion: 1,
        protocolVersion: 1,
        schemaFingerprint: 'old-schema',
        replicaId: 'local',
        history: createCrdtLocalHistory(doc({title: 'Old', todos: []})),
        vector: {local: ts('local', 10)},
        updatedAt: '2026-05-17T00:00:00.000Z',
    }) as unknown as Omit<PersistedReplica<State>, 'schemaVersion'>;

    const migrationConfig: LocalFirstSchemaConfig<State> = {
        version: 2,
        migrations: [
            {
                id: 'todos-v1-to-v2',
                fromVersion: 1,
                toVersion: 2,
                fromFingerprint: 'old-schema',
                toDocId: 'todos-v2',
                migrateState(input) {
                    return input as State;
                },
            },
        ],
    };

    it('normalizes missing schema versions to v1', () => {
        expect(normalizePersistedReplica(sourceReplica()).schemaVersion).toBe(1);
    });

    it('finds a new-document migration candidate for a mismatched schema', () => {
        const candidate = findMigrationCandidate({
            source: normalizePersistedReplica(sourceReplica()),
            current: migrationConfig,
            currentFingerprint: 'new-schema',
        });

        expect(candidate).toMatchObject({
            sourceDocId: 'todos-v1',
            targetDocId: 'todos-v2',
            sourceSchemaVersion: 1,
            targetSchemaVersion: 2,
            migrationIds: ['todos-v1-to-v2'],
        });
    });

    it('creates a migrated replica without mutating the source document', () => {
        const source = normalizePersistedReplica(sourceReplica());
        const candidate = findMigrationCandidate({
            source,
            current: migrationConfig,
            currentFingerprint: 'new-schema',
        });
        expect(candidate).not.toBeNull();
        if (!candidate) return;

        const migrated = createMigratedReplica({
            source,
            candidate,
            identity: {replicaId: 'local', createdAt: '2026-05-17T00:00:00.000Z'},
            schema,
            tagKey: 'type',
            validateState,
            now: '2026-05-17T00:00:00.000Z',
        });

        expect(source.docId).toBe('todos-v1');
        expect(source.vector).toEqual({local: ts('local', 10)});
        expect(migrated).toMatchObject({
            docId: 'todos-v2',
            schemaVersion: 2,
            schemaFingerprint: 'new-schema',
            replicaId: 'local',
            vector: {},
            lineage: {
                sourceDocId: 'todos-v1',
                sourceSchemaVersion: 1,
                sourceSchemaFingerprint: 'old-schema',
                migrationId: 'todos-v1-to-v2',
            },
        });
        expect(migrated.compactedThrough).toBeUndefined();
        expect(migrated.history.doc.state.title).toBe('Old');
        expect(migrated.history.doc.schema.tagKey).toBe('type');
    });
});
