import {describe, expect, it} from 'vitest';
import {
    buildMergeImpact,
    materializeBranch,
    mergeSourceUpdatesForBranchThrough,
    mergedSourceCoverage,
    type BranchAdapter,
    type BranchEvent,
    type PersistedBranch,
} from './index';

type History = {
    value: string;
    applied: string[];
};

type Update = {
    append: string;
};

const adapter: BranchAdapter<History, Update> = {
    createInitialHistory: () => ({value: '', applied: []}),
    applyUpdate: (history, update, options) => ({
        value: `${history.value}${update.append}`,
        applied: options.recordHistory ? [...history.applied, update.append] : history.applied,
    }),
    sameContents: (left, right) => left.value === right.value,
};

describe('branch materialization', () => {
    it('replays update events in event index order', () => {
        const history = materializeBranch({
            adapter,
            branchId: 'main',
            branches: {
                main: branch('main', [update('main', 2, 'b'), update('main', 1, 'a')]),
            },
        });

        expect(history.value).toBe('ab');
        expect(history.applied).toEqual(['a', 'b']);
    });

    it('replays a branch from its source fork point', () => {
        const history = materializeBranch({
            adapter,
            branchId: 'feature',
            branches: {
                main: branch('main', [
                    update('main', 1, 'a'),
                    update('main', 2, 'b'),
                    update('main', 3, 'c'),
                ]),
                feature: branch('feature', [update('feature', 1, 'x')], {
                    sourceBranchId: 'main',
                    forkEventIndex: 2,
                }),
            },
        });

        expect(history.value).toBe('abx');
    });

    it('replays merge events by applying source updates through the selected event index', () => {
        const history = materializeBranch({
            adapter,
            branchId: 'main',
            branches: {
                main: branch('main', [update('main', 1, 'a'), merge('main', 2, 'feature', 1)]),
                feature: branch('feature', [update('feature', 1, 'x'), update('feature', 2, 'y')], {
                    sourceBranchId: 'main',
                    forkEventIndex: 1,
                }),
            },
        });

        expect(history.value).toBe('ax');
        expect(history.applied).toEqual(['a']);
    });

    it('applies duplicate update event ids once across recursive merges', () => {
        const duplicate = update('feature', 1, 'x', {eventId: 'same'});
        const history = materializeBranch({
            adapter,
            branchId: 'main',
            branches: {
                main: branch('main', [
                    update('main', 1, 'a'),
                    {...duplicate, branchId: 'main', eventIndex: 2},
                    merge('main', 3, 'feature', 1),
                ]),
                feature: branch('feature', [duplicate], {
                    sourceBranchId: 'main',
                    forkEventIndex: 1,
                }),
            },
        });

        expect(history.value).toBe('ax');
        expect(history.applied).toEqual(['a', 'x']);
    });
});

describe('branch merge helpers', () => {
    it('collects source updates through recursive merge events', () => {
        const branches = {
            main: branch('main', []),
            feature: branch('feature', [
                update('feature', 1, 'x'),
                merge('feature', 2, 'nested', 1),
                update('feature', 3, 'y'),
            ]),
            nested: branch('nested', [update('nested', 1, 'n')]),
        };

        expect(mergeSourceUpdatesForBranchThrough(branches, 'feature', 2)).toEqual([
            {append: 'x'},
            {append: 'n'},
        ]);
    });

    it('tracks merged source coverage recursively', () => {
        const branches = {
            main: branch('main', [merge('main', 1, 'feature', 2)]),
            feature: branch('feature', [merge('feature', 1, 'nested', 3)]),
            nested: branch('nested', []),
        };

        expect([...mergedSourceCoverage(branches, 'main').entries()]).toEqual([
            ['feature', 2],
            ['nested', 3],
        ]);
    });

    it('reports already merged and no-effect source updates', () => {
        const branches = {
            main: branch('main', [update('main', 1, 'x'), merge('main', 2, 'feature', 1)]),
            feature: branch('feature', [update('feature', 1, 'x')]),
        };
        const before = materializeBranch({adapter, branches, branchId: 'main'});

        const impact = buildMergeImpact({
            adapter,
            branches,
            before,
            targetBranchId: 'main',
            sourceBranchId: 'feature',
            sourceThroughEventIndex: 1,
        });

        expect(impact).toEqual({
            sourceUpdateCount: 1,
            effectiveUpdateCount: 1,
            alreadyMergedUpdateCount: 1,
            noEffectUpdateCount: 0,
            alreadyMerged: true,
            alreadyMergedThroughEventIndex: 1,
        });
    });
});

function branch(
    branchId: string,
    events: BranchEvent<Update>[],
    options: Partial<PersistedBranch<History, Update>> = {},
): PersistedBranch<History, Update> {
    return {
        branchId,
        history: {value: '', applied: []},
        lastSeenEventIndex: 0,
        events,
        ...options,
    };
}

function update(
    branchId: string,
    eventIndex: number,
    append: string,
    options: {eventId?: string} = {},
): BranchEvent<Update> {
    return {
        kind: 'update',
        branchId,
        eventIndex,
        eventId: options.eventId ?? `${branchId}-${eventIndex}`,
        update: {append},
    };
}

function merge(
    branchId: string,
    eventIndex: number,
    sourceBranchId: string,
    sourceThroughEventIndex: number,
): BranchEvent<Update> {
    return {
        kind: 'merge',
        branchId,
        eventIndex,
        mergeId: `${branchId}-${eventIndex}`,
        sourceBranchId,
        sourceThroughEventIndex,
    };
}
