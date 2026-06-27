import {describe, expect, it} from 'vitest';
import type {BranchAdapter, BranchEvent, PersistedBranch} from './index';
import {
    acceptStaleLocalChanges,
    blockedBranchesForReview,
    buildStaleMergeReview,
    discardStaleLocalChanges,
    forkStaleLocalChanges,
    hasOldPending,
    oldestPendingAt,
    pendingEventsForBranch,
    serverMoved,
} from './staleReview';

type History = string;
type Update = string;

const adapter: BranchAdapter<History, Update> = {
    createInitialHistory: () => '',
    applyUpdate: (history, update) => `${history}${update}`,
};

describe('generic stale review helpers', () => {
    it('detects old pending events on branches whose server tip advanced', () => {
        const branch = testBranch({
            lastSeenEventIndex: 2,
            events: [testUpdate({eventIndex: 3, receivedAt: '2026-05-28T10:00:00.000Z'})],
        });
        const branchMeta = {branchId: 'main', tipEventIndex: 4};

        expect(pendingEventsForBranch(branch)).toHaveLength(1);
        expect(oldestPendingAt(branch)).toBe('2026-05-28T10:00:00.000Z');
        expect(hasOldPending(branch, Date.parse('2026-05-28T10:06:00.000Z'), 300_000)).toBe(true);
        expect(serverMoved(branch, branchMeta)).toBe(true);
        expect(
            blockedBranchesForReview({
                branches: {main: branch},
                branchList: [branchMeta],
                policy: {kind: 'manual-review', thresholdMs: 300_000},
                now: Date.parse('2026-05-28T10:06:00.000Z'),
            }),
        ).toEqual([
            {
                sourceBranchId: 'main',
                baseEventIndex: 2,
                serverTipEventIndex: 4,
                pendingEventCount: 1,
                oldestPendingAt: '2026-05-28T10:00:00.000Z',
            },
        ]);
    });

    it('does not block auto-merge policy, young pending events, or unchanged server tips', () => {
        const branch = testBranch({
            lastSeenEventIndex: 2,
            events: [testUpdate({eventIndex: 3, receivedAt: '2026-05-28T10:04:00.000Z'})],
        });
        const advanced = {branchId: 'main', tipEventIndex: 4};
        const unchanged = {branchId: 'main', tipEventIndex: 2};
        const now = Date.parse('2026-05-28T10:06:00.000Z');

        expect(
            blockedBranchesForReview({
                branches: {main: branch},
                branchList: [advanced],
                policy: {kind: 'auto-merge'},
                now,
            }),
        ).toEqual([]);
        expect(
            blockedBranchesForReview({
                branches: {main: branch},
                branchList: [advanced],
                policy: {kind: 'manual-review', thresholdMs: 300_000},
                now,
            }),
        ).toEqual([]);
        expect(
            blockedBranchesForReview({
                branches: {main: branch},
                branchList: [unchanged],
                policy: {kind: 'manual-review', thresholdMs: 60_000},
                now,
            }),
        ).toEqual([]);
    });

    it('builds base, client, server, and result histories', () => {
        const review = buildStaleMergeReview({
            adapter,
            branches: {
                main: testBranch({
                    lastSeenEventIndex: 1,
                    events: [
                        testUpdate({eventIndex: 1, update: 'a', recorded: true}),
                        testUpdate({eventIndex: 2, update: 's', recorded: true}),
                        testUpdate({
                            eventIndex: 3,
                            update: 'p',
                            recorded: false,
                            receivedAt: '2026-05-28T10:00:00.000Z',
                        }),
                    ],
                }),
            },
            metadata: {
                sourceBranchId: 'main',
                baseEventIndex: 1,
                serverTipEventIndex: 2,
                pendingEventCount: 1,
                oldestPendingAt: '2026-05-28T10:00:00.000Z',
            },
        });

        expect(review).toMatchObject({
            baseHistory: 'a',
            clientHistory: 'ap',
            serverHistory: 'as',
            resultHistory: 'asp',
        });
    });

    it('accepts pending events by reindexing them after the server tip', () => {
        const branch = testBranch({
            lastSeenEventIndex: 1,
            events: [
                testUpdate({eventIndex: 1, update: 'a', recorded: true}),
                testUpdate({eventIndex: 2, update: 'p', recorded: false}),
            ],
        });

        const accepted = acceptStaleLocalChanges({
            branch,
            metadata: {
                sourceBranchId: 'main',
                baseEventIndex: 1,
                serverTipEventIndex: 5,
                pendingEventCount: 1,
                oldestPendingAt: '2026-05-28T10:00:00.000Z',
            },
        });

        expect(accepted.events.map((event) => [event.eventIndex, event.recorded])).toEqual([
            [1, true],
            [6, false],
        ]);
    });

    it('discards or forks stale pending events', () => {
        const branch = testBranch({
            lastSeenEventIndex: 1,
            events: [
                testUpdate({eventIndex: 1, update: 'a', recorded: true}),
                testUpdate({eventIndex: 2, update: 'p', recorded: false}),
            ],
        });

        expect(discardStaleLocalChanges(branch).events).toHaveLength(1);

        const forked = forkStaleLocalChanges({
            source: branch,
            forkBranchId: 'local-work',
            baseEventIndex: 1,
        });

        expect(forked.source.events).toHaveLength(1);
        expect(forked.fork).toMatchObject({
            branchId: 'local-work',
            sourceBranchId: 'main',
            forkEventIndex: 1,
            lastSeenEventIndex: 0,
        });
        expect(forked.fork.events).toMatchObject([
            {branchId: 'local-work', eventIndex: 1, recorded: false, update: 'p'},
        ]);
    });
});

function testBranch({
    lastSeenEventIndex,
    events,
}: {
    lastSeenEventIndex: number;
    events: BranchEvent<Update>[];
}): PersistedBranch<History, Update> {
    return {
        branchId: 'main',
        history: '',
        lastSeenEventIndex,
        events,
    };
}

function testUpdate({
    eventIndex,
    update = 'x',
    recorded = false,
    receivedAt = '2026-05-28T10:00:00.000Z',
}: {
    eventIndex: number;
    update?: Update;
    recorded?: boolean;
    receivedAt?: string;
}): BranchEvent<Update> {
    return {
        kind: 'update',
        branchId: 'main',
        eventIndex,
        eventId: `event-${eventIndex}`,
        receivedAt,
        update,
        recorded,
    };
}
