import {expect, type TestInfo} from '@playwright/test';
import {execFile, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const testDir = path.dirname(fileURLToPath(import.meta.url));
const reactCrdtDir = path.resolve(testDir, '../..');
const serverDir = path.resolve(reactCrdtDir, '../react-crdt-server');
const bunPath = resolveBunPath();
const bunEnv = envWithBunOnPath(bunPath);

export const E2E_SERVER_PORT = Number(process.env.UMKEHR_E2E_SERVER_PORT ?? 8788);
export const E2E_SERVER_URL = `http://localhost:${E2E_SERVER_PORT}`;

export async function createTempServerDbPath(testInfo: TestInfo) {
    const dir = testInfo.outputPath('server-db');
    await mkdir(dir, {recursive: true});
    return path.join(dir, 'server-sync.sqlite');
}

export async function seedServerDatabase({
    dbPath,
    date = '2026-01-02',
    size = 'small',
}: {
    dbPath: string;
    date?: string;
    size?: 'small' | 'default' | 'large';
}) {
    await execFileAsync(bunPath, ['--bun', 'src/seedTest.ts', '--db', dbPath, '--date', date, '--size', size], {
        cwd: serverDir,
        env: bunEnv,
        maxBuffer: 1024 * 1024 * 10,
    });
}

export async function inspectServerDocument(dbPath: string, docId: string) {
    const {stdout} = await execFileAsync(
        bunPath,
        ['--bun', 'src/inspectTest.ts', '--db', dbPath, '--doc', docId],
        {cwd: serverDir, env: bunEnv, maxBuffer: 1024 * 1024 * 10},
    );
    return JSON.parse(stdout) as {
        document: null | {
            appId: string;
            schemaVersion: number;
            schemaFingerprint: string;
            schemaFingerprintHash: string;
        };
        archivedSchemaHashes: string[];
        branches: {branchId: string; tipEventIndex: number}[];
        eventCount: number;
        activeMigrationLock: null | {docId: string; ownerActor: string};
    };
}

export async function waitForServerDocument(
    dbPath: string,
    docId: string,
    predicate: (document: Awaited<ReturnType<typeof inspectServerDocument>>) => boolean,
) {
    const deadline = Date.now() + 10_000;
    let inspected = await inspectServerDocument(dbPath, docId);
    while (Date.now() < deadline) {
        if (predicate(inspected)) return inspected;
        await new Promise((resolve) => setTimeout(resolve, 100));
        inspected = await inspectServerDocument(dbPath, docId);
    }
    expect(predicate(inspected), `server document ${docId} reached expected state`).toBe(true);
    return inspected;
}

export async function createMigrationLock({
    dbPath,
    docId,
    ownerActor = 'seed-user-ada:e2e-migration-owner',
    targetSchemaVersion,
    targetSchemaFingerprint,
    targetSchemaFingerprintHash,
}: {
    dbPath: string;
    docId: string;
    ownerActor?: string;
    targetSchemaVersion: number;
    targetSchemaFingerprint: string;
    targetSchemaFingerprintHash: string;
}) {
    await execFileAsync(
        bunPath,
        [
            '--bun',
            'src/lockTest.ts',
            '--db',
            dbPath,
            '--doc',
            docId,
            '--owner-actor',
            ownerActor,
            '--target-version',
            String(targetSchemaVersion),
            '--target-fingerprint',
            targetSchemaFingerprint,
            '--target-fingerprint-hash',
            targetSchemaFingerprintHash,
        ],
        {cwd: serverDir, env: bunEnv, maxBuffer: 1024 * 1024 * 10},
    );
}

export async function startServer({
    dbPath,
    port = E2E_SERVER_PORT,
    migrationLockMs = 1_000,
}: {
    dbPath: string;
    port?: number;
    migrationLockMs?: number;
}) {
    const child = spawn(bunPath, [
        '--bun',
        'src/index.ts',
        '--db',
        dbPath,
        '--port',
        String(port),
        '--migration-lock-ms',
        String(migrationLockMs),
    ], {
        cwd: serverDir,
        env: bunEnv,
        stdio: 'pipe',
    });

    try {
        await waitForHealth(`http://localhost:${port}/health`);
    } catch (error) {
        child.kill();
        throw error;
    }

    return {
        url: `http://localhost:${port}`,
        async stop() {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.kill();
            await new Promise((resolve) => child.once('exit', resolve));
        },
    };
}

async function waitForHealth(url: string) {
    const deadline = Date.now() + 10_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(lastError, `server became healthy at ${url}`).toBeUndefined();
}

function resolveBunPath() {
    if (process.env.BUN_BIN) return process.env.BUN_BIN;
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) continue;
        const candidate = path.join(dir, 'bun');
        if (existsSync(candidate)) return candidate;
    }
    const defaultInstall = path.join(homedir(), '.bun/bin/bun');
    if (existsSync(defaultInstall)) return defaultInstall;
    return 'bun';
}

function envWithBunOnPath(binary: string) {
    const env = {...process.env};
    if (path.basename(binary) !== binary) {
        env.PATH = `${path.dirname(binary)}${path.delimiter}${env.PATH ?? ''}`;
    }
    return env;
}
