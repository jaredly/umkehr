import type {CrdtEditorContext, HistoryEditorContext} from '../../lib/crdtApp';
import type {WhiteboardEphemeralData, WhiteboardState} from './model';
import type {WhiteboardEditorContext} from './types';

export function UndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: WhiteboardEditorContext;
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
    editor: CrdtEditorContext<WhiteboardState, 'type', WhiteboardEphemeralData>;
    readOnly: boolean;
}) {
    editor.useLocalHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function HistoryUndoRedoButtons({
    editor,
    readOnly,
}: {
    editor: WhiteboardEditorContext & HistoryEditorContext<WhiteboardState>;
    readOnly: boolean;
}) {
    editor.useHistory();
    return <UndoRedoButtonPair editor={editor} readOnly={readOnly} />;
}

function UndoRedoButtonPair({
    editor,
    readOnly,
}: {
    editor: WhiteboardEditorContext;
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

function hasCrdtHistory(editor: WhiteboardEditorContext): editor is CrdtEditorContext<
    WhiteboardState,
    'type',
    WhiteboardEphemeralData
> {
    return 'useLocalHistory' in editor && typeof editor.useLocalHistory === 'function';
}

function hasHistory(editor: WhiteboardEditorContext): editor is WhiteboardEditorContext &
    HistoryEditorContext<WhiteboardState> {
    return 'useHistory' in editor && typeof editor.useHistory === 'function';
}
