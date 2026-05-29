import {expect, test} from '@playwright/test';
import {
    addTodoInPanel,
    dragTodoAfter,
    expectTodoAnimationInPanel,
    expectTodoOrder,
    installTodoAnimationRecorder,
    openTodoMode,
    resetTodoAnimationRecorder,
    todoPanel,
    uniqueDocId,
} from '../helpers/todos';

test('syncs todo reorder to the second local replica and animates the remote panel', async ({
    page,
}, testInfo) => {
    await installTodoAnimationRecorder(page);
    await openTodoMode(page, 'local', uniqueDocId(testInfo, 'local'));

    const leftPanel = todoPanel(page, 'Replica A');
    const rightPanel = todoPanel(page, 'Replica B');
    await expectTodoOrder(leftPanel, ['Write README', 'Try CRDT sync']);
    await expectTodoOrder(rightPanel, ['Write README', 'Try CRDT sync']);

    await resetTodoAnimationRecorder(page);
    await dragTodoAfter(leftPanel, 'Write README', 'Try CRDT sync');

    await expectTodoOrder(leftPanel, ['Try CRDT sync', 'Write README']);
    await expectTodoOrder(rightPanel, ['Try CRDT sync', 'Write README']);
    await expectTodoAnimationInPanel(page, 'rightPanel');
});

test('queues divergent local todo edits while sync is paused and converges on resume', async ({
    page,
}, testInfo) => {
    await openTodoMode(page, 'local', uniqueDocId(testInfo, 'paused-local'));

    const leftPanel = todoPanel(page, 'Replica A');
    const rightPanel = todoPanel(page, 'Replica B');
    await page.getByRole('button', {name: 'Pause sync'}).click();

    await addTodoInPanel(leftPanel, 'Offline A');
    await addTodoInPanel(rightPanel, 'Offline B');

    await expectTodoOrder(leftPanel, ['Write README', 'Try CRDT sync', 'Offline A']);
    await expectTodoOrder(rightPanel, ['Write README', 'Try CRDT sync', 'Offline B']);
    await expect(page.getByText('A 1')).toBeVisible();
    await expect(page.getByText('B 1')).toBeVisible();

    await page.getByRole('button', {name: 'Resume sync'}).click();
    await expectTodoOrder(leftPanel, ['Write README', 'Try CRDT sync', 'Offline A', 'Offline B']);
    await expectTodoOrder(rightPanel, ['Write README', 'Try CRDT sync', 'Offline A', 'Offline B']);
    await expect(page.getByText('A 0')).toBeVisible();
    await expect(page.getByText('B 0')).toBeVisible();
});
