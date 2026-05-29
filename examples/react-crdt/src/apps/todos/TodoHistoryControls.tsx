import type {
    AppEditorContext,
    CrdtEditorContext,
    HistoryEditorContext,
} from '../../lib/crdtApp';
import type {TodoState} from './model';

export function UndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    readOnly: boolean;
}) {
    if (hasCrdtHistory(editor)) {
        return <CrdtUndoRedoButtons editor={editor} readOnly={readOnly} />;
    }
    if (hasHistory(editor)) {
        return <HistoryUndoRedoButtons editor={editor} readOnly={readOnly} />;
    }
    return null;
}

function CrdtUndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: CrdtEditorContext<TodoState, 'type', never>;
    readOnly: boolean;
}) {
    editor.useLocalHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function HistoryUndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState> & HistoryEditorContext<TodoState>;
    readOnly: boolean;
}) {
    editor.useHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function UndoRedoButtonPair({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    readOnly: boolean;
}) {
    return (
        <>
            <button
                type="button"
                onClick={() => editor.undo()}
                disabled={readOnly || !editor.canUndo()}
            >
                Undo
            </button>
            <button
                type="button"
                onClick={() => editor.redo()}
                disabled={readOnly || !editor.canRedo()}
            >
                Redo
            </button>
        </>
    );
}

function hasCrdtHistory(
    editor: AppEditorContext<TodoState>,
): editor is CrdtEditorContext<TodoState, 'type', never> {
    return 'useLocalHistory' in editor && typeof editor.useLocalHistory === 'function';
}

function hasHistory(
    editor: AppEditorContext<TodoState>,
): editor is AppEditorContext<TodoState> & HistoryEditorContext<TodoState> {
    return 'useHistory' in editor && typeof editor.useHistory === 'function';
}
