export function databasePathFromArgs(argv: string[]) {
    const dbIndex = argv.indexOf('--db');
    if (dbIndex === -1) return 'server-sync.sqlite';
    const path = argv[dbIndex + 1]?.trim();
    if (!path) throw new Error('--db requires a database path.');
    return path;
}

export function serverPortFromArgs(argv: string[]) {
    const port = optionalNumberArg(argv, '--port') ?? optionalNumberEnv('UMKEHR_SERVER_PORT');
    return port ?? 8787;
}

export function migrationLockMsFromArgs(argv: string[]) {
    return (
        optionalNumberArg(argv, '--migration-lock-ms') ??
        optionalNumberEnv('UMKEHR_MIGRATION_LOCK_MS') ??
        60_000
    );
}

function optionalNumberArg(argv: string[], name: string) {
    const index = argv.indexOf(name);
    if (index === -1) return undefined;
    const raw = argv[index + 1]?.trim();
    if (!raw) throw new Error(`${name} requires a value.`);
    return parsePositiveInteger(raw, name);
}

function optionalNumberEnv(name: string) {
    const raw = Bun.env[name]?.trim();
    if (!raw) return undefined;
    return parsePositiveInteger(raw, name);
}

function parsePositiveInteger(raw: string, name: string) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
    return value;
}
