import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {expectLocalFirstReplicaToContain, expectLocalFirstStat} from '../helpers/localFirst';
import {addTodoInPanel, todoPanel} from '../helpers/todos';

test('creates a migrated local-first target document from an old local replica', async ({
    page,
}, testInfo) => {
    const sourceDocId = uniqueTestDocId(testInfo, 'local-first-v1');
    const targetDocId = `${sourceDocId}-local-first-v2`;
    const migratedTitle = `Migrated local-first todo ${Date.now()}`;

    await openApp(page, {mode: 'local-first', appId: 'todos@1', docId: sourceDocId});
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
    await addTodoInPanel(todoPanel(page, 'Todos v1'), migratedTitle);
    await expectLocalFirstReplicaToContain(page, sourceDocId, migratedTitle);

    await openApp(page, {mode: 'local-first', docId: sourceDocId});
    await expect(page.getByRole('heading', {name: 'Schema migration available'})).toBeVisible();
    await expect(page.getByText(sourceDocId).first()).toBeVisible();
    await expect(page.getByText(targetDocId).first()).toBeVisible();

    await page.getByRole('button', {name: 'Create migrated document'}).click();
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
    await expectLocalFirstStat(page, 'Lineage', new RegExp(sourceDocId));
    await expectLocalFirstStat(page, 'Document', targetDocId);
    await expect(todoPanel(page, 'Todos').locator('.todoTitle', {hasText: migratedTitle})).toBeVisible();
});
