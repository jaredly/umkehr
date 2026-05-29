import {expect, test} from '@playwright/test';
import {
    addTodoInPanel,
    dragTodoBefore,
    dragTodoSlightly,
    editTodoInPanel,
    expectTodoAnimationInPanel,
    expectTodoOrder,
    installTodoAnimationRecorder,
    openTodoMode,
    resetTodoAnimationRecorder,
    todoPanel,
    todoRow,
    uniqueDocId,
} from '../helpers/todos';

test('supports solo todo CRUD, reorder, and undo/redo smoke flow', async ({page}, testInfo) => {
    await installTodoAnimationRecorder(page);
    await openTodoMode(page, 'solo', uniqueDocId(testInfo, 'solo'));

    const panel = todoPanel(page, 'Todos');
    await expectTodoOrder(panel, ['Write README', 'Try CRDT sync']);

    await addTodoInPanel(panel, 'Smoke A');
    await addTodoInPanel(panel, 'Smoke B');
    await expectTodoOrder(panel, ['Write README', 'Try CRDT sync', 'Smoke A', 'Smoke B']);

    await editTodoInPanel(panel, 'Smoke A', 'Smoke A edited');
    await expect(panel.locator('.todoTitle', {hasText: 'Smoke A'})).toHaveCount(1);
    await expect(panel.locator('.todoTitle', {hasText: 'Smoke A edited'})).toBeVisible();

    const editedRow = todoRow(panel, 'Smoke A edited');
    await editedRow.getByRole('checkbox').check();
    await expect(editedRow.getByRole('checkbox')).toBeChecked();

    await todoRow(panel, 'Try CRDT sync').getByRole('button', {name: 'Delete'}).click();
    await expect(panel.locator('.todoTitle', {hasText: 'Try CRDT sync'})).toHaveCount(0);
    await expectTodoOrder(panel, ['Write README', 'Smoke A edited', 'Smoke B']);

    await resetTodoAnimationRecorder(page);
    await dragTodoBefore(panel, 'Smoke B', 'Write README');
    await expectTodoOrder(panel, ['Smoke B', 'Write README', 'Smoke A edited']);
    await expectTodoAnimationInPanel(page, 'todoPanel');

    await dragTodoSlightly(panel, 'Smoke B');
    await expectTodoOrder(panel, ['Smoke B', 'Write README', 'Smoke A edited']);

    await panel.getByRole('button', {name: 'Undo'}).click();
    await expectTodoOrder(panel, ['Write README', 'Smoke A edited', 'Smoke B']);

    await panel.getByRole('button', {name: 'Redo'}).click();
    await expectTodoOrder(panel, ['Smoke B', 'Write README', 'Smoke A edited']);
});

test('persists solo todo color changes after reload', async ({page}, testInfo) => {
    await openTodoMode(page, 'solo', uniqueDocId(testInfo, 'solo-color'));

    const panel = todoPanel(page, 'Todos');
    await panel.getByRole('button', {name: 'Use #dbeafe'}).click();
    await expect(panel.getByRole('button', {name: 'Use #dbeafe'})).toHaveClass(/selected/);

    await page.reload();
    const reloadedPanel = todoPanel(page, 'Todos');
    await expectTodoOrder(reloadedPanel, ['Write README', 'Try CRDT sync']);
    await expect(reloadedPanel.getByRole('button', {name: 'Use #dbeafe'})).toHaveClass(/selected/);
});
