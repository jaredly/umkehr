import {expect, type Locator, type Page} from '@playwright/test';
import {openApp} from './app';
import {localFirstHostPeerId, peerIdFromInviteInput} from './peer';

export async function openLocalFirst(page: Page, docId: string, appId = 'todos') {
    await openApp(page, {mode: 'local-first', appId, docId});
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
}

export async function connectLocalFirstClient(page: Page, docId: string, hostPeerId: string) {
    await page.goto(
        `/?mode=local-first&doc=${encodeURIComponent(docId)}&peer=${encodeURIComponent(hostPeerId)}`,
    );
    await expect(page.getByTestId('local-first-controls')).toBeVisible({timeout: 10_000});
}

export async function localFirstPeerId(page: Page) {
    return localFirstHostPeerId(page);
}

export async function expectLocalFirstConnectionOpen(page: Page) {
    await expect(localFirstConnectionRows(page).filter({hasText: /open/i}).first()).toBeVisible({
        timeout: 10_000,
    });
}

export function localFirstConnectionRows(page: Page) {
    return page.getByTestId('local-first-connection-row');
}

export function localFirstStat(page: Page, label: string) {
    return page
        .getByTestId('local-first-stats')
        .locator('dt', {hasText: new RegExp(`^${escapeRegExp(label)}$`)})
        .locator('xpath=following-sibling::dd[1]');
}

export async function expectLocalFirstStat(page: Page, label: string, value: string | RegExp) {
    await expect(localFirstStat(page, label)).toHaveText(value, {timeout: 10_000});
}

export async function localFirstInvitePeerId(input: Locator) {
    return peerIdFromInviteInput(input);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
