import {expect, type Locator, type Page} from '@playwright/test';

export async function openDocumentManager(page: Page) {
    const existing = page.getByTestId('document-manager-modal');
    if ((await existing.count()) > 0) {
        await expect(existing).toBeVisible();
        return existing;
    }

    const trigger = page.getByTestId('document-manager-trigger');
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
        await trigger.click();
    }
    const modal = page.getByTestId('document-manager-modal');
    await expect(modal).toBeVisible();
    return modal;
}

export async function closeDocumentManager(page: Page) {
    await page.getByRole('button', {name: 'Close documents'}).click();
    await expect(page.getByTestId('document-manager-modal')).toHaveCount(0);
}

export async function createDocument(
    page: Page,
    title: string,
    options: {pieceCount?: '12' | '30' | '60' | '120'} = {},
) {
    const modal = await openDocumentManager(page);
    await modal.getByLabel('New document title').fill(title);
    if (options.pieceCount) {
        await modal.getByLabel('Number of pieces').selectOption(options.pieceCount);
    }
    await modal.getByRole('button', {name: 'New document'}).click();
    await expect(modal.getByText('Document created')).toBeVisible();
    await expect(documentRow(modal, title)).toBeVisible();
    return modal;
}

export async function openDocument(page: Page, title: string) {
    const modal = await openDocumentManager(page);
    await documentRow(modal, title).getByRole('button', {name: 'Open'}).click();
    await expect(page.getByTestId('document-manager-modal')).toHaveCount(0);
}

export async function openDocumentByDocId(page: Page, docId: string) {
    const modal = await openDocumentManager(page);
    await modal
        .locator(`[data-testid="document-row"][data-doc-id="${docId}"]`)
        .getByRole('button', {name: 'Open'})
        .click();
    await expect(page.getByTestId('document-manager-modal')).toHaveCount(0);
}

export async function deleteLocalDocument(page: Page, title: string) {
    const modal = await openDocumentManager(page);
    page.once('dialog', (dialog) => dialog.accept());
    await documentRow(modal, title).getByRole('button', {name: 'Delete local'}).click();
    await expect(modal.getByText('Local copy deleted')).toBeVisible();
    await expect(documentRow(modal, title)).toHaveCount(0);
}

export async function createSeedDocument(page: Page, docId: string) {
    const modal = await openDocumentManager(page);
    const row = modal.locator(`[data-testid="seed-document-row"][data-doc-id="${docId}"]`);
    await row.getByRole('button', {name: 'Create'}).click();
    await expect(modal.getByText(/Created /)).toBeVisible();
    await expect(modal.locator(`[data-testid="document-row"][data-doc-id="${docId}"]`)).toBeVisible();
    return modal;
}

export async function exportCurrentDocument(page: Page) {
    const modal = await openDocumentManager(page);
    const downloadPromise = page.waitForEvent('download');
    await modal.getByRole('button', {name: 'Export current'}).click();
    return downloadPromise;
}

export async function importDocumentArchive(page: Page, filePath: string) {
    const modal = await openDocumentManager(page);
    await modal.getByTestId('document-archive-input').setInputFiles(filePath);
    await expect(modal.getByText('Document imported')).toBeVisible();
}

function documentRow(modal: Locator, title: string) {
    return modal.getByTestId('document-row').filter({hasText: title});
}
