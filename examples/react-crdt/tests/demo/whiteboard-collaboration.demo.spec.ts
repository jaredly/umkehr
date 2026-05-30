import {expect, test} from '@playwright/test';
import {demoPause} from '../helpers/demo';
import {
    addEmoji,
    addNote,
    drawStroke,
    expectNoteText,
    expectVisibleElementCount,
    openWhiteboardMode,
    uniqueWhiteboardDocId,
    whiteboardPanel,
} from '../helpers/whiteboard';

test('demo: local whiteboard collaboration converges after offline edits', async ({
    page,
}, testInfo) => {
    await openWhiteboardMode(page, 'local', uniqueWhiteboardDocId(testInfo, 'demo-whiteboard'));

    const leftPanel = whiteboardPanel(page, 'Replica A');
    const rightPanel = whiteboardPanel(page, 'Replica B');

    await addNote(leftPanel, 'Launch checklist');
    await expectNoteText(rightPanel, 'Launch checklist');
    await demoPause(page);

    await page.getByRole('button', {name: 'Pause sync'}).click();
    await addNote(leftPanel, 'Offline decision');
    await addEmoji(rightPanel, {x: 80, y: 80});
    await drawStroke(rightPanel, {x: 120, y: 360});
    await expect(page.getByText(/A [1-9]\d*/)).toBeVisible();
    await expect(page.getByText(/B [1-9]\d*/)).toBeVisible();
    await demoPause(page);

    await page.getByRole('button', {name: 'Resume sync'}).click();
    await expectNoteText(leftPanel, 'Offline decision');
    await expectNoteText(rightPanel, 'Offline decision');
    await expectVisibleElementCount(leftPanel, 4);
    await expectVisibleElementCount(rightPanel, 4);
    await expect(page.getByText('A 0')).toBeVisible();
    await expect(page.getByText('B 0')).toBeVisible();
});
