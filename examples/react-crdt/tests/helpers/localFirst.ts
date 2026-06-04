import {expect, type Locator, type Page} from '@playwright/test';
import {openApp} from './app';
import {localFirstHostPeerId, peerIdFromInviteInput} from './peer';

export async function openLocalFirst(page: Page, docId: string, appId = 'todos') {
    await openApp(page, {mode: 'local-first', appId, docId});
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
}

export async function connectLocalFirstClient(page: Page, docId: string, hostPeerId: string) {
    await page.goto(
        `/?mode=local-first&doc=${encodeURIComponent(docId)}&peer=${encodeURIComponent(hostPeerId)}`,
    );
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
}

export async function localFirstPeerId(page: Page) {
    return localFirstHostPeerId(page);
}

export async function expectLocalFirstConnectionOpen(page: Page) {
    await expect(localFirstConnectionRows(page).filter({hasText: /open/i}).first()).toBeVisible({
        timeout: 10_000,
    });
}

export function localFirstConnectionRows(page: Page) {
    return page.getByTestId('local-first-connection-row');
}

export function localFirstStat(page: Page, label: string) {
    return page
        .getByTestId('local-first-stats')
        .locator('dt', {hasText: new RegExp(`^${escapeRegExp(label)}$`)})
        .locator('xpath=following-sibling::dd[1]');
}

export async function expectLocalFirstStat(page: Page, label: string, value: string | RegExp) {
    await expect(localFirstStat(page, label)).toHaveText(value, {timeout: 10_000});
}

export async function expectLocalFirstReplicaToContain(page: Page, docId: string, text: string) {
    await expect
        .poll(
            () =>
                page.evaluate(
                    async ({docId, text}) => {
                        const request = indexedDB.open('umkehr-react-crdt-local-first');
                        const db = await new Promise<IDBDatabase>((resolve, reject) => {
                            request.onerror = () => reject(request.error);
                            request.onsuccess = () => resolve(request.result);
                        });
                        try {
                            const tx = db.transaction('replicas', 'readonly');
                            const store = tx.objectStore('replicas');
                            const replica = await new Promise<unknown>((resolve, reject) => {
                                const get = store.get(docId);
                                get.onerror = () => reject(get.error);
                                get.onsuccess = () => resolve(get.result);
                            });
                            return JSON.stringify(replica).includes(text);
                        } finally {
                            db.close();
                        }
                    },
                    {docId, text},
                ),
            {timeout: 10_000},
        )
        .toBe(true);
}

export async function localFirstInvitePeerId(input: Locator) {
    return peerIdFromInviteInput(input);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
