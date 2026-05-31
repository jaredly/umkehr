import {expect, type Locator, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';

test('accepts basic keyboard input in a rich note and syncs locally', async ({page}, testInfo) => {
    await openApp(page, {
        mode: 'local',
        appId: 'rich-notes',
        docId: uniqueTestDocId(testInfo, 'rich-notes-local'),
    });

    const leftPanel = page.locator('.richNotesPanel.leftPanel');
    const rightPanel = page.locator('.richNotesPanel.rightPanel');
    await expect(leftPanel).toBeVisible();
    await expect(rightPanel).toBeVisible();

    const leftEditor = richNoteEditor(leftPanel);
    await leftEditor.click();
    await page.keyboard.type('hello');

    await expect(leftEditor).toContainText('hello');
    await expect(richNoteEditor(rightPanel)).toContainText('hello');
    await expect(leftPanel.locator('.richNoteTitle').first()).toHaveText('hello');
    await expect(rightPanel.locator('.richNoteTitle').first()).toHaveText('hello');
});

function richNoteEditor(panel: Locator) {
    return panel.locator('.richNotesEditor [contenteditable]');
}
