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
} from './generate';
import {todoFixtureV1FingerprintHash} from '../../../../migration-fixtures/todos';

const todoSeedApp: AppDefinition<TodoState> = {
    id: 'todos',
    title: 'Todos',
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
        const migration = requiredDocument(payload, 'todos-migration-v1-main');

        expect(migration.appId).toBe('todos-migration-fixture');
        expect(migration.schemaVersion).toBe(1);
        expect(migration.schemaFingerprintHash).toBe(todoFixtureV1FingerprintHash);
        expect(migration.events.length).toBeGreaterThan(0);
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
