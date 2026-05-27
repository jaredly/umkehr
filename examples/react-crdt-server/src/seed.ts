import {readFileSync} from 'node:fs';
import {ServerStore} from './store';
import type {SeedDatabasePayload} from './types';

const args = parseArgs(Bun.argv);
const raw = args.inputPath ? readFileSync(args.inputPath, 'utf8') : await stdinText();
const payload = parseSeedPayload(raw);

const store = new ServerStore(args.dbPath);
store.importSeedDatabase(payload);

console.log(
    `Imported ${payload.documents.length} documents and ${payload.users.length} users into ${args.dbPath}.`,
);

function parseArgs(argv: string[]) {
    let dbPath = 'test-server-sync.sqlite';
    let inputPath: string | undefined;
    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        switch (arg) {
            case '--db': {
                dbPath = requiredValue(argv, ++index, '--db');
                break;
            }
            case '--input': {
                inputPath = requiredValue(argv, ++index, '--input');
                break;
            }
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return {dbPath, inputPath};
}

function requiredValue(argv: string[], index: number, name: string) {
    const value = argv[index]?.trim();
    if (!value) throw new Error(`${name} requires a value.`);
    return value;
}

async function stdinText() {
    return await new Response(Bun.stdin.stream()).text();
}

function parseSeedPayload(raw: string): SeedDatabasePayload {
    if (!raw.trim()) throw new Error('Seed importer expected JSON on stdin or via --input.');
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
