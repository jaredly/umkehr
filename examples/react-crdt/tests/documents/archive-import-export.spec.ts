import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {exportCurrentDocument, importDocumentArchive} from '../helpers/documents';
import {addTodoInPanel, expectTodoOrder, todoPanel} from '../helpers/todos';

test('exports a solo archive and imports it in a fresh browser context', async ({
    browser,
}, testInfo) => {
    const sourceContext = await browser.newContext();
    const sourcePage = await sourceContext.newPage();
    const sourceDocId = uniqueTestDocId(testInfo, 'source');
    const importedTitle = `Imported archive task ${Date.now()}`;

    await openApp(sourcePage, {mode: 'solo', docId: sourceDocId});
    await addTodoInPanel(todoPanel(sourcePage, 'Todos'), importedTitle);
    await expectTodoOrder(todoPanel(sourcePage, 'Todos'), [
        'Write README',
        'Try CRDT sync',
        importedTitle,
    ]);

    const download = await exportCurrentDocument(sourcePage);
    const archivePath = testInfo.outputPath('exported-solo-archive.json');
    await download.saveAs(archivePath);
    await sourceContext.close();

    const importContext = await browser.newContext();
    const importPage = await importContext.newPage();
    await openApp(importPage, {mode: 'solo', docId: uniqueTestDocId(testInfo, 'import-target')});

    await importDocumentArchive(importPage, archivePath);
    await expect(importPage).toHaveURL(new RegExp(`doc=${sourceDocId}`));
    await expectTodoOrder(todoPanel(importPage, 'Todos'), [
        'Write README',
        'Try CRDT sync',
        importedTitle,
    ]);

    await importContext.close();
});
