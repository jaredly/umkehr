import {describe, expect, it} from 'vitest';
import type {PersistedServerBranch, ServerBranch, ServerUpdateEvent} from './types';
import {
    blockedBranchesForReview,
    hasOldPending,
    oldestPendingAt,
    pendingEventsForBranch,
    serverMoved,
} from './staleReview';

describe('stale server pending review helpers', () => {
    it('detects old pending events on branches whose server tip advanced', () => {
        const branch = testBranch({
            lastSeenEventIndex: 2,
            events: [testUpdate({eventIndex: 3, receivedAt: '2026-05-28T10:00:00.000Z'})],
        });
        const branchMeta = testBranchMeta({tipEventIndex: 4});

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
        const advanced = testBranchMeta({tipEventIndex: 4});
        const unchanged = testBranchMeta({tipEventIndex: 2});
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
});

function testBranch({
    lastSeenEventIndex,
    events,
}: {
    lastSeenEventIndex: number;
    events: ServerUpdateEvent[];
}): PersistedServerBranch<unknown> {
    return {
        branchId: 'main',
        history: null as never,
        lastSeenEventIndex,
        undoCheckpointEventIndex: 0,
        events,
        mirrored: true,
    };
}

function testBranchMeta({tipEventIndex}: {tipEventIndex: number}): ServerBranch {
    return {
        docId: 'doc',
        branchId: 'main',
        name: 'main',
        tipEventIndex,
        createdAt: '2026-05-28T09:00:00.000Z',
        updatedAt: '2026-05-28T10:00:00.000Z',
    };
}

function testUpdate({
    eventIndex,
    receivedAt,
}: {
    eventIndex: number;
    receivedAt: string;
}): ServerUpdateEvent {
    return {
        kind: 'update',
        docId: 'doc',
        branchId: 'main',
        eventIndex,
        origin: 'user:session',
        hlcTimestamp: `${receivedAt}:0:user`,
        receivedAt,
        update: {
            op: 'set',
            path: [],
            value: {},
            ts: `${receivedAt}:0:user`,
        },
        recorded: false,
    };
}
