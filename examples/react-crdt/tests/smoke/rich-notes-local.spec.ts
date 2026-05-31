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
    await expect.poll(() => selectionState(leftEditor)).toEqual({
        active: true,
        inside: true,
        start: 5,
        end: 5,
    });
    await expect(richNoteEditor(rightPanel)).toContainText('hello');
    await expect(leftPanel.locator('.richNoteTitle').first()).toHaveText('hello');
    await expect(rightPanel.locator('.richNoteTitle').first()).toHaveText('hello');
});

function richNoteEditor(panel: Locator) {
    return panel.locator('.richNotesEditor [contenteditable]');
}

async function selectionState(editor: Locator) {
    return editor.evaluate((element) => {
        const textOffset = (root: Element, container: Node, offset: number) => {
            const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let total = 0;
            let current = walker.nextNode();
            while (current) {
                if (current === container) return total + offset;
                total += current.textContent?.length ?? 0;
                current = walker.nextNode();
            }
            return total;
        };
        const selection = element.ownerDocument.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const state = {
            active: element.ownerDocument.activeElement === element,
            inside: element.contains(selection.anchorNode) && element.contains(selection.focusNode),
            start: textOffset(element, range.startContainer, range.startOffset),
            end: textOffset(element, range.endContainer, range.endOffset),
        };
        return state;
    });
}
