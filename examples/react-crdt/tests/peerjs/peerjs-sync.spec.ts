import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {createDocument, openDocument} from '../helpers/documents';
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

test('jigsaw PeerJS invite is only shown after the host opens a document', async ({
    browser,
}, testInfo) => {
    const peerServer = await startPeerServer();
    const docId = uniqueTestDocId(testInfo, 'jigsaw-peerjs-invite-ready');
    const title = `PeerJS late jigsaw ${Date.now()}`;

    try {
        const hostContext = await browser.newContext();
        const hostPage = await hostContext.newPage();

        await openApp(hostPage, {mode: 'peerjs', appId: 'jigsaw', docId});
        await expect(hostPage.getByRole('heading', {name: 'Choose a document'})).toBeVisible();
        await expect(hostPage.locator('#peerInviteLink')).toHaveCount(0);

        await createDocument(hostPage, title, {pieceCount: '12'});
        await expect(hostPage.locator('#peerInviteLink')).toHaveCount(0);
        await openDocument(hostPage, title);
        await expect(hostPage.getByRole('heading', {name: 'Host Jigsaw'})).toBeVisible();
        await expect(hostPage.locator('#peerInviteLink')).toHaveValue(/app=jigsaw/);
        const inviteUrl = await hostPage.locator('#peerInviteLink').inputValue();
        const hostPeerId = new URL(inviteUrl).searchParams.get('peer');
        expect(hostPeerId).toBeTruthy();

        const clientContext = await browser.newContext();
        const clientPage = await clientContext.newPage();
        await clientPage.goto(inviteUrl);
        await expectPeerConnectionOpen(clientPage, hostPeerId!);
        await expect(clientPage.getByRole('heading', {name: 'Client Jigsaw'})).toBeVisible({
            timeout: 10_000,
        });
        await expect(clientPage.getByText('Waiting for host snapshot')).toHaveCount(0);
        await expect(clientPage.locator('.jigsawPiece')).toHaveCount(12);

        await clientContext.close();
        await hostContext.close();
    } finally {
        await peerServer.stop();
    }
});
