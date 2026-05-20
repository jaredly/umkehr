import {describe, expect, it} from 'vitest';
import {compareTimestamps} from './clock.js';
import {pack, tryUnpack, unpack, withSuffix, withoutSuffix} from './hlc.js';

describe('HLC timestamp suffixes', () => {
    it('packs and unpacks deterministic suffixes', () => {
        const timestamp = pack({ts: 10, count: 2, node: 'actor:session', suffix: 'migration-1'});

        expect(timestamp).toBe('000000000000010:00002:actor:session~migration-1');
        expect(unpack(timestamp)).toEqual({
            ts: 10,
            count: 2,
            node: 'actor:session',
            suffix: 'migration-1',
        });
        expect(tryUnpack(timestamp)).toEqual(unpack(timestamp));
    });

    it('derives and removes suffixes from existing timestamps', () => {
        const base = pack({ts: 10, count: 2, node: 'actor'});
        const suffixed = withSuffix(base, 'migration.0001');

        expect(suffixed).toBe(`${base}~migration.0001`);
        expect(withoutSuffix(suffixed)).toBe(base);
    });

    it('orders suffixed timestamps next to their base timestamp', () => {
        const base = pack({ts: 10, count: 2, node: 'actor'});
        const first = withSuffix(base, 'migration-1');
        const second = withSuffix(base, 'migration-2');
        const next = pack({ts: 10, count: 3, node: 'actor'});

        expect(compareTimestamps(base, first)).toBeLessThan(0);
        expect(compareTimestamps(first, second)).toBeLessThan(0);
        expect(compareTimestamps(second, next)).toBeLessThan(0);
        expect([next, second, base, first].sort(compareTimestamps)).toEqual([
            base,
            first,
            second,
            next,
        ]);
    });

    it('rejects malformed suffixes', () => {
        const base = pack({ts: 10, count: 2, node: 'actor'});

        expect(() => withSuffix(base, 'bad suffix')).toThrow();
        expect(tryUnpack(`${base}~bad suffix`)).toBeNull();
    });
});
