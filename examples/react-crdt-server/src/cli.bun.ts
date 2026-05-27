import {describe, expect, it} from 'bun:test';
import {databasePathFromArgs, migrationLockMsFromArgs, serverPortFromArgs} from './cli';

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

    it('uses default runtime values when overrides are omitted', () => {
        expect(serverPortFromArgs(['bun', 'src/index.ts'])).toBe(8787);
        expect(migrationLockMsFromArgs(['bun', 'src/index.ts'])).toBe(60_000);
    });

    it('reads runtime overrides from argv', () => {
        const argv = [
            'bun',
            'src/index.ts',
            '--port',
            '8799',
            '--migration-lock-ms',
            '750',
        ];
        expect(serverPortFromArgs(argv)).toBe(8799);
        expect(migrationLockMsFromArgs(argv)).toBe(750);
    });

    it('rejects invalid numeric overrides', () => {
        expect(() => serverPortFromArgs(['bun', 'src/index.ts', '--port', '0'])).toThrow(
            '--port must be a positive integer.',
        );
        expect(() =>
            migrationLockMsFromArgs(['bun', 'src/index.ts', '--migration-lock-ms', 'soon']),
        ).toThrow('--migration-lock-ms must be a positive integer.');
    });
});
