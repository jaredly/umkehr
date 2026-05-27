import {describe, expect, it} from 'vitest';
import type {IValidation} from 'typia';
import {
    initialTodoState,
    initialTodoTimestamp,
    todoSchema,
    validateTodoState,
    type TodoState,
} from '../../apps/todos/schema';
import {
    initialWhiteboardState,
    initialWhiteboardTimestamp,
    validateWhiteboardState,
    whiteboardSchema,
    type WhiteboardState,
} from '../../apps/whiteboard/schema';
import type {AppDefinition} from '../crdtApp';
import {createInitialCrdtHistory} from '../crdtApp';
import {materializeServerBranch} from '../server/materialize';
import type {PersistedServerBranch} from '../server/types';
import {
    generateMalformedSeedPayloads,
    generateSeedDatabasePayload,
    generateSeedFixtureCatalog,
    assertBranchFreeSeedFixture,
    isBranchFreeSeedFixture,
} from './generate';
import {createLocalFirstSeedReplica} from './localFirst';
import {createServerClientSeedReplica} from './serverClient';
import {
    todoFixtureV1FingerprintHash,
    todoFixtureV3FingerprintHash,
} from '../../../../migration-fixtures/todos';

const todoSeedApp: AppDefinition<TodoState> = {
    id: 'todos',
    title: 'Todos',
    schemaVersion: 1,
    tagKey: 'type',
    schema: todoSchema,
    initialState: initialTodoState,
    initialTimestamp: initialTodoTimestamp,
    validateState(input: unknown): IValidation<TodoState> {
        return validateTodoState(input);
    },
    renderPanel() {
        return null as never;
    },
};

const whiteboardSeedApp: AppDefinition<WhiteboardState> = {
    id: 'whiteboard',
    title: 'Whiteboard',
    schemaVersion: 1,
    tagKey: 'type',
    schema: whiteboardSchema,
    initialState: initialWhiteboardState,
    initialTimestamp: initialWhiteboardTimestamp,
    validateState(input: unknown): IValidation<WhiteboardState> {
        return validateWhiteboardState(input);
    },
    renderPanel() {
        return null as never;
    },
};

describe('seed database generator', () => {
    it('emits the expected seeded documents and users', () => {
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});

        expect(payload.users.map((user) => user.userId)).toEqual([
            'seed-user-ada',
            'seed-user-ben',
            'seed-user-cy',
            'seed-user-dee',
        ]);
        expect(payload.documents.map((document) => document.docId)).toEqual([
            'todos-small',
            'todos-many-items',
            'todos-many-events',
            'todos-branches',
            'todos-merge-review',
            'todos-conflicting-fields',
            'todos-array-operations',
            'todos-deletes-and-readds',
            'todos-recursive-merges',
            'todos-partial-repeat-merge',
            'todos-wide-branch-list',
            'whiteboard-many-elements',
            'whiteboard-branches',
            'whiteboard-element-editing',
            'whiteboard-dense-overlap',
            'whiteboard-conflicting-element-edits',
            'whiteboard-many-events',
            'todos-migration-v1-main',
            'todos-migration-v3-ahead',
        ]);
    });

    it('is deterministic when a date is provided', () => {
        const first = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const second = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});

        expect(second).toEqual(first);
    });

    it('scales stress fixtures by size', () => {
        const small = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const large = generateSeedDatabasePayload({date: '2026-01-02', size: 'large'});
        const smallManyEvents = small.documents.find(
            (document) => document.docId === 'todos-many-events',
        );
        const largeManyEvents = large.documents.find(
            (document) => document.docId === 'todos-many-events',
        );

        expect(smallManyEvents?.events.length).toBe(200);
        expect(largeManyEvents?.events.length).toBe(5000);

        const smallWhiteboardEvents = small.documents.find(
            (document) => document.docId === 'whiteboard-many-events',
        );
        const largeWhiteboardEvents = large.documents.find(
            (document) => document.docId === 'whiteboard-many-events',
        );
        expect(smallWhiteboardEvents?.events.length).toBe(150);
        expect(largeWhiteboardEvents?.events.length).toBe(3000);
    });

    it('projects a fixture catalog to the server payload shape', () => {
        const catalog = generateSeedFixtureCatalog({date: '2026-01-02', size: 'small'});
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});

        expect(catalog.fixtures.map((fixture) => fixture.docId)).toEqual(
            payload.documents.map((document) => document.docId),
        );
        expect(catalog.fixtures.find((fixture) => fixture.docId === 'todos-small')?.histories.main)
            .toBeDefined();
        expect(payload.documents[0]).not.toHaveProperty('histories');
    });

    it('identifies branch-free fixtures for browser document imports', () => {
        const catalog = generateSeedFixtureCatalog({date: '2026-01-02', size: 'small'});
        const manyEvents = catalog.fixtures.find((fixture) => fixture.docId === 'todos-many-events');
        const branches = catalog.fixtures.find((fixture) => fixture.docId === 'todos-branches');
        if (!manyEvents || !branches) throw new Error('Missing fixtures.');

        expect(isBranchFreeSeedFixture(manyEvents)).toBe(true);
        expect(() => assertBranchFreeSeedFixture(manyEvents)).not.toThrow();
        expect(isBranchFreeSeedFixture(branches)).toBe(false);
        expect(() => assertBranchFreeSeedFixture(branches)).toThrow(/multiple branches/);
    });

    it('projects branch-free fixtures to deterministic local-first replicas', () => {
        const catalog = generateSeedFixtureCatalog({date: '2026-01-02', size: 'small'});
        const fixture = catalog.fixtures.find((candidate) => candidate.docId === 'todos-many-events');
        if (!fixture) throw new Error('Missing todos-many-events fixture.');

        const projected = createLocalFirstSeedReplica({fixture});

        expect(projected.identity.replicaId).toBe('seed-replica-todos-many-events');
        expect(projected.replica.docId).toBe('todos-many-events');
        expect(projected.replica.replicaId).toBe(projected.identity.replicaId);
        expect(projected.batches).toHaveLength(fixture.events.length);
        expect(projected.batches[0]?.batchId).toBe('seed-000001');
        expect(Object.keys(projected.replica.vector).length).toBeGreaterThan(0);
    });

    it('projects server client seed replicas for cached and pending states', () => {
        const catalog = generateSeedFixtureCatalog({date: '2026-01-02', size: 'small'});
        const fixture = catalog.fixtures.find((candidate) => candidate.docId === 'todos-branches');
        if (!fixture) throw new Error('Missing todos-branches fixture.');

        const cached = createServerClientSeedReplica({fixture, scenario: 'cached'});
        const pending = createServerClientSeedReplica({fixture, scenario: 'pending-uploads'});

        expect(cached.branches.main?.lastSeenEventIndex).toBe(
            fixture.branches.find((branch) => branch.branchId === 'main')?.tipEventIndex,
        );
        expect(cached.branches.main?.events.every((event) => event.recorded)).toBe(true);
        expect(pending.branches.main?.lastSeenEventIndex).toBe(0);
        expect(pending.branches.main?.events.some((event) => event.recorded === false)).toBe(true);
    });

    it('emits non-root CRDT paths for branch fixture edits', () => {
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const whiteboard = payload.documents.find(
            (document) => document.docId === 'whiteboard-branches',
        );
        const branchUpdates = whiteboard?.events.filter(
            (event) => event.kind === 'update' && event.branchId !== 'main',
        );

        expect(branchUpdates).toHaveLength(2);
        expect(
            branchUpdates?.every(
                (event) =>
                    event.kind === 'update' &&
                    event.update.op === 'set' &&
                    event.update.path.length > 0,
            ),
        ).toBe(true);
    });

    it('materializes whiteboard branch additions after merges into main', () => {
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const document = payload.documents.find(
            (candidate) => candidate.docId === 'whiteboard-branches',
        );
        if (!document) throw new Error('Missing whiteboard branches fixture.');
        const branches = Object.fromEntries(
            document.branches.map((branch) => [
                branch.branchId,
                {
                    branchId: branch.branchId,
                    sourceBranchId: branch.sourceBranchId,
                    forkEventIndex: branch.forkEventIndex,
                    history: createInitialCrdtHistory(whiteboardSeedApp),
                    lastSeenEventIndex: branch.tipEventIndex,
                    undoCheckpointEventIndex: 0,
                    events: document.events.filter((event) => event.branchId === branch.branchId),
                    mirrored: true,
                } satisfies PersistedServerBranch<WhiteboardState>,
            ]),
        );

        const history = materializeServerBranch({
            app: whiteboardSeedApp,
            branches,
            branchId: 'main',
        });

        expect(Object.keys(history.doc.state.elements).sort()).toEqual([
            'annotation',
            'intro',
            'layout',
            'sketch',
        ]);
    });

    it('materializes complex todo merge fixtures deterministically', () => {
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const recursive = requiredDocument(payload, 'todos-recursive-merges');
        const history = materializeTodoDocument(recursive);

        expect(history.doc.state.todos.map((todo) => todo.id).sort()).toContain('feature-task');
        expect(history.doc.state.todos.find((todo) => todo.id === 'dependency')?.title).toBe(
            'Dependency branch edit',
        );
    });

    it('emits delete/tombstone updates for deletion fixtures', () => {
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const todos = requiredDocument(payload, 'todos-deletes-and-readds');
        const whiteboard = requiredDocument(payload, 'whiteboard-element-editing');

        expect(todos.events.some((event) => event.kind === 'update' && event.update.op === 'delete'))
            .toBe(true);
        expect(
            whiteboard.events.some(
                (event) => event.kind === 'update' && event.update.op === 'delete',
            ),
        ).toBe(true);

        const history = materializeTodoDocument(todos);
        expect(history.doc.state.todos.filter((todo) => todo.id === 'reuse')).toHaveLength(1);
    });

    it('emits migration seed schema metadata', () => {
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const behindClient = requiredDocument(payload, 'todos-migration-v1-main');
        const aheadOfClient = requiredDocument(payload, 'todos-migration-v3-ahead');

        expect(behindClient.appId).toBe('todos');
        expect(behindClient.schemaVersion).toBe(1);
        expect(behindClient.schemaFingerprintHash).toBe(todoFixtureV1FingerprintHash);
        expect(behindClient.events.length).toBeGreaterThan(0);
        expect(aheadOfClient.appId).toBe('todos');
        expect(aheadOfClient.schemaVersion).toBe(3);
        expect(aheadOfClient.schemaFingerprintHash).toBe(todoFixtureV3FingerprintHash);
        expect(aheadOfClient.events.length).toBeGreaterThan(0);
    });

    it('generates malformed payloads separately from the valid default payload', () => {
        const malformed = generateMalformedSeedPayloads({date: '2026-01-02', size: 'small'});
        const valid = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});

        expect(Object.keys(malformed).sort()).toEqual([
            'duplicateEventIndex',
            'mergePastSourceTip',
            'mismatchedSchemaHash',
            'missingSourceBranch',
            'unknownActor',
        ]);
        expect(valid.documents[0].schemaFingerprintHash).not.toBe(
            malformed.mismatchedSchemaHash.documents[0].schemaFingerprintHash,
        );
        expect(
            malformed.missingSourceBranch.documents[0].branches.some(
                (branch) => branch.sourceBranchId === 'does-not-exist',
            ),
        ).toBe(true);
    });
});

function requiredDocument(payload: ReturnType<typeof generateSeedDatabasePayload>, docId: string) {
    const document = payload.documents.find((candidate) => candidate.docId === docId);
    if (!document) throw new Error(`Missing ${docId} fixture.`);
    return document;
}

function materializeTodoDocument(document: ReturnType<typeof requiredDocument>) {
    const branches = Object.fromEntries(
        document.branches.map((branch) => [
            branch.branchId,
            {
                branchId: branch.branchId,
                sourceBranchId: branch.sourceBranchId,
                forkEventIndex: branch.forkEventIndex,
                history: createInitialCrdtHistory(todoSeedApp),
                lastSeenEventIndex: branch.tipEventIndex,
                undoCheckpointEventIndex: 0,
                events: document.events.filter((event) => event.branchId === branch.branchId),
                mirrored: true,
            } satisfies PersistedServerBranch<TodoState>,
        ]),
    );

    return materializeServerBranch({
        app: todoSeedApp,
        branches,
        branchId: 'main',
    });
}
