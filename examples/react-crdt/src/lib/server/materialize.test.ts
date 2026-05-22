import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection} from 'typia';
import {
    createCrdtUpdates,
    hlc,
    latestCrdtUpdateTimestamp,
    type CrdtUpdate,
} from 'umkehr/crdt';
import {createInitialCrdtHistory, type AppDefinition} from '../crdtApp';
import {buildMergePathPreview, materializeServerBranch} from './materialize';
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

describe('buildMergePathPreview impact', () => {
    it('reports fresh source updates as effective', () => {
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
                timestamp('feature', 1),
            )[0],
        );

        const preview = buildMergePathPreview({
            app,
            branches: {
                main: branch('main', []),
                feature: {
                    ...branch('feature', [sourceUpdate]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
            },
            targetBranchId: 'main',
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 1,
            revertedPathKeys: new Set(),
            clock: hlc.init('preview', 0),
        });

        expect(preview.impact).toMatchObject({
            sourceUpdateCount: 1,
            effectiveUpdateCount: 1,
            alreadyMergedUpdateCount: 0,
            noEffectUpdateCount: 0,
            alreadyMerged: false,
        });
    });

    it('reports an already merged source as no effect', () => {
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
                timestamp('feature', 1),
            )[0],
        );
        const merge = mergeEvent('main', 1, 'feature', 1);

        const preview = buildMergePathPreview({
            app,
            branches: {
                main: branch('main', [merge]),
                feature: {
                    ...branch('feature', [sourceUpdate]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
            },
            targetBranchId: 'main',
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 1,
            revertedPathKeys: new Set(),
            clock: hlc.init('preview', 0),
        });

        expect(preview.impact).toMatchObject({
            sourceUpdateCount: 1,
            effectiveUpdateCount: 0,
            alreadyMergedUpdateCount: 1,
            noEffectUpdateCount: 1,
            alreadyMerged: true,
            alreadyMergedThroughEventIndex: 1,
        });
    });

    it('counts older source updates that lose to target LWW as no effect', () => {
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
                timestamp('feature', 1),
            )[0],
        );
        const targetUpdate = updateEvent(
            'main',
            1,
            createCrdtUpdates(
                initial.doc,
                {
                    op: 'replace',
                    path: [{type: 'key', key: 'title'}],
                    value: 'Main',
                    previous: 'Draft',
                },
                timestamp('main', 2),
            )[0],
        );

        const preview = buildMergePathPreview({
            app,
            branches: {
                main: branch('main', [targetUpdate]),
                feature: {
                    ...branch('feature', [sourceUpdate]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
            },
            targetBranchId: 'main',
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 1,
            revertedPathKeys: new Set(),
            clock: hlc.init('preview', 0),
        });

        expect(preview.impact).toMatchObject({
            sourceUpdateCount: 1,
            effectiveUpdateCount: 0,
            alreadyMergedUpdateCount: 0,
            noEffectUpdateCount: 1,
            alreadyMerged: false,
        });
    });

    it('includes recursive merge source updates in impact counts', () => {
        const initial = createInitialCrdtHistory(app);
        const dependencyUpdate = updateEvent(
            'dependency',
            1,
            createCrdtUpdates(
                initial.doc,
                {
                    op: 'replace',
                    path: [{type: 'key', key: 'title'}],
                    value: 'Dependency',
                    previous: 'Draft',
                },
                timestamp('dependency', 1),
            )[0],
        );
        const featureBase = materializeServerBranch({
            app,
            branchId: 'feature',
            branches: {
                main: branch('main', []),
                dependency: {
                    ...branch('dependency', [dependencyUpdate]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
                feature: {
                    ...branch('feature', [mergeEvent('feature', 1, 'dependency', 1)]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
            },
        });
        const featureUpdate = updateEvent(
            'feature',
            2,
            createCrdtUpdates(
                featureBase.doc,
                {
                    op: 'replace',
                    path: [{type: 'key', key: 'count'}],
                    value: 2,
                    previous: 0,
                },
                timestamp('feature', 2),
            )[0],
        );

        const preview = buildMergePathPreview({
            app,
            branches: {
                main: branch('main', [mergeEvent('main', 1, 'dependency', 1)]),
                dependency: {
                    ...branch('dependency', [dependencyUpdate]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
                feature: {
                    ...branch('feature', [
                        mergeEvent('feature', 1, 'dependency', 1),
                        featureUpdate,
                    ]),
                    sourceBranchId: 'main',
                    forkEventIndex: 0,
                },
            },
            targetBranchId: 'main',
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 2,
            revertedPathKeys: new Set(),
            clock: hlc.init('preview', 0),
        });

        expect(preview.impact).toMatchObject({
            sourceUpdateCount: 2,
            effectiveUpdateCount: 1,
            alreadyMergedUpdateCount: 1,
            noEffectUpdateCount: 1,
            alreadyMerged: false,
        });
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

function mergeEvent(
    branchId: string,
    eventIndex: number,
    sourceBranchId: string,
    sourceThroughEventIndex: number,
): ServerBranchEvent {
    return {
        kind: 'merge',
        mergeId: `${branchId}-${sourceBranchId}-${eventIndex}`,
        docId: 'doc',
        branchId,
        eventIndex,
        sourceBranchId,
        sourceThroughEventIndex,
        actor: 'actor',
        createdAt: 'now',
    };
}

function timestamp(actor: string, logical: number) {
    return hlc.pack({ts: logical, count: 0, node: actor});
}
