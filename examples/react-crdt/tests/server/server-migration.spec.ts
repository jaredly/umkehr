import {expect, test} from '@playwright/test';
import {
    addTodo,
    agePendingServerEvents,
    clickMigrateDocument,
    disconnectFromServer,
    editTodo,
    expectClientUpgradeRequired,
    expectMigrationRequired,
    expectMigrationRunning,
    expectStaleMergeReviewRequired,
    expectTodoVisible,
    expectUnsyncedEvents,
    login,
    openServerDocument,
    reconnectToServer,
    waitForSynced,
} from '../helpers/app';
import {
    createTempServerDbPath,
    createMigrationLock,
    inspectServerDocument,
    seedServerDatabase,
    startServer,
    waitForServerDocument,
} from '../helpers/server';
import {
    todoFixtureV1FingerprintHash,
    todoFixtureV2Fingerprint,
    todoFixtureV2FingerprintHash,
    todoFixtureV3FingerprintHash,
} from '../../../migration-fixtures/todos';

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

test('reviews old pending local edits before completing stale server merge', async ({
    browser,
}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});
    const docId = 'todos-small';

    try {
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        const localTitle = `Complete local ${Date.now()}`;
        const serverTitle = `Complete server ${Date.now()}`;

        await createOldPendingAndMovedServer({
            pageA,
            pageB,
            docId,
            localTitle,
            serverTitle,
        });
        const beforeReconnect = await inspectServerDocument(dbPath, docId);

        await pageA.reload();
        await expectStaleMergeReviewRequired(pageA);
        const afterReview = await inspectServerDocument(dbPath, docId);
        expect(afterReview.eventCount).toBe(beforeReconnect.eventCount);

        await pageA.getByRole('button', {name: 'Complete merge'}).click();
        await waitForSynced(pageA);
        await expectTodoVisible(pageB, localTitle);
        await expectTodoVisible(pageB, serverTitle);

        const afterComplete = await inspectServerDocument(dbPath, docId);
        expect(afterComplete.eventCount).toBeGreaterThan(beforeReconnect.eventCount);

        await contextA.close();
        await contextB.close();
    } finally {
        await server.stop();
    }
});

test('reviews old pending local edits before forking stale changes', async ({
    browser,
}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});
    const docId = 'todos-small';

    try {
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        const localTitle = `Fork local ${Date.now()}`;
        const serverTitle = `Fork server ${Date.now()}`;
        const forkName = `main/sync-review-e2e-${Date.now()}`;

        await createOldPendingAndMovedServer({
            pageA,
            pageB,
            docId,
            localTitle,
            serverTitle,
        });
        const beforeReconnect = await inspectServerDocument(dbPath, docId);

        await pageA.reload();
        await expectStaleMergeReviewRequired(pageA);
        const afterReview = await inspectServerDocument(dbPath, docId);
        expect(afterReview.eventCount).toBe(beforeReconnect.eventCount);

        await pageA.getByLabel('Fork branch name').fill(forkName);
        await pageA.getByRole('button', {name: 'Fork local changes'}).click();
        await waitForSynced(pageA);
        await expect(pageA.getByRole('button', {name: forkName})).toBeVisible();
        await expectTodoVisible(pageA, localTitle);

        const afterFork = await inspectServerDocument(dbPath, docId);
        expect(afterFork.branches.length).toBeGreaterThan(beforeReconnect.branches.length);
        expect(afterFork.eventCount).toBeGreaterThan(beforeReconnect.eventCount);

        await contextA.close();
        await contextB.close();
    } finally {
        await server.stop();
    }
});

test('reviews old pending local edits before discarding stale changes', async ({
    browser,
}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});
    const docId = 'todos-small';

    try {
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        const localTitle = `Discard local ${Date.now()}`;
        const serverTitle = `Discard server ${Date.now()}`;

        await createOldPendingAndMovedServer({
            pageA,
            pageB,
            docId,
            localTitle,
            serverTitle,
        });
        const beforeReconnect = await inspectServerDocument(dbPath, docId);

        await pageA.reload();
        await expectStaleMergeReviewRequired(pageA);
        const afterReview = await inspectServerDocument(dbPath, docId);
        expect(afterReview.eventCount).toBe(beforeReconnect.eventCount);

        await pageA.getByRole('button', {name: 'Discard local changes'}).click();
        await waitForSynced(pageA);
        await expectTodoVisible(pageA, serverTitle);
        await expect(pageA.locator('.todoTitle', {hasText: localTitle})).toHaveCount(0);

        const afterDiscard = await inspectServerDocument(dbPath, docId);
        expect(afterDiscard.eventCount).toBe(beforeReconnect.eventCount);

        await contextA.close();
        await contextB.close();
    } finally {
        await server.stop();
    }
});

test('migrates the seeded v1 todos document through the browser and server', async ({
    page,
}, testInfo) => {
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

async function createOldPendingAndMovedServer({
    pageA,
    pageB,
    docId,
    localTitle,
    serverTitle,
}: {
    pageA: import('@playwright/test').Page;
    pageB: import('@playwright/test').Page;
    docId: string;
    localTitle: string;
    serverTitle: string;
}) {
    await openServerDocument(pageA, {docId});
    await login(pageA, 'Ada');
    await waitForSynced(pageA);

    await disconnectFromServer(pageA);
    await addTodo(pageA, localTitle);
    await expectUnsyncedEvents(pageA, 1);
    await agePendingServerEvents(pageA, docId, '2026-01-02T00:00:00.000Z');

    await openServerDocument(pageB, {docId});
    await login(pageB, 'Ben');
    await waitForSynced(pageB);
    await addTodo(pageB, serverTitle);
    await waitForSynced(pageB);
}

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

test('keeps local edits pending while another client owns the migration lock', async ({
    page,
}, testInfo) => {
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

test('flushes pending edits after an expired migration lock is resolved', async ({
    browser,
}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    await createMigrationLock({
        dbPath,
        docId: 'todos-migration-v1-main',
        targetSchemaVersion: 2,
        targetSchemaFingerprint: todoFixtureV2Fingerprint,
        targetSchemaFingerprintHash: todoFixtureV2FingerprintHash,
    });
    const server = await startServer({dbPath, migrationLockMs: 5_000});

    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const pendingTitle = `Pending edit after lock expiry ${Date.now()}`;

        await openServerDocument(page, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
        });
        await login(page, 'Ben');

        await expectMigrationRunning(page);
        const before = await inspectServerDocument(dbPath, 'todos-migration-v1-main');
        await editTodo(page, 'Write README', pendingTitle);
        await expectUnsyncedEvents(page, 1);
        await expectTodoVisible(page, pendingTitle);

        const afterLocalEdit = await inspectServerDocument(dbPath, 'todos-migration-v1-main');
        expect(afterLocalEdit.eventCount).toBe(before.eventCount);
        expect(afterLocalEdit.activeMigrationLock?.docId).toBe('todos-migration-v1-main');

        await page.waitForTimeout(5_250);
        await disconnectFromServer(page);
        await reconnectToServer(page);
        await expectMigrationRequired(page);

        await clickMigrateDocument(page);
        await waitForSynced(page);
        await expectTodoVisible(page, pendingTitle);

        const migrated = await waitForServerDocument(
            dbPath,
            'todos-migration-v1-main',
            (document) =>
                document.document?.schemaFingerprintHash === todoFixtureV2FingerprintHash &&
                document.activeMigrationLock === null,
        );
        expect(migrated.document?.schemaVersion).toBe(2);
        expect(migrated.eventCount).toBeGreaterThan(0);

        const freshContext = await browser.newContext();
        const freshPage = await freshContext.newPage();
        await openServerDocument(freshPage, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
        });
        await login(freshPage, 'Cy');
        await waitForSynced(freshPage);
        await expectTodoVisible(freshPage, pendingTitle);

        await freshContext.close();
        await context.close();
    } finally {
        await server.stop();
    }
});

test('shows a client upgrade notice for a seeded document ahead of the client', async ({
    page,
}, testInfo) => {
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
        const before = await inspectServerDocument(dbPath, 'todos-migration-v3-ahead');
        const localTitle = `Local v2 edit while upgrade required ${Date.now()}`;
        await addTodo(page, localTitle);
        await expectUnsyncedEvents(page, 1);
        await expectTodoVisible(page, localTitle);

        const after = await inspectServerDocument(dbPath, 'todos-migration-v3-ahead');
        expect(after.document?.schemaVersion).toBe(3);
        expect(after.document?.schemaFingerprintHash).toBe(todoFixtureV3FingerprintHash);
        expect(after.activeMigrationLock).toBeNull();
        expect(after.eventCount).toBe(before.eventCount);
    } finally {
        await server.stop();
    }
});

test('migrates the seeded v1 todos document with the v3 todos client', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        await openServerDocument(page, {
            appId: 'todos@3',
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
                document.document?.schemaFingerprintHash === todoFixtureV3FingerprintHash &&
                document.activeMigrationLock === null,
        );
        expect(inspected.document?.schemaVersion).toBe(3);
        expect(inspected.archivedSchemaHashes).toContain(todoFixtureV1FingerprintHash);
    } finally {
        await server.stop();
    }
});

test('recovers when the migration owner disconnects before upload', async ({browser}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath, migrationLockMs: 3_000});

    try {
        const ownerContext = await browser.newContext();
        const ownerPage = await ownerContext.newPage();
        await openServerDocument(ownerPage, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
            serverMigrationDelayMs: 10_000,
        });
        await login(ownerPage, 'Ben');
        await expectMigrationRequired(ownerPage);
        await clickMigrateDocument(ownerPage);

        const locked = await waitForServerDocument(
            dbPath,
            'todos-migration-v1-main',
            (document) => document.activeMigrationLock !== null,
        );
        expect(locked.activeMigrationLock?.docId).toBe('todos-migration-v1-main');
        await ownerContext.close();

        await new Promise((resolve) => setTimeout(resolve, 3_250));

        const recoveryContext = await browser.newContext();
        const recoveryPage = await recoveryContext.newPage();
        await openServerDocument(recoveryPage, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
        });
        await login(recoveryPage, 'Cy');

        await expectMigrationRequired(recoveryPage);
        await clickMigrateDocument(recoveryPage);
        await waitForSynced(recoveryPage);

        const migrated = await waitForServerDocument(
            dbPath,
            'todos-migration-v1-main',
            (document) =>
                document.document?.schemaFingerprintHash === todoFixtureV2FingerprintHash &&
                document.activeMigrationLock === null,
        );
        expect(migrated.document?.schemaVersion).toBe(2);

        await recoveryContext.close();
    } finally {
        await server.stop();
    }
});
