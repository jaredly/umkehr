import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {
    expectLocalFirstStat,
    expectLocalFirstReplicaToContain,
    localFirstPeerId,
    openLocalFirst,
} from '../helpers/localFirst';
import {startPeerServer} from '../helpers/peer';
import {addTodoInPanel, todoPanel} from '../helpers/todos';

test('persists local-first documents, exposes role/invite controls, and resets local state', async ({
    page,
}, testInfo) => {
    const peerServer = await startPeerServer();
    const docId = uniqueTestDocId(testInfo, 'local-first-ui');
    const title = `Local-first persisted ${Date.now()}`;

    try {
        await openLocalFirst(page, docId);
        await expect(page.getByRole('heading', {name: 'Todos'})).toBeVisible();
        await expectLocalFirstStat(page, 'Document', docId);
        await expect(page.locator('#local-first-invite')).toHaveValue(/mode=local-first/);
        await expect(page.getByRole('button', {name: 'Host'})).toHaveClass(/active/);
        await localFirstPeerId(page);

        await addTodoInPanel(todoPanel(page, 'Todos'), title);
        await expectLocalFirstReplicaToContain(page, docId, title);
        await page.reload();
        await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
        await expect(todoPanel(page, 'Todos').locator('.todoTitle', {hasText: title})).toBeVisible();

        page.once('dialog', (dialog) => dialog.accept());
        await page.getByRole('button', {name: 'Reset local replica'}).click();
        await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
        await expect(todoPanel(page, 'Todos').locator('.todoTitle', {hasText: title})).toHaveCount(0);
    } finally {
        await peerServer.stop();
    }
});

test('blocks a second tab from opening the same local-first replica', async ({context}, testInfo) => {
    const docId = uniqueTestDocId(testInfo, 'tab-lock');
    const firstPage = await context.newPage();
    const secondPage = await context.newPage();

    await openLocalFirst(firstPage, docId);
    await openApp(secondPage, {mode: 'local-first', docId});

    await expect(secondPage.getByRole('heading', {name: 'Local replica unavailable'})).toBeVisible();
    await expect(secondPage.getByText('already open in another tab')).toBeVisible();

    await secondPage.close();
    await firstPage.close();
});
