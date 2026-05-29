import {expect, test} from '@playwright/test';
import {
    addEmoji,
    addNote,
    drawStroke,
    expectNoNoteText,
    expectNoteText,
    expectVisibleElementCount,
    openWhiteboardMode,
    uniqueWhiteboardDocId,
    whiteboardPanel,
} from '../helpers/whiteboard';

test('syncs whiteboard elements between local replicas', async ({page}, testInfo) => {
    await openWhiteboardMode(page, 'local', uniqueWhiteboardDocId(testInfo, 'local'));

    const leftPanel = whiteboardPanel(page, 'Replica A');
    const rightPanel = whiteboardPanel(page, 'Replica B');
    await addNote(leftPanel, 'Shared note');

    await expectNoteText(leftPanel, 'Shared note');
    await expectNoteText(rightPanel, 'Shared note');
    await expectVisibleElementCount(leftPanel, 1);
    await expectVisibleElementCount(rightPanel, 1);
});

test('queues divergent whiteboard edits while sync is paused and converges on resume', async ({
    page,
}, testInfo) => {
    await openWhiteboardMode(page, 'local', uniqueWhiteboardDocId(testInfo, 'paused-local'));

    const leftPanel = whiteboardPanel(page, 'Replica A');
    const rightPanel = whiteboardPanel(page, 'Replica B');
    await page.getByRole('button', {name: 'Pause sync'}).click();

    await addNote(leftPanel, 'Offline whiteboard A');
    await addEmoji(rightPanel);
    await drawStroke(rightPanel);

    await expectNoteText(leftPanel, 'Offline whiteboard A');
    await expectNoNoteText(rightPanel, 'Offline whiteboard A');
    await expectVisibleElementCount(leftPanel, 1);
    await expectVisibleElementCount(rightPanel, 2);
    await expect(page.getByText(/A [1-9]\d*/)).toBeVisible();
    await expect(page.getByText(/B [1-9]\d*/)).toBeVisible();

    await page.getByRole('button', {name: 'Resume sync'}).click();

    await expectNoteText(leftPanel, 'Offline whiteboard A');
    await expectNoteText(rightPanel, 'Offline whiteboard A');
    await expectVisibleElementCount(leftPanel, 3);
    await expectVisibleElementCount(rightPanel, 3);
    await expect(page.getByText('A 0')).toBeVisible();
    await expect(page.getByText('B 0')).toBeVisible();
});
