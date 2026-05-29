import {expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Locator, Page} from '@playwright/test';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const reactCrdtDir = path.resolve(testDir, '../..');

export const E2E_PEER_PORT = Number(process.env.UMKEHR_E2E_PEER_PORT ?? 9000);
export const E2E_PEER_PATH = process.env.UMKEHR_E2E_PEER_PATH ?? '/peerjs';

export async function startPeerServer({
    port = E2E_PEER_PORT,
    path: serverPath = E2E_PEER_PATH,
}: {port?: number; path?: string} = {}) {
    const child = spawn(
        path.join(reactCrdtDir, 'node_modules/.bin/peerjs'),
        ['--port', String(port), '--host', '127.0.0.1', '--path', serverPath],
        {cwd: reactCrdtDir, stdio: 'pipe'},
    );

    try {
        await waitForPeerServer(port, serverPath);
    } catch (error) {
        child.kill();
        throw error;
    }

    return {
        async stop() {
            if (child.exitCode !== null || child.signalCode !== null) return;
            child.kill();
            await new Promise((resolve) => child.once('exit', resolve));
        },
    };
}

export async function peerIdFromInviteInput(input: Locator) {
    await expect(input).toHaveValue(/peer=/, {timeout: 10_000});
    const peerId = new URL(await input.inputValue()).searchParams.get('peer');
    if (!peerId) throw new Error('Invite URL did not include a peer id.');
    return peerId;
}

export async function peerJsHostPeerId(page: Page) {
    return peerIdFromInviteInput(page.locator('#peerInviteLink'));
}

export async function localFirstHostPeerId(page: Page) {
    return peerIdFromInviteInput(page.locator('#local-first-invite'));
}

export function peerConnectionList(page: Page) {
    return page.locator('.connectionList');
}

export function peerConnectionRow(page: Page, peerId: string) {
    return peerConnectionList(page).locator(`.connectionRow[data-peer-id="${escapeAttribute(peerId)}"]`);
}

export async function expectPeerConnectionOpen(page: Page, peerId: string | RegExp) {
    const row =
        typeof peerId === 'string'
            ? peerConnectionRow(page, peerId)
            : peerConnectionList(page).locator('.connectionRow').filter({hasText: peerId});
    await expect(row).toContainText(/open/i, {timeout: 10_000});
}

async function waitForPeerServer(port: number, serverPath: string) {
    const pathSegment = serverPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const url = `http://127.0.0.1:${port}/${pathSegment}/peerjs/id?key=peerjs`;
    const deadline = Date.now() + 10_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(lastError, `PeerServer became healthy at ${url}`).toBeUndefined();
}

function escapeAttribute(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
