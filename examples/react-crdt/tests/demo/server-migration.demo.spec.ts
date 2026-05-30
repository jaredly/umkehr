import {expect, test} from '@playwright/test';
import {
    clickMigrateDocument,
    expectMigrationRequired,
    login,
    openServerDocument,
    waitForSynced,
} from '../helpers/app';
import {demoPause} from '../helpers/demo';
import {
    createTempServerDbPath,
    seedServerDatabase,
    startServer,
    waitForServerDocument,
} from '../helpers/server';
import {todoFixtureV2FingerprintHash} from '../../../migration-fixtures/todos';

test('demo: server document migration resumes syncing migrated content', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        await openServerDocument(page, {
            appId: 'todos',
            docId: 'todos-migration-v1-main',
        });
        await login(page, 'Ada');

        await expectMigrationRequired(page);
        await demoPause(page);

        await clickMigrateDocument(page);
        await waitForSynced(page);
        await expect(page.locator('.todoTitle', {hasText: 'Try CRDT sync'})).toBeVisible();

        const inspected = await waitForServerDocument(
            dbPath,
            'todos-migration-v1-main',
            (document) =>
                document.document?.schemaFingerprintHash === todoFixtureV2FingerprintHash &&
                document.activeMigrationLock === null,
        );
        expect(inspected.document?.schemaVersion).toBe(2);
    } finally {
        await server.stop();
    }
});
