import {test} from '@playwright/test';
import {
    addEmoji,
    addNote,
    archiveSelected,
    drawStroke,
    expectNoteText,
    expectVisibleElementCount,
    moveNote,
    openWhiteboardMode,
    recoverFirstArchived,
    resizeNote,
    uniqueWhiteboardDocId,
    whiteboardPanel,
} from '../helpers/whiteboard';

test('supports solo whiteboard note, emoji, stroke, archive, recover, and undo/redo', async ({
    page,
}, testInfo) => {
    await openWhiteboardMode(page, 'solo', uniqueWhiteboardDocId(testInfo, 'solo'));

    const panel = whiteboardPanel(page, 'Whiteboard');
    await expectVisibleElementCount(panel, 0);

    const note = await addNote(panel, 'Solo note');
    await moveNote(panel, note);
    await resizeNote(panel, note);
    await expectVisibleElementCount(panel, 1);

    await addEmoji(panel);
    await expectVisibleElementCount(panel, 2);

    await drawStroke(panel);
    await expectVisibleElementCount(panel, 3);

    await archiveSelected(panel);
    await expectVisibleElementCount(panel, 2);

    await recoverFirstArchived(panel);
    await expectVisibleElementCount(panel, 3);

    await panel.getByRole('button', {name: 'Undo'}).click();
    await expectVisibleElementCount(panel, 2);

    await panel.getByRole('button', {name: 'Redo'}).click();
    await expectVisibleElementCount(panel, 3);

    await page.reload();
    const reloadedPanel = whiteboardPanel(page, 'Whiteboard');
    await expectNoteText(reloadedPanel, 'Solo note');
    await expectVisibleElementCount(reloadedPanel, 3);
});
