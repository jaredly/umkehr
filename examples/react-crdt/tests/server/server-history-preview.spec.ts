import {expect, test} from '@playwright/test';
import {addTodo, login, openServerDocument, waitForSynced} from '../helpers/app';
import {createTempServerDbPath, seedServerDatabase, startServer} from '../helpers/server';
import {todoPanel} from '../helpers/todos';

test('disables todo controls while server history preview is read-only', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        await openServerDocument(page, {docId: 'todos-small'});
        await login(page, 'Ada');
        await waitForSynced(page);

        await addTodo(page, 'Read-only smoke event');
        await waitForSynced(page);

        await page.locator('.serverTimeline button').last().click();
        await expect(page.getByText(/Previewing state after event/)).toBeVisible();

        const panel = todoPanel(page, 'Todos server client');
        await expect(panel.getByPlaceholder('New todo')).toBeDisabled();
        await expect(panel.getByRole('button', {name: 'Add'})).toBeDisabled();
        await expect(panel.getByRole('button', {name: 'Edit'}).first()).toBeDisabled();
        await expect(panel.getByRole('button', {name: 'Delete'}).first()).toBeDisabled();
        await expect(panel.getByRole('checkbox').first()).toBeDisabled();
        await expect(panel.getByRole('button', {name: /^Move /})).toHaveCount(0);
        await expect(panel.getByRole('button', {name: 'Use #fff'})).toBeDisabled();
    } finally {
        await server.stop();
    }
});
