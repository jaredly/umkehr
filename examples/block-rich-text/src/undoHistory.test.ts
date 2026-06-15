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
    setBlockTypeEverywhere,
    splitBlockEverywhere,
    type MultiCommandResult,
} from './multiSelectionCommands';
import {deriveUndoState, createRedoAction, createUndoAction} from './undoHistory';
import {annotationVirtualParents, createAnnotation, renderedAnnotations} from './annotations';
import {primarySelection, replacePrimarySelection, resolveSelectionSet} from './selectionSet';

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

const quote = () => (replica: Replica) => {
    const context = makeCommandContext(replica);
    return setBlockTypeEverywhere(replica.state, replica.selection, (_blockId, _meta) => ({
        type: 'blockquote',
        ts: context.nextTs(),
    }));
};

const code = () => (replica: Replica) => {
    const context = makeCommandContext(replica);
    return setBlockTypeEverywhere(replica.state, replica.selection, (_blockId, meta) => ({
        type: 'code',
        language: meta.type === 'code' ? meta.language : '',
        ts: context.nextTs(),
    }));
};

const enter = () => (replica: Replica) =>
    splitBlockEverywhere(replica.state, replica.selection, makeCommandContext(replica));

const comment = () => (replica: Replica) => {
    const result = createAnnotation(
        replica.state,
        primarySelection(resolveSelectionSet(replica.state, replica.selection)),
        'sidebar',
        makeCommandContext(replica),
    );
    return {state: result.state, ops: result.ops, selection: replica.selection};
};

const visibleText = (history: HistoryState, editorId: EditorId = 'left'): string[] =>
    materializeFormattedBlocks(replayHistory(history.actions, history.cursor)[editorId].state).map((block) =>
        block.runs.map((run) => run.text).join(''),
    );

const annotationReferenceText = (history: HistoryState, editorId: EditorId = 'left'): string[] => {
    const state = replayHistory(history.actions, history.cursor)[editorId].state;
    return renderedAnnotations(
        state,
        materializeFormattedBlocks(state),
        materializeFormattedBlocks(state, annotationVirtualParents(state)),
    ).map((annotation) => annotation.referenceText);
};

describe('block rich text undo history', () => {
    it('derives undo availability from command metadata', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('a'));

        expect(deriveUndoState(history, 'left').canUndo).toBe(true);
        expect(deriveUndoState(history, 'right').canUndo).toBe(false);
    });

    it('derives undo availability after creating an annotation body block', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('hello'));

        let demo = replayHistory(history.actions, history.cursor);
        const blockId = materializeFormattedBlocks(demo.left.state)[0].id;
        demo = {
            ...demo,
            left: {
                ...demo.left,
                selection: replacePrimarySelection(
                    demo.left.state,
                    demo.left.selection,
                    {type: 'range', anchor: {blockId, offset: 1}, focus: {blockId, offset: 4}},
                ),
            },
        };
        const result = comment()(demo.left);
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: result.ops,
            selection: result.selection,
            command: {
                id: nextReplicaTs(demo.left),
                actor: 'left',
                intent: 'edit',
                beforeSelection: demo.left.selection,
                afterSelection: result.selection,
                label: 'comment',
            },
        });

        expect(() => deriveUndoState(history, 'left')).not.toThrow();
        expect(deriveUndoState(history, 'left').canUndo).toBe(true);
    });

    it('removes the annotation mark when undoing comment creation', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('hello'));

        let demo = replayHistory(history.actions, history.cursor);
        const blockId = materializeFormattedBlocks(demo.left.state)[0].id;
        demo = {
            ...demo,
            left: {
                ...demo.left,
                selection: replacePrimarySelection(
                    demo.left.state,
                    demo.left.selection,
                    {type: 'range', anchor: {blockId, offset: 1}, focus: {blockId, offset: 4}},
                ),
            },
        };
        const result = comment()(demo.left);
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: result.ops,
            selection: result.selection,
            command: {
                id: nextReplicaTs(demo.left),
                actor: 'left',
                intent: 'edit',
                beforeSelection: demo.left.selection,
                afterSelection: result.selection,
                label: 'comment',
            },
        });
        expect(annotationReferenceText(history)).toEqual(['ell']);

        history = appendActionResult(history, createUndoAction(history, 'left'));

        expect(visibleText(history)).toEqual(['hello']);
        expect(annotationReferenceText(history)).toEqual([]);
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

    it('keeps annotation marks anchored to the start of a restored deleted word', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('word'), 'insert word');

        let demo = replayHistory(history.actions, history.cursor);
        const blockId = materializeFormattedBlocks(demo.left.state)[0].id;
        demo = {
            ...demo,
            left: {
                ...demo.left,
                selection: replacePrimarySelection(
                    demo.left.state,
                    demo.left.selection,
                    {type: 'range', anchor: {blockId, offset: 0}, focus: {blockId, offset: 4}},
                ),
            },
        };
        const annotated = comment()(demo.left);
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: annotated.ops,
            selection: annotated.selection,
            command: {
                id: nextReplicaTs(demo.left),
                actor: 'left',
                intent: 'edit',
                beforeSelection: demo.left.selection,
                afterSelection: annotated.selection,
                label: 'comment',
            },
        });

        history = appendEdit(history, 'left', (replica) => {
            const selected = replacePrimarySelection(
                replica.state,
                replica.selection,
                {type: 'range', anchor: {blockId, offset: 0}, focus: {blockId, offset: 4}},
            );
            return deleteBackwardEverywhere(replica.state, selected, makeCommandContext(replica));
        }, 'delete word');
        expect(visibleText(history)).toEqual(['']);

        history = appendActionResult(history, createUndoAction(history, 'left'));

        expect(visibleText(history)).toEqual(['word']);
        expect(annotationReferenceText(history)).toEqual(['word']);
        expect(deriveUndoState(history, 'left')).toMatchObject({canUndo: true, canRedo: true});

        history = appendActionResult(history, createRedoAction(history, 'left'));
        expect(visibleText(history)).toEqual(['']);
        expect(annotationReferenceText(history)).toEqual([]);
    });

    it('supports undo and redo for block type changes', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', quote(), 'quote block');

        expect(
            materializeFormattedBlocks(replayHistory(history.actions, history.cursor).left.state)[0].block.meta,
        ).toMatchObject({type: 'blockquote'});

        history = appendActionResult(history, createUndoAction(history, 'left'));
        expect(
            materializeFormattedBlocks(replayHistory(history.actions, history.cursor).left.state)[0].block.meta,
        ).toMatchObject({type: 'paragraph'});

        history = appendActionResult(history, createRedoAction(history, 'left'));
        expect(
            materializeFormattedBlocks(replayHistory(history.actions, history.cursor).left.state)[0].block.meta,
        ).toMatchObject({type: 'blockquote'});
    });

    it('keeps undo available after undoing code block double-enter exit', () => {
        let history = initialHistoryState();
        history = appendEdit(history, 'left', insert('ab'), 'insert text');
        history = appendEdit(history, 'left', code(), 'code block');
        history = appendEdit(history, 'left', enter(), 'code newline');
        history = appendEdit(history, 'left', enter(), 'exit code');

        expect(visibleText(history)).toEqual(['ab', '']);

        history = appendActionResult(history, createUndoAction(history, 'left'));
        expect(visibleText(history)).toEqual(['ab\n']);
        expect(deriveUndoState(history, 'left').canUndo).toBe(true);

        history = appendActionResult(history, createUndoAction(history, 'left'));
        expect(visibleText(history)).toEqual(['ab']);
    });
});
