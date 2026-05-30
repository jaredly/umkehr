import {expect, test} from '@playwright/test';
import {demoPause} from '../helpers/demo';
import {
    addTodoInPanel,
    expectTodoOrder,
    openTodoMode,
    todoPanel,
    uniqueDocId,
} from '../helpers/todos';

test('demo: local todo replicas queue divergent edits and converge', async ({page}, testInfo) => {
    await openTodoMode(page, 'local', uniqueDocId(testInfo, 'demo-local-conflict'));

    const leftPanel = todoPanel(page, 'Replica A');
    const rightPanel = todoPanel(page, 'Replica B');
    await expectTodoOrder(leftPanel, ['Write README', 'Try CRDT sync']);

    await page.getByRole('button', {name: 'Pause sync'}).click();
    await demoPause(page);

    await addTodoInPanel(leftPanel, 'Draft offline plan');
    await addTodoInPanel(rightPanel, 'Capture remote note');
    await expect(page.getByText('A 1')).toBeVisible();
    await expect(page.getByText('B 1')).toBeVisible();
    await demoPause(page);

    await page.getByRole('button', {name: 'Resume sync'}).click();
    await expectTodoOrder(leftPanel, [
        'Write README',
        'Try CRDT sync',
        'Draft offline plan',
        'Capture remote note',
    ]);
    await expectTodoOrder(rightPanel, [
        'Write README',
        'Try CRDT sync',
        'Draft offline plan',
        'Capture remote note',
    ]);
    await expect(page.getByText('A 0')).toBeVisible();
    await expect(page.getByText('B 0')).toBeVisible();
});
