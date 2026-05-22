import {describe, expect, it} from 'bun:test';
import {databasePathFromArgs} from './cli';

describe('server CLI helpers', () => {
    it('uses the default database path when --db is omitted', () => {
        expect(databasePathFromArgs(['bun', 'src/index.ts'])).toBe('server-sync.sqlite');
    });

    it('reads --db from argv', () => {
        expect(databasePathFromArgs(['bun', 'src/index.ts', '--db', 'test.sqlite'])).toBe(
            'test.sqlite',
        );
    });

    it('rejects --db without a value', () => {
        expect(() => databasePathFromArgs(['bun', 'src/index.ts', '--db'])).toThrow(
            '--db requires a database path.',
        );
    });
});
