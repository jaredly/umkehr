import {expect, test} from '@playwright/test';
import {openApp, uniqueTestDocId} from '../helpers/app';
import {
    closeDocumentManager,
    createDocument,
    createSeedDocument,
    deleteLocalDocument,
    openDocument,
    openDocumentByDocId,
} from '../helpers/documents';
import {addTodoInPanel, expectTodoOrder, todoPanel} from '../helpers/todos';
import {
    expectVisibleElementCount,
    openWhiteboardMode,
    uniqueWhiteboardDocId,
    whiteboardPanel,
} from '../helpers/whiteboard';

test('creates, switches, and deletes local todo documents', async ({page}, testInfo) => {
    const firstTitle = `Todo document A ${Date.now()}`;
    const secondTitle = `Todo document B ${Date.now()}`;
    await openApp(page, {mode: 'local', docId: uniqueTestDocId(testInfo, 'local-docs')});

    await createDocument(page, firstTitle);
    await createDocument(page, secondTitle);
    await closeDocumentManager(page);

    await openDocument(page, firstTitle);
    const leftPanel = todoPanel(page, 'Replica A');
    await addTodoInPanel(leftPanel, 'Document A task');
    await expectTodoOrder(leftPanel, ['Write README', 'Try CRDT sync', 'Document A task']);

    await openDocument(page, secondTitle);
    await expectTodoOrder(todoPanel(page, 'Replica A'), ['Write README', 'Try CRDT sync']);

    await deleteLocalDocument(page, firstTitle);
    await expect(page.getByTestId('document-manager-modal')).toBeVisible();
});

test('creates todo and whiteboard seed fixtures from the document manager', async ({
    page,
}, testInfo) => {
    await openApp(page, {mode: 'local', docId: uniqueTestDocId(testInfo, 'todo-seed')});
    await createSeedDocument(page, 'todos-small');
    await closeDocumentManager(page);
    await openDocument(page, 'Todos: small baseline');
    await expectTodoOrder(todoPanel(page, 'Replica A'), [
        'Create seed database',
        'Review seeded documents',
        'Switch documents from the dropdown',
        'Capture observations',
    ]);

    await openWhiteboardMode(page, 'local', uniqueWhiteboardDocId(testInfo, 'whiteboard-seed'));
    await createSeedDocument(page, 'whiteboard-element-editing');
    await closeDocumentManager(page);
    await openDocumentByDocId(page, 'whiteboard-element-editing');
    await expectVisibleElementCount(whiteboardPanel(page, 'Replica A'), 3);
});
