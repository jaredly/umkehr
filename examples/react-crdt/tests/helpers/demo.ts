import type {Page} from '@playwright/test';

export async function demoPause(page: Page, ms = 250) {
    if (!process.env.UMKEHR_E2E_DEMO) return;
    await page.waitForTimeout(ms);
}
