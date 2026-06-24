import {describe, expect, it} from 'vitest';
import {materializeFormattedBlocks, rootBlockIds} from 'umkehr/block-crdt';
import {indentBlock, moveBlock} from './blockCommands';
import {makeCommandContext, nextReplicaTs, type EditorId, type Replica} from './blockEditorRuntime';
import * as hlc from '../../../src/crdt/hlc';
import {
    appendHistoryAction,
    appendHistoryKeystroke,
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
    pastePlainTextWithMarkdownShortcutsEverywhere,
    setBlockTypeEverywhere,
    splitBlockEverywhere,
    updateBlockMetaEverywhere,
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

const appendEditorCommand = (
    history: HistoryState,
    editorId: EditorId,
    command: (replica: Replica) => MultiCommandResult,
): HistoryState => {
    const demo = replayHistory(history.actions, history.cursor);
    const replica = demo[editorId];
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
            beforeSelection: replica.selection,
            afterSelection: result.selection,
        },
    });
};

const appendToggle = (history: HistoryState, editorId: EditorId): HistoryState =>
    appendHistoryAction(history, {type: 'toggle-online', editorId});

const visibleText = (replica: Replica): string[] =>
    materializeFormattedBlocks(replica.state).map((block) =>
        block.runs.map((run) => run.text).join(''),
    );

const visibleOutline = (replica: Replica): Array<{text: string; depth: number}> =>
    materializeFormattedBlocks(replica.state).map((block) => ({
        text: block.runs.map((run) => run.text).join(''),
        depth: block.depth,
    }));

const paste = (text: string) => (replica: Replica) =>
    pastePlainTextEverywhere(replica.state, replica.selection, text, makeCommandContext(replica));

const pasteMarkdown = (text: string) => (replica: Replica) =>
    pastePlainTextWithMarkdownShortcutsEverywhere(replica.state, replica.selection, text, makeCommandContext(replica));

const insert = (text: string) => (replica: Replica) =>
    insertTextEverywhere(replica.state, replica.selection, text, makeCommandContext(replica));

const split = () => (replica: Replica) =>
    splitBlockEverywhere(replica.state, replica.selection, makeCommandContext(replica));

const heading = () => (replica: Replica) => {
    const context = makeCommandContext(replica);
    return setBlockTypeEverywhere(replica.state, replica.selection, (_blockId, _meta) => ({
        type: 'heading',
        level: 2,
        ts: context.nextTs(),
    }));
};

const toggleTodo = () => (replica: Replica) =>
    updateBlockMetaEverywhere(
        replica.state,
        replica.selection,
        (meta, ts) => (meta.type === 'todo' ? {type: 'todo', checked: !meta.checked, ts} : meta),
        makeCommandContext(replica),
    );

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

    it('replays replace-document actions as a new document base', () => {
        const history = appendHistoryAction(initialHistoryState(), {
            type: 'replace-document',
            fixtureId: 'test-fixture',
            document: [
                {type: 'heading', meta: {level: 2}, content: 'Fixture title'},
                {content: 'Fixture body'},
            ],
        });

        expect(visibleText(replayHistory(history.actions, 0).left)).toEqual(['']);
        expect(visibleText(replayHistory(history.actions, 1).left)).toEqual(['Fixture title', 'Fixture body']);
        expect(visibleText(replayHistory(history.actions, 1).right)).toEqual(['Fixture title', 'Fixture body']);
    });

    it('applies local edits after a replace-document action', () => {
        let history = appendHistoryAction(initialHistoryState(), {
            type: 'replace-document',
            document: [{content: 'Base'}],
        });
        history = appendLocal(history, 'left', insert('!'));

        expect(visibleText(replayHistory(history.actions, history.cursor).left)).toEqual(['!Base']);
        expect(visibleText(replayHistory(history.actions, history.cursor).right)).toEqual(['!Base']);
    });

    it('treats pasted markdown shortcut conversion as one history action', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', pasteMarkdown('- item'));

        expect(history.actions).toHaveLength(1);
        expect(visibleText(replayHistory(history.actions, 0).left)).toEqual(['']);

        const replayed = replayHistory(history.actions, 1).left;
        const block = materializeFormattedBlocks(replayed.state)[0];
        expect(block.runs.map((run) => run.text).join('')).toBe('item');
        expect(block.block.meta).toMatchObject({type: 'list_item', kind: 'unordered'});
    });

    it('branches by dropping future actions when appending from the past', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', insert('a'));
        history = appendLocal(history, 'left', insert('b'));
        history = appendHistoryKeystroke(history, {
            editorId: 'left',
            blockId: 'block',
            key: 'ArrowLeft',
            code: 'ArrowLeft',
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            repeat: false,
        });
        history = setHistoryCursor(history, 1);
        history = appendLocal(history, 'left', insert('c'));

        expect(history.actions).toHaveLength(2);
        expect(history.cursor).toBe(2);
        expect(history.keystrokes).toHaveLength(0);
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
        history = appendHistoryKeystroke(history, {
            editorId: 'left',
            blockId: 'block',
            key: 'Enter',
            code: 'Enter',
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            repeat: false,
        });
        history = setHistoryCursor(history, 1);

        const parsed = parseHistoryExport(serializeHistory(history));

        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;
        expect(parsed.history.cursor).toBe(parsed.history.actions.length);
        expect(parsed.history.keystrokes).toEqual(history.keystrokes);
        expect(buildHistorySnapshot(replayHistory(parsed.history.actions, parsed.history.cursor))).toEqual(
            buildHistorySnapshot(replayHistory(history.actions, history.actions.length)),
        );
    });

    it('serializes and imports replace-document histories', () => {
        const history = appendHistoryAction(initialHistoryState(), {
            type: 'replace-document',
            fixtureId: 'preview-fixture',
            document: [
                {
                    type: 'preview',
                    meta: {url: 'https://example.test', preview: {title: 'Example'}},
                    content: 'Example',
                },
            ],
        });

        const parsed = parseHistoryExport(serializeHistory(history));

        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;
        expect(parsed.history.actions[0]).toMatchObject({
            type: 'replace-document',
            fixtureId: 'preview-fixture',
        });
        expect(visibleText(replayHistory(parsed.history.actions, parsed.history.cursor).left)).toEqual(['Example']);
    });

    it('serializes and imports replace-document histories with kanban blocks', () => {
        const history = appendHistoryAction(initialHistoryState(), {
            type: 'replace-document',
            fixtureId: 'kanban-fixture',
            document: [
                {
                    type: 'kanban',
                    content: 'Project board',
                    children: [
                        {content: 'todo', children: [{content: 'Draft proposal'}]},
                        {content: 'done'},
                    ],
                },
            ],
        });

        const parsed = parseHistoryExport(serializeHistory(history));

        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;
        expect(parsed.history.actions[0]).toMatchObject({
            type: 'replace-document',
            fixtureId: 'kanban-fixture',
        });
        expect(visibleOutline(replayHistory(parsed.history.actions, parsed.history.cursor).left)).toEqual([
            {text: 'Project board', depth: 0},
            {text: 'todo', depth: 1},
            {text: 'Draft proposal', depth: 2},
            {text: 'done', depth: 1},
        ]);
    });

    it('keeps replayed peer clocks ahead of imported block ids before a first remote reorder', () => {
        let history = initialHistoryState();
        for (const command of [
            insert('o'),
            insert('n'),
            insert('e'),
            split(),
            insert('t'),
            insert('w'),
            insert('o'),
            split(),
            insert('t'),
            insert('h'),
            insert('r'),
            insert('e'),
            insert('e'),
        ]) {
            history = appendEditorCommand(history, 'left', command);
        }
        const demo = replayHistory(history.actions);
        const [first, , third] = rootBlockIds(demo.right.state);
        const maxSeenBeforeMove = demo.right.state.state.maxSeenCount;

        const moved = moveBlock(
            demo.right.state,
            third,
            {type: 'before', targetBlockId: first},
            makeCommandContext(demo.right),
        );

        expect(visibleText({...demo.right, state: moved.state})).toEqual(['three', 'one', 'two']);
        expect(moved.ops).toHaveLength(1);
        expect(moved.ops[0].type).toBe('block:move');
        if (moved.ops[0].type !== 'block:move') return;
        expect(moved.ops[0].order.id[0]).toBeGreaterThan(maxSeenBeforeMove);
        const previousOrderTs = demo.right.state.state.blocks[third].order.ts;
        expect(typeof previousOrderTs).toBe('string');
        if (typeof previousOrderTs !== 'string') return;
        const previous = hlc.tryUnpack(previousOrderTs);
        const next = hlc.tryUnpack(moved.ops[0].order.ts);
        expect(previous).not.toBeNull();
        expect(next).toMatchObject({node: 'right'});
        expect(next && previous ? hlc.cmp(next, previous) : 0).toBeGreaterThan(0);
    });

    it('round-trips rich block metadata through export/import', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', heading());

        const parsed = parseHistoryExport(serializeHistory(history));

        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;
        const replayed = replayHistory(parsed.history.actions, parsed.history.cursor);
        expect(materializeFormattedBlocks(replayed.left.state)[0].block.meta).toMatchObject({
            type: 'heading',
            level: 2,
        });
        expect(hlc.tryUnpack(materializeFormattedBlocks(replayed.left.state)[0].block.meta.ts)).not.toBeNull();
    });

    it('replays todo toggle metadata through history', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', (replica) => {
            const context = makeCommandContext(replica);
            return setBlockTypeEverywhere(replica.state, replica.selection, (_blockId, _meta) => ({
                type: 'todo',
                checked: false,
                ts: context.nextTs(),
            }));
        });
        history = appendLocal(history, 'left', toggleTodo());

        const replayed = replayHistory(history.actions, history.cursor);

        expect(materializeFormattedBlocks(replayed.left.state)[0].block.meta).toMatchObject({
            type: 'todo',
            checked: true,
        });
        expect(materializeFormattedBlocks(replayed.right.state)[0].block.meta).toMatchObject({
            type: 'todo',
            checked: true,
        });
    });

    it('round-trips optional command metadata', () => {
        let history = initialHistoryState();
        const demo = replayHistory(history.actions, history.cursor);
        const result = insert('a')(demo.left);
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: result.ops,
            selection: result.selection,
            command: {
                id: '0010-left',
                actor: 'left',
                intent: 'edit',
                beforeSelection: demo.left.selection,
                afterSelection: result.selection,
                label: 'insert a',
            },
        });

        const parsed = parseHistoryExport(serializeHistory(history));

        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;
        const action = parsed.history.actions[0];
        expect(action.type === 'local-change' ? action.command : null).toEqual({
            id: '0010-left',
            actor: 'left',
            intent: 'edit',
            beforeSelection: demo.left.selection,
            afterSelection: result.selection,
            label: 'insert a',
        });
    });

    it('rejects invalid command metadata', () => {
        const selection = replayHistory([]).left.selection;
        const invalid = {
            version: 1,
            app: 'examples/block-rich-text',
            actions: [
                {
                    type: 'local-change',
                    editorId: 'left',
                    ops: [],
                    selection,
                    command: {
                        id: '0001-left',
                        actor: 'left',
                        intent: 'undo',
                        beforeSelection: selection,
                        afterSelection: selection,
                    },
                },
            ],
            keystrokes: [],
            finalSnapshot: buildHistorySnapshot(replayHistory([])),
        };

        const parsed = parseHistoryExport(JSON.stringify(invalid));

        expect('error' in parsed ? parsed.error : '').toContain('targetCommandId');
    });

    it('ignores legacy lamport-string command ids when replaying HLC clocks', () => {
        let history = initialHistoryState();
        const demo = replayHistory(history.actions, history.cursor);
        const result = insert('a')(demo.left);
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: result.ops,
            selection: result.selection,
            command: {
                id: '0010-left',
                actor: 'left',
                intent: 'edit',
                beforeSelection: demo.left.selection,
                afterSelection: result.selection,
            },
        });

        const replayed = replayHistory(history.actions, history.cursor);

        expect(replayed.left.clock).toEqual(hlc.init('left', 0));
        expect(hlc.tryUnpack(nextReplicaTs(replayed.left))).toMatchObject({node: 'left'});
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

    it('uses HLC timestamps and fresh Lamport ids after replay', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', insert('a'));

        const replayed = replayHistory(history.actions, history.cursor);
        const maxSeenBeforeSplit = replayed.left.state.state.maxSeenCount;

        const result = splitBlockEverywhere(
            replayed.left.state,
            replayed.left.selection,
            makeCommandContext(replayed.left),
        );

        const blockOp = result.ops.find((op) => op.type === 'block');
        expect(blockOp?.type).toBe('block');
        if (blockOp?.type !== 'block') return;
        expect(blockOp.block.id[0]).toBeGreaterThan(maxSeenBeforeSplit);
        expect(hlc.tryUnpack(blockOp.block.order.ts)).toMatchObject({node: 'left'});
    });

    it('replays left-editor indent attempts after offline sync', () => {
        let history = initialHistoryState();
        history = appendLocal(history, 'left', insert('Hello'));
        history = appendLocal(history, 'left', paste('\nOne'));
        history = appendToggle(history, 'left');
        history = appendLocal(history, 'right', (replica) => {
            const block = materializeFormattedBlocks(replica.state)[1];
            const text = block.runs.map((run) => run.text).join('');
            return pastePlainTextEverywhere(
                replica.state,
                replacePrimarySelection(replica.state, replica.selection, caret(block.id, text.length)),
                '\nTwo',
                makeCommandContext(replica),
            );
        });
        history = appendToggle(history, 'left');

        const synced = replayHistory(history.actions, history.cursor);
        const two = materializeFormattedBlocks(synced.left.state).find(
            (block) => block.runs.map((run) => run.text).join('') === 'Two',
        );
        expect(two).toBeTruthy();
        if (!two) return;

        history = appendLocal(history, 'left', (replica) => {
            const result = indentBlock(replica.state, two.id, makeCommandContext(replica));
            return {
                state: result.state,
                ops: result.ops,
                selection: replacePrimarySelection(result.state, replica.selection, result.selection),
            };
        });

        const demo = replayHistory(history.actions, history.cursor);

        expect(visibleOutline(demo.left)).toEqual([
            {text: 'Hello', depth: 0},
            {text: 'One', depth: 0},
            {text: 'Two', depth: 1},
        ]);
        expect(visibleOutline(demo.right)).toEqual([
            {text: 'Hello', depth: 0},
            {text: 'One', depth: 0},
            {text: 'Two', depth: 1},
        ]);
    });
});
