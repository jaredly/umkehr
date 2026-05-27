import {expect, type Page} from '@playwright/test';

export async function openServerDocument(
    page: Page,
    {appId = 'todos', docId}: {appId?: string; docId: string},
) {
    const params = new URLSearchParams({mode: 'server', doc: docId});
    if (appId !== 'todos') params.set('app', appId);
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
