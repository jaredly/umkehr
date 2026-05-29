import {expect, test} from '@playwright/test';
import {openApp} from '../helpers/app';
import {expectLocalFirstStat} from '../helpers/localFirst';
import {expectTodoOrder, todoPanel} from '../helpers/todos';

test('creates a migrated local-first target document from an old seeded replica', async ({page}) => {
    const sourceDocId = `todos-migration-v1-main-${Date.now()}`;
    const targetDocId = `${sourceDocId}-local-first-v2`;

    await openApp(page, {
        mode: 'local-first',
        appId: 'todos@1',
        docId: 'todos-migration-v1-main',
    });
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});

    await page.evaluate(
        async ({fromDocId, toDocId}) => {
            const request = indexedDB.open('umkehr-react-crdt-local-first');
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
            try {
                const tx = db.transaction(['replicas', 'batches', 'receivedBatches'], 'readwrite');
                const replicas = tx.objectStore('replicas');
                const batches = tx.objectStore('batches');
                const receivedBatches = tx.objectStore('receivedBatches');
                const source = await new Promise<any>((resolve, reject) => {
                    const get = replicas.get(fromDocId);
                    get.onerror = () => reject(get.error);
                    get.onsuccess = () => resolve(get.result);
                });
                if (!source) throw new Error(`Replica ${fromDocId} was not seeded.`);
                await new Promise<void>((resolve, reject) => {
                    const put = replicas.put({...source, docId: toDocId, title: toDocId}, toDocId);
                    put.onerror = () => reject(put.error);
                    put.onsuccess = () => resolve();
                });
                const cursorRequest = batches.index('docId').openCursor(fromDocId);
                await new Promise<void>((resolve, reject) => {
                    cursorRequest.onerror = () => reject(cursorRequest.error);
                    cursorRequest.onsuccess = () => {
                        const cursor = cursorRequest.result;
                        if (!cursor) {
                            resolve();
                            return;
                        }
                        const value = cursor.value;
                        batches.put(
                            {...value, docId: toDocId},
                            `${toDocId}:${value.origin}:${value.batchId}`,
                        );
                        cursor.continue();
                    };
                });
                const receivedCursorRequest = receivedBatches.index('docId').openCursor(fromDocId);
                await new Promise<void>((resolve, reject) => {
                    receivedCursorRequest.onerror = () => reject(receivedCursorRequest.error);
                    receivedCursorRequest.onsuccess = () => {
                        const cursor = receivedCursorRequest.result;
                        if (!cursor) {
                            resolve();
                            return;
                        }
                        const value = cursor.value;
                        receivedBatches.put(
                            {...value, docId: toDocId},
                            `${toDocId}:${value.origin}:${value.batchId}`,
                        );
                        cursor.continue();
                    };
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
        {fromDocId: 'todos-migration-v1-main', toDocId: sourceDocId},
    );

    await openApp(page, {mode: 'local-first', docId: sourceDocId});
    await expect(page.getByRole('heading', {name: 'Schema migration available'})).toBeVisible();
    await expect(page.getByText(sourceDocId)).toBeVisible();
    await expect(page.getByText(targetDocId)).toBeVisible();

    await page.getByRole('button', {name: 'Create migrated document'}).click();
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
    await expectLocalFirstStat(page, 'Lineage', /todos-migration-v1-main/);
    await expectLocalFirstStat(page, 'Document', targetDocId);
    await expectTodoOrder(todoPanel(page, 'Todos'), ['Write README', 'Try CRDT sync']);
});
