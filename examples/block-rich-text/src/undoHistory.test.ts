import {describe, expect, it} from 'vitest';
import {materializeFormattedBlocks} from 'umkehr/block-crdt';
import {makeCommandContext, nextReplicaTs, type EditorId, type Replica} from './blockEditorRuntime';
import {
    appendHistoryAction,
    initialHistoryState,
    replayHistory,
    setHistoryCursor,
    type HistoryState,
} from './history';
import {
    deleteBackwardEverywhere,
    insertTextEverywhere,
    type MultiCommandResult,
} from './multiSelectionCommands';
import {deriveUndoState, createRedoAction, createUndoAction} from './undoHistory';

const appendEdit = (
    history: HistoryState,
    editorId: EditorId,
    command: (replica: Replica) => MultiCommandResult,
    label?: string,
): HistoryState => {
    const demo = replayHistory(history.actions, history.cursor);
    const replica = demo[editorId];
    const beforeSelection = replica.selection;
    const result = command(replica);
    if (!result.ops.length) return history;
    return appendHistoryAction(history, {
        type: 'local-change',
        editorId,
        ops: result.ops,
        selection: result.selection,
        command: {
            id: nextReplicaTs(replica),
            actor: editorId,
            intent: 'edit',
            beforeSelection,
            afterSelection: result.selection,
            label,
        },
    });
};

const appendActionResult = (
    history: HistoryState,
    result: ReturnType<typeof createUndoAction>,
): HistoryState => {
    expect('action' in result).toBe(true);
    if (!('action' in result)) return history;
    return appendHistoryAction(history, result.action);
};

const insert = (text: string) => (replica: Replica) =>
    insertTextEverywhere(replica.state, replica.selection, text, makeCommandContext(replica));

const backspace = () => (replica: Replica) =>
    deleteBackwardEverywhere(replica.state, replica.selection, makeCommandContext(replica));

const visibleText = (history: HistoryState, editorId: EditorId = 'left'): string[] =>
    materializeFormattedBlocks(replayHistory(history.actions, history.cursor)[editorId].state).map((block) =>
        block.runs.map((run) => run.text).join(''),
    );

describe('block rich text undo history', () => {
    it('derives undo availability from command metadata', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('a'));

        expect(deriveUndoState(history, 'left').canUndo).toBe(true);
        expect(deriveUndoState(history, 'right').canUndo).toBe(false);
    });

    it('creates undo and redo actions as forward local-change actions', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('ab'), 'insert ab');

        history = appendActionResult(history, createUndoAction(history, 'left'));
        expect(visibleText(history)).toEqual(['']);
        expect(deriveUndoState(history, 'left').canRedo).toBe(true);
        expect(history.actions.at(-1)?.type === 'local-change' ? history.actions.at(-1)?.command?.intent : null).toBe('undo');

        history = appendActionResult(history, createRedoAction(history, 'left'));
        expect(visibleText(history)).toEqual(['ab']);
        expect(history.actions.at(-1)?.type === 'local-change' ? history.actions.at(-1)?.command?.intent : null).toBe('redo');
    });

    it('keeps metadata-free actions replayable but not undoable', () => {
        let history = initialHistoryState();
        const demo = replayHistory(history.actions, history.cursor);
        const result = insert('a')(demo.left);
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: result.ops,
            selection: result.selection,
        });

        expect(visibleText(history)).toEqual(['a']);
        expect(deriveUndoState(history, 'left').canUndo).toBe(false);
    });

    it('does not let remote editor actions enter or clear local redo', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('a'));
        history = appendActionResult(history, createUndoAction(history, 'left'));
        expect(deriveUndoState(history, 'left').canRedo).toBe(true);

        history = appendEdit(history, 'right', insert('b'));

        expect(deriveUndoState(history, 'left').canRedo).toBe(true);
    });

    it('clears redo after a new local edit', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('a'));
        history = appendActionResult(history, createUndoAction(history, 'left'));
        expect(deriveUndoState(history, 'left').canRedo).toBe(true);

        history = appendEdit(history, 'left', insert('b'));

        expect(deriveUndoState(history, 'left').canRedo).toBe(false);
    });

    it('derives undo state from the scrubbed prefix and branches through appendHistoryAction', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('a'));
        history = appendEdit(history, 'left', insert('b'));
        history = setHistoryCursor(history, 1);

        expect(visibleText(history)).toEqual(['a']);
        history = appendActionResult(history, createUndoAction(history, 'left'));

        expect(history.actions).toHaveLength(2);
        expect(visibleText(history)).toEqual(['']);
    });

    it('supports undoing deletes with replacement chars', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('ab'));
        history = appendEdit(history, 'left', backspace());

        expect(visibleText(history)).toEqual(['a']);
        history = appendActionResult(history, createUndoAction(history, 'left'));

        expect(visibleText(history)).toEqual(['ab']);
    });
});
