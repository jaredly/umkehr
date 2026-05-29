import {expect, test, type Locator, type Page, type TestInfo} from '@playwright/test';
import {
    addTodo,
    login,
    openServerDocument,
    waitForSynced,
} from './helpers/app';
import {createTempServerDbPath, seedServerDatabase, startServer} from './helpers/server';

declare global {
    interface Window {
        __todoAnimationCalls?: {panelClass: string; text: string}[];
    }
}

test('supports solo todo CRUD, reorder, and undo/redo smoke flow', async ({page}, testInfo) => {
    await installAnimationRecorder(page);
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

    await resetAnimationRecorder(page);
    await dragTodoBefore(panel, 'Smoke B', 'Write README');
    await expectTodoOrder(panel, ['Smoke B', 'Write README', 'Smoke A edited']);
    await expectAnimationInPanel(page, 'todoPanel');

    await dragTodoSlightly(panel, 'Smoke B');
    await expectTodoOrder(panel, ['Smoke B', 'Write README', 'Smoke A edited']);

    await panel.getByRole('button', {name: 'Undo'}).click();
    await expectTodoOrder(panel, ['Write README', 'Smoke A edited', 'Smoke B']);

    await panel.getByRole('button', {name: 'Redo'}).click();
    await expectTodoOrder(panel, ['Smoke B', 'Write README', 'Smoke A edited']);
});

test('syncs todo reorder to the second local replica and animates the remote panel', async ({
    page,
}, testInfo) => {
    await installAnimationRecorder(page);
    await openTodoMode(page, 'local', uniqueDocId(testInfo, 'local'));

    const leftPanel = todoPanel(page, 'Replica A');
    const rightPanel = todoPanel(page, 'Replica B');
    await expectTodoOrder(leftPanel, ['Write README', 'Try CRDT sync']);
    await expectTodoOrder(rightPanel, ['Write README', 'Try CRDT sync']);

    await resetAnimationRecorder(page);
    await dragTodoAfter(leftPanel, 'Write README', 'Try CRDT sync');

    await expectTodoOrder(leftPanel, ['Try CRDT sync', 'Write README']);
    await expectTodoOrder(rightPanel, ['Try CRDT sync', 'Write README']);
    await expectAnimationInPanel(page, 'rightPanel');
});

test('disables todo controls while server history preview is read-only', async ({page}, testInfo) => {
    const dbPath = await createTempServerDbPath(testInfo);
    await seedServerDatabase({dbPath});
    const server = await startServer({dbPath});

    try {
        await openServerDocument(page, {docId: 'todos-small'});
        await login(page, 'Ada');
        await waitForSynced(page);

        await addTodo(page, 'Read-only smoke event');
        await waitForSynced(page);

        await page.locator('.serverTimeline button').last().click();
        await expect(page.getByText(/Previewing state after event/)).toBeVisible();

        const panel = todoPanel(page, 'Todos server client');
        await expect(panel.getByPlaceholder('New todo')).toBeDisabled();
        await expect(panel.getByRole('button', {name: 'Add'})).toBeDisabled();
        await expect(panel.getByRole('button', {name: 'Edit'}).first()).toBeDisabled();
        await expect(panel.getByRole('button', {name: 'Delete'}).first()).toBeDisabled();
        await expect(panel.getByRole('checkbox').first()).toBeDisabled();
        await expect(panel.getByRole('button', {name: /^Move /})).toHaveCount(0);
        await expect(panel.getByRole('button', {name: 'Use #fff'})).toBeDisabled();
    } finally {
        await server.stop();
    }
});

async function openTodoMode(page: Page, mode: 'solo' | 'local', docId: string) {
    await page.goto(`/?mode=${mode}&doc=${encodeURIComponent(docId)}`);
    await expect(page.locator('.todoPanel').first()).toBeVisible();
}

function uniqueDocId(testInfo: TestInfo, suffix: string) {
    const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `todo-smoke-${slug}-${suffix}-${Date.now()}`;
}

function todoPanel(page: Page, title: string) {
    return page.locator('.todoPanel', {has: page.getByRole('heading', {name: title})});
}

function todoRow(panel: Locator, title: string) {
    return panel.locator('.todoItem').filter({hasText: title});
}

async function addTodoInPanel(panel: Locator, title: string) {
    await panel.getByPlaceholder('New todo').fill(title);
    await panel.getByRole('button', {name: 'Add'}).click();
}

async function editTodoInPanel(panel: Locator, currentTitle: string, nextTitle: string) {
    await todoRow(panel, currentTitle).getByRole('button', {name: 'Edit'}).click();
    const input = panel.locator('.titleInput');
    await input.fill(nextTitle);
    await input.press('Enter');
}

async function expectTodoOrder(panel: Locator, titles: string[]) {
    await expect
        .poll(async () => panel.locator('.todoTitle').allTextContents())
        .toEqual(titles);
}

async function dragTodoBefore(panel: Locator, draggedTitle: string, targetTitle: string) {
    await dragTodoTo(panel, draggedTitle, targetTitle, 'before');
}

async function dragTodoAfter(panel: Locator, draggedTitle: string, targetTitle: string) {
    await dragTodoTo(panel, draggedTitle, targetTitle, 'after');
}

async function dragTodoTo(
    panel: Locator,
    draggedTitle: string,
    targetTitle: string,
    position: 'before' | 'after',
) {
    const page = panel.page();
    const draggedRow = todoRow(panel, draggedTitle);
    const targetRow = todoRow(panel, targetTitle);
    await draggedRow.hover();
    const handleBox = await draggedRow.getByRole('button', {name: `Move ${draggedTitle}`}).boundingBox();
    const targetBox = await targetRow.boundingBox();
    if (!handleBox || !targetBox) throw new Error('Could not locate todo drag geometry.');

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        position === 'before' ? targetBox.y + 4 : targetBox.y + targetBox.height - 4,
        {steps: 8},
    );
    await expect(targetRow).toHaveClass(new RegExp(position === 'before' ? 'dropBefore' : 'dropAfter'));
    await page.mouse.up();
}

async function dragTodoSlightly(panel: Locator, title: string) {
    const page = panel.page();
    const row = todoRow(panel, title);
    await row.hover();
    const handleBox = await row.getByRole('button', {name: `Move ${title}`}).boundingBox();
    if (!handleBox) throw new Error('Could not locate todo drag handle.');

    const x = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 2);
    await page.mouse.up();
}

async function installAnimationRecorder(page: Page) {
    await page.addInitScript(() => {
        window.__todoAnimationCalls = [];
        const originalAnimate = Element.prototype.animate;
        Element.prototype.animate = function (
            this: Element,
            keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
            options?: number | KeyframeAnimationOptions,
        ) {
            const row = this.closest?.('.todoItem');
            if (row) {
                window.__todoAnimationCalls?.push({
                    panelClass: row.closest('.todoPanel')?.className ?? '',
                    text: row.textContent ?? '',
                });
            }
            return originalAnimate.call(this, keyframes, options);
        };
    });
}

async function resetAnimationRecorder(page: Page) {
    await page.evaluate(() => {
        window.__todoAnimationCalls = [];
    });
}

async function expectAnimationInPanel(page: Page, panelClass: string) {
    await expect
        .poll(
            () =>
                page.evaluate((className) => {
                    return (window.__todoAnimationCalls ?? []).some((call) =>
                        call.panelClass.includes(className),
                    );
                }, panelClass),
            {timeout: 1_000},
        )
        .toBe(true);
}
