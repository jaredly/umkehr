import type {FractionalIndex} from './types.js';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function fractionalIndexBetween(
    before?: FractionalIndex,
    after?: FractionalIndex,
): FractionalIndex {
    const a = before ?? '';
    const b = after;
    let prefix = '';
    for (let index = 0; ; index++) {
        const ai = index < a.length ? alphabet.indexOf(a[index]) : -1;
        const bi = b && index < b.length ? alphabet.indexOf(b[index]) : alphabet.length;
        if (ai < -1 || bi < 0) throw new Error('Invalid fractional index.');
        if (bi - ai > 1) return prefix + alphabet[Math.floor((ai + bi) / 2)];
        prefix += index < a.length ? a[index] : alphabet[0];
    }
}

export function compareStrings(a: string, b: string) {
    return a < b ? -1 : a > b ? 1 : 0;
}
