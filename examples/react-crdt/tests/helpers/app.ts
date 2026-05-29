import {expect, type Page} from '@playwright/test';

export async function openServerDocument(
    page: Page,
    {
        appId = 'todos',
        docId,
        serverMigrationDelayMs,
    }: {appId?: string; docId: string; serverMigrationDelayMs?: number},
) {
    const params = new URLSearchParams({mode: 'server', doc: docId});
    if (appId !== 'todos') params.set('app', appId);
    if (serverMigrationDelayMs !== undefined) {
        params.set('serverMigrationDelayMs', String(serverMigrationDelayMs));
    }
    await page.goto(`/?${params.toString()}`);
}

export async function login(page: Page, nickname: string) {
    const knownUser = page.getByRole('button', {name: nickname});
    if (await knownUser.isVisible().catch(() => false)) {
        await knownUser.click();
    } else {
        await page.getByLabel('Nickname').fill(nickname);
        await page.getByRole('button', {name: 'Log in'}).click();
    }
}

export async function waitForSynced(page: Page) {
    await expect(page.getByRole('img', {name: 'No unsynced local events'})).toBeVisible({
        timeout: 10_000,
    });
}

export async function expectMigrationRequired(page: Page) {
    await expectServerNotice(page, /must be migrated to the latest schema/);
    await expect(page.getByRole('button', {name: 'Migrate document'})).toBeVisible();
}

export async function clickMigrateDocument(page: Page) {
    await page.getByRole('button', {name: 'Migrate document'}).click();
}

export async function expectMigrationRunning(page: Page) {
    await expectServerNotice(page, /Document migration is in progress/);
}

export async function expectClientUpgradeRequired(page: Page) {
    await expectServerNotice(page, /must update your app/);
}

export async function expectUnsyncedEvents(page: Page, count: number) {
    const eventLabel = count === 1 ? 'event' : 'events';
    await expect(
        page.getByRole('img', {name: `${count} unsynced local ${eventLabel}`}),
    ).toBeVisible({
        timeout: 10_000,
    });
}

export async function expectStaleMergeReviewRequired(page: Page) {
    await expectServerNotice(page, /Review local changes before upload|Review before uploading/);
    await expect(
        page.getByRole('heading', {name: 'Review local changes before upload'}),
    ).toBeVisible();
}

export async function agePendingServerEvents(page: Page, docId: string, receivedAt: string) {
    await page.evaluate(
        async ({docId, receivedAt}) => {
            const request = indexedDB.open('umkehr-react-crdt-server-sync');
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
            try {
                const tx = db.transaction('replicas', 'readwrite');
                const store = tx.objectStore('replicas');
                const replica = await new Promise<any>((resolve, reject) => {
                    const get = store.get(docId);
                    get.onerror = () => reject(get.error);
                    get.onsuccess = () => resolve(get.result);
                });
                if (!replica) throw new Error(`Replica ${docId} not found.`);
                for (const branch of Object.values<any>(replica.branches)) {
                    for (const event of branch.events) {
                        if (event.kind === 'update' && !event.recorded) {
                            event.receivedAt = receivedAt;
                        }
                    }
                }
                await new Promise<void>((resolve, reject) => {
                    const put = store.put(replica, docId);
                    put.onerror = () => reject(put.error);
                    put.onsuccess = () => resolve();
                });
                await new Promise<void>((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                });
            } finally {
                db.close();
            }
        },
        {docId, receivedAt},
    );
}

export async function disconnectFromServer(page: Page) {
    await page.getByRole('button', {name: 'Disconnect from server'}).click();
}

export async function reconnectToServer(page: Page) {
    await page.getByRole('button', {name: 'Reconnect to server'}).click();
}

export async function addTodo(page: Page, title: string) {
    await page.getByPlaceholder('New todo').fill(title);
    await page.getByRole('button', {name: 'Add'}).click();
}

export async function editTodo(page: Page, currentTitle: string, nextTitle: string) {
    const item = page.locator('.todoItem', {hasText: currentTitle});
    await item.getByRole('button', {name: 'Edit'}).click();
    const input = page.locator('.titleInput');
    await input.fill(nextTitle);
    await input.press('Enter');
}

export async function expectTodoVisible(page: Page, title: string) {
    await expect(page.locator('.todoTitle', {hasText: title})).toBeVisible();
}

export async function expectServerNotice(page: Page, text: string | RegExp) {
    await expect(page.locator('.serverToolbarNotice')).toContainText(text, {timeout: 10_000});
}
