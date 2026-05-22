export function databasePathFromArgs(argv: string[]) {
    const dbIndex = argv.indexOf('--db');
    if (dbIndex === -1) return 'server-sync.sqlite';
    const path = argv[dbIndex + 1]?.trim();
    if (!path) throw new Error('--db requires a database path.');
    return path;
}
