import {expect, test} from '@playwright/test';
import {uniqueTestDocId} from '../helpers/app';
import {
    connectLocalFirstClient,
    expectLocalFirstConnectionOpen,
    expectLocalFirstStat,
    localFirstPeerId,
    openLocalFirst,
} from '../helpers/localFirst';
import {startPeerServer} from '../helpers/peer';
import {addTodoInPanel, todoPanel} from '../helpers/todos';

test('syncs local-first edits through local PeerServer and compacts retained log', async ({
    browser,
}, testInfo) => {
    const peerServer = await startPeerServer();
    const docId = uniqueTestDocId(testInfo, 'local-first-sync');
    const hostTitle = `Local-first host ${Date.now()}`;
    const clientTitle = `Local-first client ${Date.now()}`;

    try {
        const hostContext = await browser.newContext();
        const clientContext = await browser.newContext();
        const hostPage = await hostContext.newPage();
        const clientPage = await clientContext.newPage();

        await openLocalFirst(hostPage, docId);
        const hostPeerId = await localFirstPeerId(hostPage);

        await connectLocalFirstClient(clientPage, docId, hostPeerId);
        await expectLocalFirstConnectionOpen(hostPage);
        await expectLocalFirstConnectionOpen(clientPage);

        const hostPanel = todoPanel(hostPage, 'Todos');
        const clientPanel = todoPanel(clientPage, 'Todos');

        await addTodoInPanel(hostPanel, hostTitle);
        await expect(clientPanel.locator('.todoTitle', {hasText: hostTitle})).toBeVisible({
            timeout: 10_000,
        });

        await addTodoInPanel(clientPanel, clientTitle);
        await expect(hostPanel.locator('.todoTitle', {hasText: clientTitle})).toBeVisible({
            timeout: 10_000,
        });

        await clientPage.getByRole('button', {name: 'Request sync'}).click();
        await expectLocalFirstStat(clientPage, 'Connected', '1');

        clientPage.once('dialog', (dialog) => dialog.accept());
        await clientPage.getByRole('button', {name: 'Compact retained log'}).click();
        await expectLocalFirstStat(clientPage, 'Compaction', /Compacted \d+ retained batch/);
        await expect(clientPage.getByTestId('local-first-connection-row')).toContainText(/open/i);

        await clientContext.close();
        await hostContext.close();
    } finally {
        await peerServer.stop();
    }
});
