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
    await expect(minimap.locator('svg path')).toHaveCount(12);
    const initialMinimapTransforms = await minimapPieceTransforms(minimap);
    await expect(viewport).toHaveCSS('overflow', 'hidden');
    await expectNoPieceHitOutsideViewport(page);

    await panel.getByRole('button', {name: 'Reshuffle'}).click();
    await expect(minimap.locator('svg path')).toHaveCount(12);
    await expect.poll(() => minimapPieceTransforms(minimap)).not.toEqual(initialMinimapTransforms);
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
    const piece = panel.getByRole('button', {name: pieceLabel!, exact: true});
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

test('renders torus pieces through wrapped sub-canvas interactions', async ({page}, testInfo) => {
    const title = `Jigsaw torus ${Date.now()}`;
    await openApp(page, {
        mode: 'solo',
        appId: 'jigsaw',
        docId: uniqueTestDocId(testInfo, 'jigsaw-torus'),
    });
    await createDocument(page, title, {pieceCount: '12', surface: 'torus'});
    await openDocument(page, title);

    const viewport = page.getByTestId('jigsaw-viewport');
    const torus = page.getByTestId('jigsaw-torus-viewport');
    const torusCanvas = page.getByTestId('jigsaw-torus-canvas');
    await expect(torus).toBeVisible();
    await expect(torusCanvas).toBeVisible();

    const pieceInfo = await firstHitTestableUnplacedPiece(page);
    expect(pieceInfo).toBeTruthy();
    const torusBox = await torus.boundingBox();
    expect(torusBox).toBeTruthy();
    await page.mouse.move(pieceInfo!.center.x, pieceInfo!.center.y);
    await page.mouse.down();
    await page.mouse.move(torusBox!.x + torusBox!.width / 2, torusBox!.y + 6, {steps: 8});
    await page.mouse.up();

    const torusCopies = torus.locator(`.jigsawPiece[data-piece="${pieceInfo!.piece}"]`);
    await expect.poll(() => torusCopies.count()).toBeGreaterThan(1);

    const shelvedPiece = await firstHitTestableUnplacedPiece(page);
    expect(shelvedPiece).toBeTruthy();
    await page.mouse.move(shelvedPiece!.center.x, shelvedPiece!.center.y);
    await page.mouse.down();
    await page.mouse.move(torusBox!.x + torusBox!.width + 42, torusBox!.y + torusBox!.height / 2, {steps: 8});
    await page.mouse.up();
    await expect(page.locator(`.jigsawCanvas > .jigsawPiece.placed[data-piece="${shelvedPiece!.piece}"]`)).toHaveCount(1);
    await expect(page.locator(`.jigsawCanvas > .jigsawPiece.unplaced[data-piece="${shelvedPiece!.piece}"]`)).toHaveCount(0);

    const unplaced = page.locator('.jigsawCanvas > .jigsawPiece.unplaced').first();
    const unplacedBefore = await unplaced.boundingBox();
    const placedBefore = await torusCopies.first().boundingBox();
    expect(unplacedBefore).toBeTruthy();
    expect(placedBefore).toBeTruthy();
    await page.mouse.move(torusBox!.x + torusBox!.width * 0.72, torusBox!.y + torusBox!.height * 0.72);
    await page.mouse.down();
    await page.mouse.move(torusBox!.x + torusBox!.width * 0.72, torusBox!.y + torusBox!.height * 0.58, {steps: 6});
    await page.mouse.up();
    await expect
        .poll(async () => {
            const after = await torusCopies.first().boundingBox();
            if (!after) return false;
            return Math.abs(after.y - placedBefore!.y) > 1;
        })
        .toBe(true);
    const unplacedAfter = await unplaced.boundingBox();
    expect(unplacedAfter).toBeTruthy();
    expect(Math.abs(unplacedAfter!.x - unplacedBefore!.x)).toBeLessThan(1);
    expect(Math.abs(unplacedAfter!.y - unplacedBefore!.y)).toBeLessThan(1);

    const placedAfterPan = await firstHitTestableTorusPieceCopy(page, pieceInfo!.piece);
    expect(placedAfterPan).toBeTruthy();
    await page.mouse.move(placedAfterPan!.center.x, placedAfterPan!.center.y);
    await page.mouse.down();
    await page.mouse.move(torusBox!.x + torusBox!.width + 36, torusBox!.y + torusBox!.height + 36, {steps: 8});
    await page.mouse.up();

    await expect.poll(() => torusCopies.count()).toBe(0);
    const outerPlaced = page.locator(`.jigsawCanvas > .jigsawPiece.placed[data-piece="${pieceInfo!.piece}"]`);
    await expect(outerPlaced).toHaveCount(1);
    await expect(page.locator(`.jigsawCanvas > .jigsawPiece.unplaced[data-piece="${pieceInfo!.piece}"]`)).toHaveCount(0);

    const outerPlacedBox = await outerPlaced.boundingBox();
    expect(outerPlacedBox).toBeTruthy();
    await page.mouse.move(
        outerPlacedBox!.x + outerPlacedBox!.width / 2,
        outerPlacedBox!.y + outerPlacedBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(torusBox!.x + torusBox!.width / 2, torusBox!.y + 8, {steps: 8});
    await page.mouse.up();

    await expect.poll(() => torusCopies.count()).toBeGreaterThan(1);
    await expect(outerPlaced).toHaveCount(0);
    await expectNoPieceHitOutsideViewport(page);
    await expect(viewport).toHaveCSS('overflow', 'hidden');
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

async function minimapPieceTransforms(minimap: import('@playwright/test').Locator) {
    return minimap.locator('svg path').evaluateAll((paths) =>
        paths.map((path) => path.getAttribute('transform') ?? ''),
    );
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

async function firstHitTestableUnplacedPiece(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const viewport = document.querySelector('[data-testid="jigsaw-viewport"]');
        if (!viewport) return null;
        const viewportRect = viewport.getBoundingClientRect();
        for (const piece of document.querySelectorAll<HTMLElement>('.jigsawCanvas > .jigsawPiece.unplaced')) {
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
            const pieceId = Number(piece.dataset.piece);
            if (!Number.isInteger(pieceId)) continue;
            return {piece: pieceId, center};
        }
        return null;
    });
}

async function firstHitTestableTorusPieceCopy(page: import('@playwright/test').Page, pieceId: number) {
    return page.evaluate((targetPiece) => {
        const torus = document.querySelector('[data-testid="jigsaw-torus-viewport"]');
        if (!torus) return null;
        const torusRect = torus.getBoundingClientRect();
        for (const piece of document.querySelectorAll<HTMLElement>(
            `.jigsawTorusViewport .jigsawPiece[data-piece="${targetPiece}"]`,
        )) {
            const rect = piece.getBoundingClientRect();
            const center = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            };
            if (
                center.x < torusRect.left ||
                center.x > torusRect.right ||
                center.y < torusRect.top ||
                center.y > torusRect.bottom
            ) {
                continue;
            }
            if (!document.elementsFromPoint(center.x, center.y).includes(piece)) continue;
            return {center};
        }
        return null;
    }, pieceId);
}
