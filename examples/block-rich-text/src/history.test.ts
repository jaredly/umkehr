import {describe, expect, it} from 'vitest';
import {materializeFormattedBlocks} from 'umkehr/block-crdt';
import {indentBlock} from './blockCommands';
import {makeCommandContext, type EditorId, type Replica} from './blockEditorRuntime';
import {
    appendHistoryAction,
    buildHistorySnapshot,
    initialHistoryState,
    parseHistoryExport,
    replayHistory,
    serializeHistory,
    setHistoryCursor,
    type HistoryState,
} from './history';
import {
    deleteBackwardEverywhere,
    insertTextEverywhere,
    pastePlainTextEverywhere,
    splitBlockEverywhere,
    type MultiCommandResult,
} from './multiSelectionCommands';
import {caret} from './selectionModel';
import {replacePrimarySelection} from './selectionSet';

const appendLocal = (
    history: HistoryState,
    editorId: EditorId,
    command: (replica: Replica) => MultiCommandResult,
): HistoryState => {
    const demo = replayHistory(history.actions, history.cursor);
    const result = command(demo[editorId]);
    if (!result.ops.length) return history;
    return appendHistoryAction(history, {
        type: 'local-change',
        editorId,
        ops: result.ops,
        selection: result.selection,
    });
};

const appendToggle = (history: HistoryState, editorId: EditorId): HistoryState =>
    appendHistoryAction(history, {type: 'toggle-online', editorId});

const visibleText = (replica: Replica): string[] =>
    materializeFormattedBlocks(replica.state).map((block) =>
        block.runs.map((run) => run.text).join(''),
    );

const paste = (text: string) => (replica: Replica) =>
    pastePlainTextEverywhere(replica.state, replica.selection, text, makeCommandContext(replica));

const insert = (text: string) => (replica: Replica) =>
    insertTextEverywhere(replica.state, replica.selection, text, makeCommandContext(replica));

describe('block rich text history', () => {
    it('replays local insert actions into both editors', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', insert('a'));
        history = appendLocal(history, 'left', insert('b'));

        const demo = replayHistory(history.actions, history.cursor);

        expect(visibleText(demo.left)).toEqual(['ab']);
        expect(visibleText(demo.right)).toEqual(['ab']);
    });

    it('replays offline queueing and later delivery', () => {
        let history = initialHistoryState();
        history = appendToggle(history, 'left');
        history = appendLocal(history, 'left', insert('x'));

        let demo = replayHistory(history.actions, history.cursor);
        expect(visibleText(demo.left)).toEqual(['x']);
        expect(visibleText(demo.right)).toEqual(['']);
        expect(demo.left.queue).toHaveLength(1);

        history = appendToggle(history, 'left');
        demo = replayHistory(history.actions, history.cursor);
        expect(visibleText(demo.right)).toEqual(['x']);
        expect(demo.left.queue).toHaveLength(0);
    });

    it('scrubs to intermediate cursors', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', insert('a'));
        history = appendLocal(history, 'left', insert('b'));

        expect(visibleText(replayHistory(history.actions, 0).left)).toEqual(['']);
        expect(visibleText(replayHistory(history.actions, 1).left)).toEqual(['a']);
        expect(visibleText(replayHistory(history.actions, 2).left)).toEqual(['ab']);
    });

    it('branches by dropping future actions when appending from the past', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', insert('a'));
        history = appendLocal(history, 'left', insert('b'));
        history = setHistoryCursor(history, 1);
        history = appendLocal(history, 'left', insert('c'));

        expect(history.actions).toHaveLength(2);
        expect(history.cursor).toBe(2);
        expect(visibleText(replayHistory(history.actions, history.cursor).left)).toEqual(['ac']);
    });

    it('does not append selection-only captures to history', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', (replica) => ({
            state: replica.state,
            ops: [],
            selection: replacePrimarySelection(
                replica.state,
                replica.selection,
                caret(materializeFormattedBlocks(replica.state)[0].id, 0),
            ),
        }));

        expect(history.actions).toHaveLength(0);
    });

    it('serializes with a final snapshot and imports at the end', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', paste('one\ntwo'));
        history = setHistoryCursor(history, 1);

        const parsed = parseHistoryExport(serializeHistory(history));

        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;
        expect(parsed.history.cursor).toBe(parsed.history.actions.length);
        expect(buildHistorySnapshot(replayHistory(parsed.history.actions, parsed.history.cursor))).toEqual(
            buildHistorySnapshot(replayHistory(history.actions, history.actions.length)),
        );
    });

    it('rejects malformed imports and removed block status ops', () => {
        expect(parseHistoryExport('{')).toEqual({error: 'Import file is not valid JSON.'});

        const invalid = {
            version: 1,
            app: 'examples/block-rich-text',
            actions: [
                {
                    type: 'local-change',
                    editorId: 'left',
                    ops: [{type: 'block:status', id: [1, 'left'], status: {}}],
                    selection: {primaryId: 'sel-0', entries: []},
                },
            ],
            finalSnapshot: buildHistorySnapshot(replayHistory([])),
        };

        const parsed = parseHistoryExport(JSON.stringify(invalid));
        expect('error' in parsed ? parsed.error : '').toContain('block:status');
    });

    it('imports histories with join records and nested block move paths', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', paste('one\ntwo'));

        const withBlocks = replayHistory(history.actions, history.cursor);
        const second = materializeFormattedBlocks(withBlocks.left.state)[1].id;
        history = appendLocal(history, 'left', (replica) => {
            const result = indentBlock(replica.state, second, makeCommandContext(replica));
            return {
                state: result.state,
                ops: result.ops,
                selection: replacePrimarySelection(replica.state, replica.selection, result.selection),
            };
        });
        history = appendLocal(history, 'left', (replica) => {
            const block = materializeFormattedBlocks(replica.state)[1];
            return deleteBackwardEverywhere(
                replica.state,
                replacePrimarySelection(replica.state, replica.selection, caret(block.id, 0)),
                makeCommandContext(replica),
            );
        });

        const opTypes = history.actions.flatMap((action) =>
            action.type === 'local-change' ? action.ops.map((op) => op.type) : [],
        );
        expect(opTypes).toContain('block:move');
        expect(opTypes).toContain('join-record');

        const parsed = parseHistoryExport(serializeHistory(history));
        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;
        expect(buildHistorySnapshot(replayHistory(parsed.history.actions))).toEqual(
            buildHistorySnapshot(replayHistory(history.actions)),
        );
    });

    it('advances actor clocks after replay so new edits use fresh timestamps', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', insert('a'));

        const replayed = replayHistory(history.actions, history.cursor);
        expect(replayed.left.clock).toBe(2);

        const result = splitBlockEverywhere(
            replayed.left.state,
            replayed.left.selection,
            makeCommandContext(replayed.left),
        );

        expect(JSON.stringify(result.ops)).toContain('left-00002');
        expect(JSON.stringify(result.ops)).not.toContain('left-00001');
    });
});
