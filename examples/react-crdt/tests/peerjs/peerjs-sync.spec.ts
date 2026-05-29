import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {expectPeerConnectionOpen, peerConnectionRow, peerJsHostPeerId, startPeerServer} from '../helpers/peer';
import {addTodoInPanel, expectTodoOrder, todoPanel} from '../helpers/todos';

test('syncs todo edits between a PeerJS host and client through local PeerServer', async ({
    browser,
}, testInfo) => {
    const peerServer = await startPeerServer();
    const docId = uniqueTestDocId(testInfo, 'peerjs');
    const hostTitle = `PeerJS host task ${Date.now()}`;
    const clientTitle = `PeerJS client task ${Date.now()}`;
    const queuedTitle = `PeerJS queued task ${Date.now()}`;

    try {
        const hostContext = await browser.newContext();
        const clientContext = await browser.newContext();
        const hostPage = await hostContext.newPage();
        const clientPage = await clientContext.newPage();

        await openApp(hostPage, {mode: 'peerjs', docId});
        await expect(hostPage.getByRole('heading', {name: 'Host Todos'})).toBeVisible();
        const hostPeerId = await peerJsHostPeerId(hostPage);

        await clientPage.goto(`/?mode=peerjs&doc=${encodeURIComponent(docId)}&peer=${hostPeerId}`);
        await expect(clientPage.getByRole('heading', {name: 'Client Todos'})).toBeVisible({
            timeout: 10_000,
        });
        await expectPeerConnectionOpen(clientPage, hostPeerId);

        const hostPanel = todoPanel(hostPage, 'Host Todos');
        const clientPanel = todoPanel(clientPage, 'Client Todos');

        await addTodoInPanel(hostPanel, hostTitle);
        await expect(
            clientPanel.locator('.todoTitle', {hasText: hostTitle}),
        ).toBeVisible();

        await addTodoInPanel(clientPanel, clientTitle);
        await expect(hostPanel.locator('.todoTitle', {hasText: clientTitle})).toBeVisible();

        await peerConnectionRow(clientPage, hostPeerId).getByRole('button', {name: 'Disconnect'}).click();
        await expect(peerConnectionRow(clientPage, hostPeerId)).toContainText('Closed');

        await addTodoInPanel(clientPanel, queuedTitle);
        await expect(hostPanel.locator('.todoTitle', {hasText: queuedTitle})).toBeHidden({
            timeout: 1_000,
        });
        await expect(peerConnectionRow(clientPage, hostPeerId)).toContainText('1 queued');

        await peerConnectionRow(clientPage, hostPeerId).getByRole('button', {name: 'Reconnect'}).click();
        await expect(hostPanel.locator('.todoTitle', {hasText: queuedTitle})).toBeVisible({
            timeout: 10_000,
        });
        await expectTodoOrder(clientPanel, [
            'Write README',
            'Try CRDT sync',
            hostTitle,
            clientTitle,
            queuedTitle,
        ]);

        await clientContext.close();
        await hostContext.close();
    } finally {
        await peerServer.stop();
    }
});
