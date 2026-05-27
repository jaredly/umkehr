import {expect, type TestInfo} from '@playwright/test';
import {execFile, spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const testDir = path.dirname(fileURLToPath(import.meta.url));
const reactCrdtDir = path.resolve(testDir, '../..');
const serverDir = path.resolve(reactCrdtDir, '../react-crdt-server');

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
    await execFileAsync('bun', ['run', 'seed:test', '--', '--db', dbPath, '--date', date, '--size', size], {
        cwd: serverDir,
        maxBuffer: 1024 * 1024 * 10,
    });
}

export async function inspectServerDocument(dbPath: string, docId: string) {
    const {stdout} = await execFileAsync(
        'bun',
        ['--bun', 'src/inspectTest.ts', '--db', dbPath, '--doc', docId],
        {cwd: serverDir, maxBuffer: 1024 * 1024 * 10},
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
        'bun',
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
        {cwd: serverDir, maxBuffer: 1024 * 1024 * 10},
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
    const child = spawn('bun', [
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
