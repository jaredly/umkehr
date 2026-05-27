import {fileURLToPath} from 'node:url';
import {ServerStore} from './store';
import type {SeedDatabasePayload} from './types';

const {dbPath, generatorArgs} = parseArgs(Bun.argv);
const clientDir = fileURLToPath(new URL('../../react-crdt', import.meta.url));
const generator = Bun.spawn({
    cmd: ['bun', 'run', 'seed:server', '--', ...generatorArgs],
    cwd: clientDir,
    stdout: 'pipe',
    stderr: 'inherit',
});
const raw = await new Response(generator.stdout).text();
const exitCode = await generator.exited;
if (exitCode !== 0) process.exit(exitCode);

const payload = parseSeedPayload(raw);
const store = new ServerStore(dbPath);
store.importSeedDatabase(payload);

console.log(
    `Imported ${payload.documents.length} documents and ${payload.users.length} users into ${dbPath}.`,
);

function parseArgs(argv: string[]) {
    let dbPath = 'test-server-sync.sqlite';
    const generatorArgs: string[] = [];
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--db') {
            dbPath = requiredValue(argv, ++index, '--db');
        } else {
            generatorArgs.push(arg);
        }
    }
    return {dbPath, generatorArgs};
}

function requiredValue(argv: string[], index: number, name: string) {
    const value = argv[index]?.trim();
    if (!value) throw new Error(`${name} requires a value.`);
    return value;
}

function parseSeedPayload(raw: string): SeedDatabasePayload {
    if (!raw.trim()) throw new Error('Client seed generator returned empty output.');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) throw new Error('Seed payload must be a JSON object.');
    if (typeof parsed.generatedAt !== 'string') throw new Error('Seed payload generatedAt is required.');
    if (!Array.isArray(parsed.users)) throw new Error('Seed payload users must be an array.');
    if (!Array.isArray(parsed.documents)) {
        throw new Error('Seed payload documents must be an array.');
    }
    return parsed as SeedDatabasePayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
