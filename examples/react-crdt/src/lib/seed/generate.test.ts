import {describe, expect, it} from 'vitest';
import type {IValidation} from 'typia';
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
import {generateSeedDatabasePayload} from './generate';

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
            'whiteboard-many-elements',
            'whiteboard-branches',
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
        const smallManyEvents = small.documents.find((document) => document.docId === 'todos-many-events');
        const largeManyEvents = large.documents.find((document) => document.docId === 'todos-many-events');

        expect(smallManyEvents?.events.length).toBe(200);
        expect(largeManyEvents?.events.length).toBe(5000);
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
                (event) => event.kind === 'update' && event.update.path.length > 0,
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
});
