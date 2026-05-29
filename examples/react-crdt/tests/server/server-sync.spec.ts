import {expect, test} from '@playwright/test';
import {
    addTodo,
    login,
    openServerDocument,
    waitForSynced,
} from '../helpers/app';
import {
    createTempServerDbPath,
    inspectServerDocument,
    seedServerDatabase,
    startServer,
} from '../helpers/server';

test('syncs edits between two logged-in server clients and shows presence', async ({
    browser,
}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        const title = `Server sync ${Date.now()}`;

        await openServerDocument(pageA, {docId: 'todos-small'});
        await login(pageA, 'Ada');
        await waitForSynced(pageA);

        await openServerDocument(pageB, {docId: 'todos-small'});
        await login(pageB, 'Ben');
        await waitForSynced(pageB);

        await expect(pageA.locator('.presenceRoster li[title="Ben"]')).toBeVisible();
        await expect(pageB.locator('.presenceRoster li[title="Ada"]')).toBeVisible();

        const before = await inspectServerDocument(dbPath, 'todos-small');
        await addTodo(pageA, title);
        await waitForSynced(pageA);
        await expect(pageB.locator('.todoTitle', {hasText: title})).toBeVisible();
        await waitForSynced(pageB);

        const after = await inspectServerDocument(dbPath, 'todos-small');
        expect(after.eventCount).toBeGreaterThan(before.eventCount);

        await contextB.close();
        await expect(pageA.getByText('No one else online')).toBeVisible();
        await contextA.close();
    } finally {
        await server.stop();
    }
});

test('logs out without deleting the local server replica', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});
    const title = `Logout local replica ${Date.now()}`;

    try {
        await openServerDocument(page, {docId: 'todos-small'});
        await login(page, 'Ada');
        await waitForSynced(page);
        await addTodo(page, title);
        await waitForSynced(page);

        await page.getByRole('button', {name: 'Log out'}).click();
        await expect(page.getByRole('heading', {name: 'Log in to server sync'})).toBeVisible();

        await login(page, 'Ada');
        await waitForSynced(page);
        await expect(page.locator('.todoTitle', {hasText: title})).toBeVisible();
    } finally {
        await server.stop();
    }
});
