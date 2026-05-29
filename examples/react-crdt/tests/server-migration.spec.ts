import {expect, test} from '@playwright/test';
import {
    addTodo,
    clickMigrateDocument,
    editTodo,
    expectClientUpgradeRequired,
    expectMigrationRequired,
    expectMigrationRunning,
    expectTodoVisible,
    expectUnsyncedEvents,
    login,
    openServerDocument,
    waitForSynced,
} from './helpers/app';
import {
    createTempServerDbPath,
    createMigrationLock,
    inspectServerDocument,
    seedServerDatabase,
    startServer,
    waitForServerDocument,
} from './helpers/server';
import {
    todoFixtureV1FingerprintHash,
    todoFixtureV2Fingerprint,
    todoFixtureV2FingerprintHash,
    todoFixtureV3FingerprintHash,
} from '../../migration-fixtures/todos';

test('syncs edits through a seeded server database', async ({browser}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        const title = `E2E synced todo ${Date.now()}`;

        await openServerDocument(pageA, {docId: 'todos-small'});
        await login(pageA, 'Ada');
        await waitForSynced(pageA);

        await openServerDocument(pageB, {docId: 'todos-small'});
        await login(pageB, 'Ben');
        await waitForSynced(pageB);

        const before = await inspectServerDocument(dbPath, 'todos-small');
        await addTodo(pageA, title);
        await waitForSynced(pageA);
        await expectTodoVisible(pageB, title);
        await waitForSynced(pageB);

        const after = await inspectServerDocument(dbPath, 'todos-small');
        expect(after.eventCount).toBeGreaterThan(before.eventCount);

        await contextA.close();
        await contextB.close();
    } finally {
        await server.stop();
    }
});

test('migrates the seeded v1 todos document through the browser and server', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        page.on('dialog', (dialog) => dialog.accept());
        await openServerDocument(page, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
        });
        await login(page, 'Ada');

        await expectMigrationRequired(page);
        await clickMigrateDocument(page);
        await waitForSynced(page);
        await expectTodoVisible(page, 'Try CRDT sync');

        const inspected = await waitForServerDocument(
            dbPath,
            'todos-migration-v1-main',
            (document) =>
                document.document?.schemaFingerprintHash === todoFixtureV2FingerprintHash &&
                document.activeMigrationLock === null,
        );
        expect(inspected.document?.schemaVersion).toBe(2);
        expect(inspected.document?.schemaFingerprintHash).toBe(todoFixtureV2FingerprintHash);
        expect(inspected.archivedSchemaHashes).toContain(todoFixtureV1FingerprintHash);
        expect(inspected.activeMigrationLock).toBeNull();
        expect(inspected.eventCount).toBeGreaterThan(0);
    } finally {
        await server.stop();
    }
});

test('blocks a v1 client from flushing local edits after a v2 client migrates the document', async ({
    browser,
}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath, migrationLockMs: 5_000});

    try {
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();

        await openServerDocument(pageA, {
            appId: 'todos@1',
            docId: 'todos-migration-v1-main',
        });
        await login(pageA, 'Ada');
        await waitForSynced(pageA);
        await expectTodoVisible(pageA, 'Try CRDT sync');

        await openServerDocument(pageB, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
            serverMigrationDelayMs: 1_000,
        });
        await login(pageB, 'Ben');
        await expectMigrationRequired(pageB);

        const migrationRunning = expectMigrationRunning(pageA);
        await clickMigrateDocument(pageB);
        await migrationRunning;
        await waitForSynced(pageB);
        await expectClientUpgradeRequired(pageA);

        const migrated = await waitForServerDocument(
            dbPath,
            'todos-migration-v1-main',
            (document) =>
                document.document?.schemaFingerprintHash === todoFixtureV2FingerprintHash &&
                document.activeMigrationLock === null,
        );
        expect(migrated.document?.schemaVersion).toBe(2);

        await editTodo(pageA, 'Try CRDT sync', 'V1 local edit after migration');
        await expectUnsyncedEvents(pageA, 1);
        await expectTodoVisible(pageA, 'V1 local edit after migration');

        const afterLocalEdit = await inspectServerDocument(dbPath, 'todos-migration-v1-main');
        expect(afterLocalEdit.eventCount).toBe(migrated.eventCount);
        expect(afterLocalEdit.document?.schemaFingerprintHash).toBe(todoFixtureV2FingerprintHash);
        expect(afterLocalEdit.activeMigrationLock).toBeNull();

        await contextA.close();
        await contextB.close();
    } finally {
        await server.stop();
    }
});

test('keeps local edits pending while another client owns the migration lock', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    await createMigrationLock({
        dbPath,
        docId: 'todos-migration-v1-main',
        targetSchemaVersion: 2,
        targetSchemaFingerprint: todoFixtureV2Fingerprint,
        targetSchemaFingerprintHash: todoFixtureV2FingerprintHash,
    });
    const server = await startServer({dbPath, migrationLockMs: 60_000});

    try {
        await openServerDocument(page, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
        });
        await login(page, 'Ben');

        await expectMigrationRunning(page);
        const before = await inspectServerDocument(dbPath, 'todos-migration-v1-main');
        await editTodo(page, 'Write README', 'Local edit while migration runs');
        await expectUnsyncedEvents(page, 1);
        await expectTodoVisible(page, 'Local edit while migration runs');

        const after = await inspectServerDocument(dbPath, 'todos-migration-v1-main');
        expect(after.eventCount).toBe(before.eventCount);
        expect(after.activeMigrationLock?.docId).toBe('todos-migration-v1-main');
    } finally {
        await server.stop();
    }
});

test('shows a client upgrade notice for a seeded document ahead of the client', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        await openServerDocument(page, {
            appId: 'todos',
            docId: 'todos-migration-v3-ahead',
        });
        await login(page, 'Ada');

        await expectClientUpgradeRequired(page);
        const inspected = await inspectServerDocument(dbPath, 'todos-migration-v3-ahead');
        expect(inspected.document?.schemaVersion).toBe(3);
        expect(inspected.document?.schemaFingerprintHash).toBe(todoFixtureV3FingerprintHash);
        expect(inspected.activeMigrationLock).toBeNull();
    } finally {
        await server.stop();
    }
});
