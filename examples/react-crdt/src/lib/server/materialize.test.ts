import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {
    createCrdtUpdates,
    latestCrdtUpdateTimestamp,
    type CrdtUpdate,
} from 'umkehr/crdt';
import {createInitialCrdtHistory, type AppDefinition} from '../crdtApp';
import {materializeServerBranch} from './materialize';
import type {PersistedServerBranch, ServerBranchEvent} from './types';

type State = {
    title: string;
    count: number;
};

const schema = {
    schemas: [
        {
            type: 'object',
            properties: {
                title: {type: 'string'},
                count: {type: 'number'},
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [State]>;

const app: AppDefinition<State> = {
    id: 'test',
    title: 'Test',
    tagKey: 'type',
    schema,
    initialState: {title: 'Draft', count: 0},
    validateState(input) {
        return {success: true, data: input as State};
    },
    renderPanel() {
        return null as never;
    },
};

describe('materializeServerBranch', () => {
    it('replays branch update events by server event index', () => {
        const initial = createInitialCrdtHistory(app);
        const eventOne = updateEvent(
            'main',
            1,
            createCrdtUpdates(
                initial.doc,
                {
                    op: 'replace',
                    path: [{type: 'key', key: 'title'}],
                    value: 'First',
                    previous: 'Draft',
                },
                '010:actor',
            )[0],
        );
        const afterOne = materializeServerBranch({
            app,
            branchId: 'main',
            branches: {
                main: branch('main', [eventOne]),
            },
        });
        const eventTwo = updateEvent(
            'main',
            2,
            createCrdtUpdates(
                afterOne.doc,
                {
                    op: 'replace',
                    path: [{type: 'key', key: 'count'}],
                    value: 2,
                    previous: 0,
                },
                '001:actor',
            )[0],
        );

        const history = materializeServerBranch({
            app,
            branchId: 'main',
            branches: {
                main: branch('main', [eventTwo, eventOne]),
            },
        });

        expect(history.doc.state).toEqual({title: 'First', count: 2});
        expect(history.updates.map((update) => latestCrdtUpdateTimestamp(update))).toEqual([
            '010:actor',
            '001:actor',
        ]);
    });

    it('applies merge-included source updates without adding them to target undo history', () => {
        const initial = createInitialCrdtHistory(app);
        const sourceUpdate = updateEvent(
            'feature',
            1,
            createCrdtUpdates(
                initial.doc,
                {
                    op: 'replace',
                    path: [{type: 'key', key: 'title'}],
                    value: 'Feature',
                    previous: 'Draft',
                },
                '002:feature',
            )[0],
        );
        const merge: ServerBranchEvent = {
            kind: 'merge',
            mergeId: 'merge-1',
            docId: 'doc',
            branchId: 'main',
            eventIndex: 1,
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 1,
            actor: 'user:session',
            createdAt: 'now',
        };

        const history = materializeServerBranch({
            app,
            branchId: 'main',
            branches: {
                main: branch('main', [merge]),
                feature: {
                    ...branch('feature', [sourceUpdate]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
            },
        });

        expect(history.doc.state.title).toBe('Feature');
        expect(history.updates).toHaveLength(0);
    });
});

function branch(
    branchId: string,
    events: ServerBranchEvent[],
): PersistedServerBranch<State> {
    return {
        branchId,
        history: createInitialCrdtHistory(app),
        lastSeenEventIndex: Math.max(0, ...events.map((event) => event.eventIndex)),
        undoCheckpointEventIndex: 0,
        events,
        mirrored: true,
    };
}

function updateEvent(branchId: string, eventIndex: number, update: CrdtUpdate): ServerBranchEvent {
    const hlcTimestamp = latestCrdtUpdateTimestamp(update);
    if (!hlcTimestamp) throw new Error('Expected timestamped update.');
    return {
        kind: 'update',
        docId: 'doc',
        branchId,
        eventIndex,
        origin: 'actor',
        hlcTimestamp,
        receivedAt: 'now',
        update,
    };
}
