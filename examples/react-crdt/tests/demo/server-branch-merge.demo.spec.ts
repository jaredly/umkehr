import {expect, test} from '@playwright/test';
import {login, openServerDocument, waitForSynced} from '../helpers/app';
import {demoPause} from '../helpers/demo';
import {createTempServerDbPath, seedServerDatabase, startServer} from '../helpers/server';

test('demo: server branch merge previews and accepts selected paths', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});
    const branchName = `demo-${Date.now()}`;

    try {
        await openServerDocument(page, {docId: 'todos-small'});
        await login(page, 'Ada');
        await waitForSynced(page);

        await page.getByLabel('New branch name').fill(branchName);
        await page.getByRole('button', {name: 'Branch'}).click();
        await expect(page.getByTestId('server-branch-button').filter({hasText: branchName})).toBeVisible();
        await demoPause(page);

        await page.getByTestId('server-branch-button').filter({hasText: 'main'}).click();
        await page.getByRole('button', {name: 'Use #dcfce7'}).click();
        await waitForSynced(page);

        await page.getByTestId('server-branch-button').filter({hasText: branchName}).click();
        await page.getByRole('button', {name: 'Use #dbeafe'}).click();
        await waitForSynced(page);
        await demoPause(page);

        await page.getByTestId('server-branch-button').filter({hasText: 'main'}).click();
        await page.getByLabel('Merge source branch').selectOption({label: branchName});
        await expect(page.getByTestId('server-merge-panel')).toBeVisible();
        await expect(page.getByTestId('server-merge-path').first()).toBeVisible();

        await page.getByRole('button', {name: 'Revert all'}).click();
        await expect(page.getByText('Paths reverted')).toBeVisible();
        await page.getByRole('button', {name: 'Apply all'}).click();
        await demoPause(page);

        await page.getByRole('button', {name: 'Accept merge'}).click();
        await waitForSynced(page);
        await expect(page.getByRole('button', {name: 'Use #dbeafe'})).toHaveClass(/selected/);
        await expect(page.getByTestId('server-timeline-event').filter({hasText: /merge/}).last()).toBeVisible();
    } finally {
        await server.stop();
    }
});
