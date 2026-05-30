import {expect, test} from '@playwright/test';
import {closeDocumentManager, createDocument, openDocumentManager} from '../helpers/documents';
import {expectTodoOrder, openTodoMode, todoPanel, todoRow, uniqueDocId} from '../helpers/todos';

test('supports narrow viewport top-bar, document modal, and keyboard todo editing', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({width: 390, height: 844});
    await openTodoMode(page, 'solo', uniqueDocId(testInfo, 'narrow-keyboard'));

    await expect(page.getByLabel('Example app')).toBeVisible();
    await expect(page.getByLabel('Architecture')).toBeVisible();

    const modal = await openDocumentManager(page);
    await expect(modal).toBeVisible();
    await createDocument(page, 'Narrow keyboard doc');
    await closeDocumentManager(page);

    const panel = todoPanel(page, 'Todos');
    await panel.getByPlaceholder('New todo').fill('Keyboard todo');
    await panel.getByPlaceholder('New todo').press('Enter');
    await expectTodoOrder(panel, ['Write README', 'Try CRDT sync', 'Keyboard todo']);

    await todoRow(panel, 'Keyboard todo').getByRole('button', {name: 'Edit'}).click();
    await panel.locator('.titleInput').fill('Keyboard edited todo');
    await panel.locator('.titleInput').press('Enter');
    await expectTodoOrder(panel, ['Write README', 'Try CRDT sync', 'Keyboard edited todo']);
});
