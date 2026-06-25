import {describe, expect, it} from 'vitest';
import type {PollMeta} from './blockMeta';
import {choiceResults, matrixPollResults, mergePollMeta, singleChoiceResults, votedOptionIds} from './pollBlocks';

describe('pollBlocks', () => {
    it('merges votes by user timestamp even when incoming poll meta is stale', () => {
        const current: PollMeta = {
            type: 'poll',
            kind: 'rating',
            allowChange: true,
            min: 1,
            max: 5,
            votes: {ulrich: {type: 'single', optionId: '5', ts: '00004'}},
            ts: '00005',
        };
        const incoming: PollMeta = {
            type: 'poll',
            kind: 'rating',
            allowChange: true,
            min: 1,
            max: 5,
            votes: {uwe: {type: 'single', optionId: '4', ts: '00003'}},
            ts: '00002',
        };

        expect(mergePollMeta(current, incoming)).toEqual({
            ...current,
            votes: {
                ulrich: {type: 'single', optionId: '5', ts: '00004'},
                uwe: {type: 'single', optionId: '4', ts: '00003'},
            },
        });
    });

    it('derives single-choice result percentages from active votes', () => {
        const meta: PollMeta = {
            type: 'poll',
            kind: 'rating',
            allowChange: true,
            min: 1,
            max: 5,
            votes: {
                ulrich: {type: 'single', optionId: '5', ts: '00002'},
                uwe: {type: 'single', optionId: '4', ts: '00003'},
                old: {type: 'single', optionId: '1', ts: '00004', deleted: true},
            },
            ts: '00005',
        };

        expect(singleChoiceResults(meta, ['4', '5'])).toEqual([
            {optionId: '4', count: 1, percentage: 50},
            {optionId: '5', count: 1, percentage: 50},
        ]);
    });

    it('derives multiple-choice result percentages per voter', () => {
        const meta: PollMeta = {
            type: 'poll',
            kind: 'children',
            choiceMode: 'multiple',
            allowChange: true,
            votes: {
                ulrich: {type: 'multiple', optionIds: ['a', 'b'], ts: '00002'},
                uwe: {type: 'multiple', optionIds: ['b'], ts: '00003'},
            },
            ts: '00004',
        };

        expect(choiceResults(meta, ['a', 'b'])).toEqual([
            {optionId: 'a', count: 1, percentage: 50},
            {optionId: 'b', count: 2, percentage: 100},
        ]);
    });

    it('collects voted option ids for archived child answers', () => {
        const meta: PollMeta = {
            type: 'poll',
            kind: 'children',
            choiceMode: 'single',
            allowChange: true,
            votes: {
                ulrich: {type: 'single', optionId: 'archived', ts: '00002'},
                uwe: {type: 'multiple', optionIds: ['active', 'archived-2'], ts: '00003'},
                deleted: {type: 'single', optionId: 'ignored', ts: '00004', deleted: true},
            },
            ts: '00005',
        };

        expect(votedOptionIds(meta).sort()).toEqual(['active', 'archived', 'archived-2']);
    });

    it('derives matrix result percentages per row', () => {
        const meta: PollMeta = {
            type: 'poll',
            kind: 'matrix',
            choiceMode: 'multiple',
            allowChange: true,
            votes: {
                ulrich: {type: 'matrix', answers: {row1: ['a', 'b'], row2: 'a'}, ts: '00002'},
                uwe: {type: 'matrix', answers: {row1: ['b']}, ts: '00003'},
            },
            ts: '00004',
        };

        const results = matrixPollResults(meta, ['row1', 'row2'], ['a', 'b']);

        expect([...results.get('row1')!.values()]).toEqual([
            {optionId: 'a', count: 1, percentage: 50},
            {optionId: 'b', count: 2, percentage: 100},
        ]);
        expect([...results.get('row2')!.values()]).toEqual([
            {optionId: 'a', count: 1, percentage: 100},
            {optionId: 'b', count: 0, percentage: 0},
        ]);
    });
});
