import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {createDocument, openDocument} from '../helpers/documents';

test('contains jigsaw pieces and supports local canvas navigation', async ({page}, testInfo) => {
    const title = `Jigsaw smoke ${Date.now()}`;
    await openApp(page, {
        mode: 'solo',
        appId: 'jigsaw',
        docId: uniqueTestDocId(testInfo, 'jigsaw'),
    });
    await createDocument(page, title, {pieceCount: '12'});
    await openDocument(page, title);

    const panel = page.getByTestId('jigsaw-panel');
    const viewport = page.getByTestId('jigsaw-viewport');
    const canvas = page.getByTestId('jigsaw-canvas');
    const minimap = page.getByTestId('jigsaw-minimap');

    await expect(panel).toBeVisible();
    await expect(viewport).toBeVisible();
    await expect(minimap).toBeVisible();
    await expect(viewport).toHaveCSS('overflow', 'hidden');
    await expectNoPieceHitOutsideViewport(page);

    await panel.getByRole('button', {name: 'Reshuffle'}).click();
    await expectNoPieceHitOutsideViewport(page);

    const initialTransform = await canvas.evaluate((element) => getComputedStyle(element).transform);
    const viewportBox = await viewport.boundingBox();
    expect(viewportBox).toBeTruthy();
    await page.mouse.move(viewportBox!.x + viewportBox!.width / 2, viewportBox!.y + viewportBox!.height / 2);
    const initialScrollY = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(48, 36);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);
    await expect
        .poll(() => canvas.evaluate((element) => getComputedStyle(element).transform))
        .not.toBe(initialTransform);

    const pannedTransform = await canvas.evaluate((element) => getComputedStyle(element).transform);
    await viewport.dispatchEvent('wheel', {
        deltaX: 0,
        deltaY: -120,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    });
    await expect
        .poll(() => canvas.evaluate((element) => getComputedStyle(element).transform))
        .not.toBe(pannedTransform);

    const zoomedTransform = await canvas.evaluate((element) => getComputedStyle(element).transform);
    const minimapBox = await minimap.boundingBox();
    expect(minimapBox).toBeTruthy();
    await page.mouse.click(minimapBox!.x + minimapBox!.width * 0.25, minimapBox!.y + minimapBox!.height * 0.25);
    await expect
        .poll(() => canvas.evaluate((element) => getComputedStyle(element).transform))
        .not.toBe(zoomedTransform);

    const pieceLabel = await firstHitTestablePieceLabel(page);
    expect(pieceLabel).toBeTruthy();
    const piece = panel.getByRole('button', {name: pieceLabel!});
    const before = await piece.boundingBox();
    expect(before).toBeTruthy();
    await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await page.mouse.down();
    await page.mouse.move(before!.x + before!.width / 2 + 40, before!.y + before!.height / 2 + 24);
    await page.mouse.up();
    await expect
        .poll(async () => {
            const after = await piece.boundingBox();
            if (!after) return false;
            return Math.abs(after.x - before!.x) > 1 || Math.abs(after.y - before!.y) > 1;
        })
        .toBe(true);
});

test('requires creation options before opening a missing jigsaw document', async ({page}, testInfo) => {
    const title = `Jigsaw options ${Date.now()}`;
    await openApp(page, {
        mode: 'solo',
        appId: 'jigsaw',
        docId: uniqueTestDocId(testInfo, 'missing-jigsaw'),
    });

    const modal = page.getByTestId('document-manager-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('jigsaw-panel')).toHaveCount(0);

    await createDocument(page, title, {pieceCount: '30'});
    await expect(page.getByTestId('jigsaw-panel')).toHaveCount(0);
    await openDocument(page, title);
    await expect(page.getByText('30 piece hue puzzle')).toBeVisible();
});

test('creates and opens a Voronoi jigsaw document', async ({page}, testInfo) => {
    const title = `Jigsaw Voronoi ${Date.now()}`;
    await openApp(page, {
        mode: 'solo',
        appId: 'jigsaw',
        docId: uniqueTestDocId(testInfo, 'jigsaw-voronoi'),
    });
    await createDocument(page, title, {pieceCount: '30', boardType: 'voronoi'});
    await openDocument(page, title);

    await expect(page.getByText('30 piece Voronoi hue puzzle')).toBeVisible();
    await expect(page.locator('.jigsawPiece')).toHaveCount(30);
    await expectNoPieceHitOutsideViewport(page);
});

test('opens the document manager when jigsaw has no current document', async ({page}) => {
    await openApp(page, {
        mode: 'solo',
        appId: 'jigsaw',
    });

    await expect(page.getByTestId('document-manager-modal')).toBeVisible();
    await expect(page.getByTestId('jigsaw-panel')).toHaveCount(0);
});

async function expectNoPieceHitOutsideViewport(page: import('@playwright/test').Page) {
    await expect
        .poll(async () =>
            page.evaluate(() => {
                const viewport = document.querySelector('[data-testid="jigsaw-viewport"]');
                if (!viewport) return false;
                const rect = viewport.getBoundingClientRect();
                const samples = [
                    {x: rect.left + rect.width / 2, y: rect.top - 8},
                    {x: rect.left - 8, y: rect.top + rect.height / 2},
                    {x: rect.right + 8, y: rect.top + rect.height / 2},
                    {x: rect.left + rect.width / 2, y: rect.bottom + 8},
                ];
                return samples.every(
                    (point) =>
                        !document
                            .elementsFromPoint(point.x, point.y)
                            .some((element) => element.classList.contains('jigsawPiece')),
                );
            }),
        )
        .toBe(true);
}

async function firstHitTestablePieceLabel(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const viewport = document.querySelector('[data-testid="jigsaw-viewport"]');
        if (!viewport) return null;
        const viewportRect = viewport.getBoundingClientRect();
        for (const piece of document.querySelectorAll<HTMLElement>('.jigsawPiece')) {
            const rect = piece.getBoundingClientRect();
            const center = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            };
            if (
                center.x < viewportRect.left ||
                center.x > viewportRect.right ||
                center.y < viewportRect.top ||
                center.y > viewportRect.bottom
            ) {
                continue;
            }
            if (!document.elementsFromPoint(center.x, center.y).includes(piece)) continue;
            return piece.getAttribute('aria-label');
        }
        return null;
    });
}
