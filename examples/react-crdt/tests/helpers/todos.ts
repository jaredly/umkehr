import {expect, type Locator, type Page, type TestInfo} from '@playwright/test';
import {openApp} from './app';

declare global {
    interface Window {
        __todoAnimationCalls?: {panelClass: string; text: string}[];
    }
}

export type TodoMode = 'solo' | 'local';

export async function openTodoMode(page: Page, mode: TodoMode, docId: string) {
    await openApp(page, {mode, appId: 'todos', docId});
    await expect(page.locator('.todoPanel').first()).toBeVisible();
}

export function uniqueDocId(testInfo: TestInfo, suffix: string) {
    const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `todo-e2e-${slug}-${suffix}-${Date.now()}`;
}

export function todoPanel(page: Page, title: string) {
    return page.locator('.todoPanel', {has: page.getByRole('heading', {name: title})});
}

export function todoRow(panel: Locator, title: string) {
    return panel.locator('.todoItem').filter({hasText: title});
}

export async function addTodoInPanel(panel: Locator, title: string) {
    await panel.getByPlaceholder('New todo').fill(title);
    await panel.getByRole('button', {name: 'Add'}).click();
}

export async function editTodoInPanel(
    panel: Locator,
    currentTitle: string,
    nextTitle: string,
) {
    await todoRow(panel, currentTitle).getByRole('button', {name: 'Edit'}).click();
    const input = panel.locator('.titleInput');
    await input.fill(nextTitle);
    await input.press('Enter');
}

export async function expectTodoOrder(panel: Locator, titles: string[]) {
    await expect
        .poll(async () => panel.locator('.todoTitle').allTextContents())
        .toEqual(titles);
}

export async function dragTodoBefore(panel: Locator, draggedTitle: string, targetTitle: string) {
    await dragTodoTo(panel, draggedTitle, targetTitle, 'before');
}

export async function dragTodoAfter(panel: Locator, draggedTitle: string, targetTitle: string) {
    await dragTodoTo(panel, draggedTitle, targetTitle, 'after');
}

export async function dragTodoTo(
    panel: Locator,
    draggedTitle: string,
    targetTitle: string,
    position: 'before' | 'after',
) {
    const page = panel.page();
    const draggedRow = todoRow(panel, draggedTitle);
    const targetRow = todoRow(panel, targetTitle);
    await draggedRow.hover();
    const handleBox = await draggedRow
        .getByRole('button', {name: `Move ${draggedTitle}`})
        .boundingBox();
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

export async function dragTodoSlightly(panel: Locator, title: string) {
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

export async function installTodoAnimationRecorder(page: Page) {
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

export async function resetTodoAnimationRecorder(page: Page) {
    await page.evaluate(() => {
        window.__todoAnimationCalls = [];
    });
}

export async function expectTodoAnimationInPanel(page: Page, panelClass: string) {
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
