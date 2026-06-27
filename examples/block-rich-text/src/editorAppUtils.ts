import type {DemoState, EditorId} from './blockEditorRuntime';
import type {RetainedSelectionSet} from './selectionSet';
import type {HistoryAction, HistoryKeystroke, HistoryState} from './history';
import {deriveUndoState} from './undoHistory';

export const actionsSharePrefix = (
    actions: HistoryAction[],
    prefix: HistoryAction[],
    length: number,
): boolean => {
    if (prefix.length < length || actions.length < length) return false;
    for (let index = 0; index < length; index++) {
        if (actions[index] !== prefix[index]) return false;
    }
    return true;
};

export const deriveToolbarUndoState = (
    history: HistoryState,
    editorId: EditorId,
): ReturnType<typeof deriveUndoState> => {
    const undoStack: string[] = [];
    const redoStack: string[] = [];
    const cursor = Math.max(0, Math.min(history.cursor, history.actions.length));

    for (const action of history.actions.slice(0, cursor)) {
        if (action.type !== 'local-change' || action.command?.actor !== editorId) continue;
        const command = action.command;
        if (command.intent === 'edit') {
            undoStack.push(command.id);
            redoStack.splice(0);
        } else if (command.intent === 'undo' && command.targetCommandId) {
            removeLast(undoStack, command.targetCommandId);
            redoStack.push(command.targetCommandId);
        } else if (command.intent === 'redo' && command.targetCommandId) {
            removeLast(redoStack, command.targetCommandId);
            undoStack.push(command.targetCommandId);
        }
    }

    return {canUndo: undoStack.length > 0, canRedo: redoStack.length > 0};
};

const removeLast = (items: string[], value: string) => {
    const index = items.lastIndexOf(value);
    if (index >= 0) items.splice(index, 1);
};

export const overlayTransientSelections = (
    demo: DemoState,
    selections: Partial<Record<EditorId, RetainedSelectionSet>>,
): DemoState => ({
    left: selections.left ? {...demo.left, selection: selections.left} : demo.left,
    right: selections.right ? {...demo.right, selection: selections.right} : demo.right,
});

export const formatKeystroke = (keystroke: HistoryKeystroke) => {
    const modifiers = [
        keystroke.metaKey ? 'Meta' : '',
        keystroke.ctrlKey ? 'Ctrl' : '',
        keystroke.altKey ? 'Alt' : '',
        keystroke.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    return [...modifiers, keystroke.key].join('+') + (keystroke.repeat ? ' repeat' : '');
};
