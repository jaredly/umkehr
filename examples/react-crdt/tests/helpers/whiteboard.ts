import {expect, type Locator, type Page, type TestInfo} from '@playwright/test';
import {openApp} from './app';

export type WhiteboardMode = 'solo' | 'local';

export async function openWhiteboardMode(page: Page, mode: WhiteboardMode, docId: string) {
    await openApp(page, {mode, appId: 'whiteboard', docId});
    await expect(page.locator('[data-testid="whiteboard-panel"]').first()).toBeVisible();
}

export function uniqueWhiteboardDocId(testInfo: TestInfo, suffix: string) {
    const slug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `whiteboard-e2e-${slug}-${suffix}-${Date.now()}`;
}

export function whiteboardPanel(page: Page, title: string) {
    return page.locator('[data-testid="whiteboard-panel"]', {
        has: page.getByRole('heading', {name: title}),
    });
}

export function whiteboardViewport(panel: Locator) {
    return panel.getByTestId('whiteboard-viewport');
}

export async function expectVisibleElementCount(panel: Locator, count: number) {
    await expect(panel.getByText(`${count} visible`)).toBeVisible();
}

export async function expectSoloWhiteboardVisibleCountPersisted(
    page: Page,
    docId: string,
    count: number,
) {
    await expect
        .poll(
            () =>
                page.evaluate(
                    async ({docId, count}) => {
                        const request = indexedDB.open('umkehr-react-crdt-solo-documents');
                        const db = await new Promise<IDBDatabase>((resolve, reject) => {
                            request.onerror = () => reject(request.error);
                            request.onsuccess = () => resolve(request.result);
                        });
                        try {
                            const tx = db.transaction('documents', 'readonly');
                            const store = tx.objectStore('documents');
                            const document = await new Promise<any>((resolve, reject) => {
                                const get = store.get(docId);
                                get.onerror = () => reject(get.error);
                                get.onsuccess = () => resolve(get.result);
                            });
                            const elements = Object.values<any>(
                                document?.history?.current?.elements ?? {},
                            );
                            return elements.filter((element) => !element.archived).length === count;
                        } finally {
                            db.close();
                        }
                    },
                    {docId, count},
                ),
            {timeout: 10_000},
        )
        .toBe(true);
}

export async function addNote(panel: Locator, text: string, point = {x: 260, y: 220}) {
    await panel.getByRole('button', {name: 'Note', exact: true}).click();
    await clickBoardPoint(panel, point.x, point.y);
    const note = panel.getByTestId('whiteboard-note').last();
    await expect(note).toBeVisible();
    await note.getByPlaceholder('Note').fill(text);
    await note.getByPlaceholder('Note').press('Enter');
    await expect(note.locator('textarea')).toHaveValue(text);
    return note;
}

export async function expectNoteText(panel: Locator, text: string) {
    await expect
        .poll(async () =>
            panel
                .locator('textarea')
                .evaluateAll((textareas) =>
                    textareas.map((textarea) => (textarea as HTMLTextAreaElement).value),
                ),
        )
        .toContain(text);
}

export async function expectNoNoteText(panel: Locator, text: string) {
    await expect
        .poll(async () =>
            panel
                .locator('textarea')
                .evaluateAll((textareas) =>
                    textareas.map((textarea) => (textarea as HTMLTextAreaElement).value),
                ),
        )
        .not.toContain(text);
}

export async function addEmoji(panel: Locator, point = {x: 260, y: 260}) {
    await panel.getByRole('button', {name: 'Emoji', exact: true}).click();
    await clickBoardPoint(panel, point.x, point.y);
    const emoji = panel.getByTestId('whiteboard-emoji').last();
    await expect(emoji).toBeVisible();
    return emoji;
}

export async function drawStroke(panel: Locator, start = {x: 100, y: 160}) {
    await panel.getByRole('button', {name: 'Pen', exact: true}).click();
    const viewport = whiteboardViewport(panel);
    const box = await viewport.boundingBox();
    if (!box) throw new Error('Could not locate whiteboard viewport.');
    const x = clamp(start.x, 20, box.width - 20);
    const y = clamp(start.y, 20, box.height - 20);
    await viewport.page().mouse.move(box.x + x, box.y + y);
    await viewport.page().mouse.down();
    await viewport.page().mouse.move(
        box.x + clamp(x + 80, 20, box.width - 20),
        box.y + clamp(y + 30, 20, box.height - 20),
        {steps: 5},
    );
    await viewport.page().mouse.move(
        box.x + clamp(x + 150, 20, box.width - 20),
        box.y + clamp(y - 10, 20, box.height - 20),
        {steps: 5},
    );
    await viewport.page().mouse.up();
    const stroke = panel.getByTestId('whiteboard-stroke').last();
    await expect(stroke).toBeVisible();
    return stroke;
}

export async function moveNote(panel: Locator, note: Locator, delta = {x: 80, y: 40}) {
    const handle = note.locator('.whiteboardNoteHandle');
    const box = await handle.boundingBox();
    if (!box) throw new Error('Could not locate note drag handle.');
    const page = panel.page();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta.x, box.y + box.height / 2 + delta.y, {
        steps: 8,
    });
    await page.mouse.up();
}

export async function resizeNote(panel: Locator, note: Locator, delta = {x: 40, y: 30}) {
    const handle = note.getByRole('button', {name: 'Resize note'});
    const box = await handle.boundingBox();
    if (!box) throw new Error('Could not locate note resize handle.');
    const page = panel.page();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta.x, box.y + box.height / 2 + delta.y, {
        steps: 8,
    });
    await page.mouse.up();
}

export async function archiveSelected(panel: Locator) {
    await panel.getByRole('button', {name: 'Archive', exact: true}).click();
}

export async function recoverFirstArchived(panel: Locator) {
    await panel.getByRole('button', {name: /^Recover \(/}).click();
    await panel.getByTestId('whiteboard-archive-item').first().click();
}

export async function clickBoardPoint(panel: Locator, x: number, y: number) {
    const viewport = whiteboardViewport(panel);
    const box = await viewport.boundingBox();
    if (!box) throw new Error('Could not locate whiteboard viewport.');
    await viewport.page().mouse.click(
        box.x + clamp(x, 20, box.width - 20),
        box.y + clamp(y, 20, box.height - 20),
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
