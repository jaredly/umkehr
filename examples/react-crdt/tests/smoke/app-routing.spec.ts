import {expect, test} from '@playwright/test';
import {
    openApp,
    selectArchitecture,
    selectExampleApp,
    uniqueTestDocId,
} from '../helpers/app';

test('routes between apps and architectures from the top bar', async ({page}, testInfo) => {
    await openApp(page, {docId: uniqueTestDocId(testInfo, 'default')});
    await expect(page.getByRole('heading', {name: 'Replica A'})).toBeVisible();
    await expect(page).not.toHaveURL(/mode=/);

    await selectArchitecture(page, 'Solo');
    await expect(page).toHaveURL(/mode=solo/);
    await expect(page.getByRole('heading', {name: 'Todos'})).toBeVisible();

    await selectExampleApp(page, 'Whiteboard');
    await expect(page).toHaveURL(/app=whiteboard/);
    await expect(page.getByRole('heading', {name: 'Whiteboard'})).toBeVisible();

    await selectArchitecture(page, 'Local');
    await expect(page).not.toHaveURL(/mode=/);
    await expect(page.getByRole('heading', {name: 'Replica A'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Replica B'})).toBeVisible();

    await selectExampleApp(page, 'Todos');
    await expect(page).not.toHaveURL(/app=/);
    await expect(page.locator('.todoPanel').first()).toBeVisible();
});

test('deep links and browser history restore app selection', async ({page}, testInfo) => {
    const todoDocId = uniqueTestDocId(testInfo, 'todos');
    const whiteboardDocId = uniqueTestDocId(testInfo, 'whiteboard');

    await openApp(page, {mode: 'solo', appId: 'todos', docId: todoDocId});
    await expect(page.getByRole('heading', {name: 'Todos'})).toBeVisible();

    await openApp(page, {mode: 'solo', appId: 'whiteboard', docId: whiteboardDocId});
    await expect(page.getByRole('heading', {name: 'Whiteboard'})).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`doc=${whiteboardDocId}`));

    await page.goBack();
    await expect(page.getByRole('heading', {name: 'Todos'})).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`doc=${todoDocId}`));

    await page.goForward();
    await expect(page.getByRole('heading', {name: 'Whiteboard'})).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`doc=${whiteboardDocId}`));
});
