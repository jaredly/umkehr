import {expect, test} from '@playwright/test';
import {
    addTodo,
    disconnectFromServer,
    expectUnsyncedEvents,
    login,
    openServerDocument,
    reconnectToServer,
    waitForSynced,
} from '../helpers/app';
import {
    createTempServerDbPath,
    inspectServerDocument,
    seedServerDatabase,
    startServer,
} from '../helpers/server';

test('keeps edits local while manually offline and flushes them on reconnect', async ({
    browser,
}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});
    const title = `Offline flush ${Date.now()}`;

    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        await openServerDocument(page, {docId: 'todos-small'});
        await login(page, 'Ada');
        await waitForSynced(page);

        const before = await inspectServerDocument(dbPath, 'todos-small');
        await disconnectFromServer(page);
        await addTodo(page, title);
        await expectUnsyncedEvents(page, 1);

        const whileOffline = await inspectServerDocument(dbPath, 'todos-small');
        expect(whileOffline.eventCount).toBe(before.eventCount);

        await reconnectToServer(page);
        await waitForSynced(page);
        const afterReconnect = await inspectServerDocument(dbPath, 'todos-small');
        expect(afterReconnect.eventCount).toBeGreaterThan(before.eventCount);

        const freshContext = await browser.newContext();
        const freshPage = await freshContext.newPage();
        await openServerDocument(freshPage, {docId: 'todos-small'});
        await login(freshPage, 'Ben');
        await waitForSynced(freshPage);
        await expect(freshPage.locator('.todoTitle', {hasText: title})).toBeVisible();

        await freshContext.close();
        await context.close();
    } finally {
        await server.stop();
    }
});
