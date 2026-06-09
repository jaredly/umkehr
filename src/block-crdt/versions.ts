import {compareLamports} from './ids';
import {compareLseqIds} from './lseq';
import {Block, Char} from './types';

export const compareCharParentVersions = (
    one: Char['parent']['ts'],
    two: Char['parent']['ts'],
): number => {
    if (typeof one === 'string') {
        if (typeof two === 'string') {
            return one.localeCompare(two);
        }
        return one === two[0] ? -1 : one.localeCompare(two[0]);
    }
    if (typeof two === 'string') {
        return one[0] === two ? 1 : one[0].localeCompare(two);
    }
    if (one[0] !== two[0]) return one[0].localeCompare(two[0]);
    for (let i = 0; i < one[1].length && i < two[1].length; i++) {
        const compared = compareLamports(one[1][i], two[1][i]);
        if (compared !== 0) {
            return compared;
        }
    }
    if (one[1].length !== two[1].length) return one[1].length - two[1].length;
    return one[2].localeCompare(two[2]);
};

export const charParentVersionWins = (
    incoming: Char['parent']['ts'],
    current: Char['parent']['ts'],
) => compareCharParentVersions(incoming, current) > 0;

export const compareBlockOrderVersions = (
    one: Block['order']['ts'],
    two: Block['order']['ts'],
): number => {
    if (typeof one === 'string') {
        if (typeof two === 'string') {
            return one.localeCompare(two);
        }
        return one === two[0] ? -1 : one.localeCompare(two[0]);
    }
    if (typeof two === 'string') {
        return one[0] === two ? 1 : one[0].localeCompare(two);
    }
    if (one[0] !== two[0]) return one[0].localeCompare(two[0]);
    const compared = compareLseqIds(one[1], two[1]);
    if (compared !== 0) return compared;
    return one[2].localeCompare(two[2]);
};

export const blockOrderVersionWins = (
    incoming: Block['order']['ts'],
    current: Block['order']['ts'],
) => compareBlockOrderVersions(incoming, current) > 0;
