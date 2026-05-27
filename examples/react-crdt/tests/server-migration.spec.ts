import {expect, test} from '@playwright/test';
import {
    addTodo,
    editTodo,
    expectServerNotice,
    expectTodoVisible,
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
            docId: 'todos-migration-v1-main',
        });
        await login(page, 'Ada');

        await waitForSynced(page);
        await expectTodoVisible(page, 'Try CRDT sync');

        const inspected = await inspectServerDocument(dbPath, 'todos-migration-v1-main');
        expect(inspected.document?.schemaFingerprintHash).toBe(todoFixtureV2FingerprintHash);
        expect(inspected.archivedSchemaHashes).toContain(todoFixtureV1FingerprintHash);
        expect(inspected.activeMigrationLock).toBeNull();
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
            docId: 'todos-migration-v1-main',
        });
        await login(page, 'Ben');

        await expectServerNotice(page, /Document migration is in progress/);
        const before = await inspectServerDocument(dbPath, 'todos-migration-v1-main');
        await editTodo(page, 'Write README', 'Local edit while migration runs');
        await expect(page.getByRole('img', {name: /1 unsynced local event/})).toBeVisible({
            timeout: 10_000,
        });
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
            docId: 'todos-migration-v3-ahead',
        });
        await login(page, 'Ada');

        await expectServerNotice(page, /Update your app to sync with the server/);
        const inspected = await inspectServerDocument(dbPath, 'todos-migration-v3-ahead');
        expect(inspected.document?.schemaVersion).toBe(3);
        expect(inspected.document?.schemaFingerprintHash).toBe(todoFixtureV3FingerprintHash);
        expect(inspected.activeMigrationLock).toBeNull();
    } finally {
        await server.stop();
    }
});
