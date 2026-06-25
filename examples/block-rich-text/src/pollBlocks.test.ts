import {describe, expect, it} from 'vitest';
import type {PollMeta} from './blockMeta';
import {mergePollMeta, singleChoiceResults} from './pollBlocks';

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
});
