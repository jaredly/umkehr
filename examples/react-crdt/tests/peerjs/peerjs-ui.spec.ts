import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {closeDocumentManager, openDocumentManager} from '../helpers/documents';
import {peerJsHostPeerId, startPeerServer} from '../helpers/peer';

test('exposes host invite UI and keeps document management host-only', async ({
    browser,
}, testInfo) => {
    const peerServer = await startPeerServer();
    const docId = uniqueTestDocId(testInfo, 'peerjs-ui');

    try {
        const hostContext = await browser.newContext();
        const clientContext = await browser.newContext();
        const hostPage = await hostContext.newPage();
        const clientPage = await clientContext.newPage();

        await openApp(hostPage, {mode: 'peerjs', docId});
        await expect(hostPage.getByRole('heading', {name: 'Host Todos'})).toBeVisible();
        await expect(hostPage.locator('#peerInviteLink')).toHaveValue(/mode=peerjs/);
        const hostPeerId = await peerJsHostPeerId(hostPage);

        const modal = await openDocumentManager(hostPage);
        await expect(modal).toBeVisible();
        await closeDocumentManager(hostPage);
        await expect(modal).toBeHidden();

        await clientPage.goto(`/?mode=peerjs&doc=${encodeURIComponent(docId)}`);
        await clientPage.getByRole('button', {name: 'Client'}).click();
        await expect(clientPage.getByRole('heading', {name: 'Waiting for host snapshot'})).toBeVisible();
        await clientPage.getByPlaceholder('Host Peer ID').fill(hostPeerId);
        await clientPage.getByRole('button', {name: 'Connect'}).click();
        await expect(clientPage.getByRole('heading', {name: 'Client Todos'})).toBeVisible({
            timeout: 10_000,
        });

        await expect(clientPage.getByText('PeerJS clients follow the host document.')).toBeVisible();
        await expect(clientPage.getByTestId('document-manager-trigger')).toHaveCount(0);

        await clientContext.close();
        await hostContext.close();
    } finally {
        await peerServer.stop();
    }
});
