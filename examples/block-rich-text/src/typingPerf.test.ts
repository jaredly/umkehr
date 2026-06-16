import {describe, expect, it} from 'vitest';
import {applyMany, blockContents, insertBlockOps, rootBlockIds, type Op} from 'umkehr/block-crdt';
import {insertText, pastePlainText, splitBlock} from './blockCommands';
import {applyLocalChange, createDemoState, makeCommandContext, type DemoState} from './blockEditorRuntime';
import {annotationVirtualParents} from './annotations';
import {paragraphMeta, type RichBlockMeta} from './blockMeta';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {replacePrimarySelection} from './selectionSet';
import {caret, type EditorSelection} from './selectionModel';
import {splitBlockEverywhere} from './multiSelectionCommands';

const typedText = (length: number): string =>
    Array.from({length}, (_, index) => String.fromCharCode(97 + (index % 26))).join('');

const blockLines = (blocks: number, blockLength: number): string[] =>
    Array.from({length: blocks}, (_, index) => typedText(blockLength).replace(/^./, String(index % 10)));

const typeCharacters = (demo: DemoState, text: string): DemoState => {
    let next = demo;
    let selection: EditorSelection = caret(rootBlockIds(next.left.state)[0], 0);
    for (const char of text) {
        const current = next.left;
        const result = insertText(current.state, selection, char, makeCommandContext(current));
        next = applyLocalChange(next, {
            editorId: 'left',
            state: result.state,
            selection: replacePrimarySelection(result.state, current.selection, result.selection),
            ops: result.ops,
        });
        selection = result.selection;
    }
    return next;
};

const createLargeDocument = (
    demo: DemoState,
    blockCount: number,
    blockLength: number,
): {demo: DemoState; blockIds: string[]} => {
    const context = makeCommandContext(demo.left);
    let state = demo.left.state;
    const ops: Array<Op<RichBlockMeta>> = [];

    const firstBlockId = rootBlockIds(state)[0];
    let inserted = insertText(state, caret(firstBlockId, 0), typedText(blockLength), context);
    state = inserted.state;
    ops.push(...inserted.ops);

    for (let index = 1; index < blockCount; index++) {
        const previousBlockId = rootBlockIds(state).at(-1);
        if (!previousBlockId) throw new Error('missing previous block');
        const blockOps = insertBlockOps(state, {
            actor: demo.left.actor,
            parent: [0, 'root'],
            before: state.state.blocks[previousBlockId].id,
            meta: paragraphMeta(context.nextTs()),
            ts: context.nextTs(),
            virtualParents: annotationVirtualParents(state),
        });
        state = applyMany(state, blockOps, annotationVirtualParents(state));
        ops.push(...blockOps);

        const blockOp = blockOps[0];
        if (!blockOp || blockOp.type !== 'block') throw new Error('missing inserted block op');
        const blockId = lamportToString(blockOp.block.id);
        inserted = insertText(state, caret(blockId, 0), typedText(blockLength), context);
        state = inserted.state;
        ops.push(...inserted.ops);
    }

    const nextDemo = applyLocalChange(demo, {
        editorId: 'left',
        state,
        selection: replacePrimarySelection(state, demo.left.selection, inserted.selection),
        ops,
    });
    return {demo: nextDemo, blockIds: rootBlockIds(nextDemo.left.state)};
};

describe('block rich text typing performance', () => {
    it('keeps a moderate sequential typing workload responsive', () => {
        const text = typedText(400);
        let demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        demo = applyLocalChange(demo, {
            editorId: 'left',
            state: demo.left.state,
            selection: replacePrimarySelection(demo.left.state, demo.left.selection, caret(blockId, 0)),
            ops: [],
        });

        const started = performance.now();
        demo = typeCharacters(demo, text);
        const elapsed = performance.now() - started;

        expect(blockContents(demo.left.state, blockId)).toBe(text);
        expect(blockContents(demo.right.state, blockId)).toBe(text);
        expect(elapsed).toBeLessThan(120);
    });

    it.skip('inserts one character into a 20 by 200 character document in less than 5ms', () => {
        const {demo, blockIds} = createLargeDocument(createDemoState(), 20, 200);
        const targetBlockId = blockIds[10];
        const selection = caret(targetBlockId, 100);

        const started = performance.now();
        const result = insertText(demo.left.state, selection, 'Z', makeCommandContext(demo.left));
        const elapsed = performance.now() - started;

        expect(blockContents(result.state, targetBlockId)).toHaveLength(201);
        expect(blockContents(result.state, targetBlockId)[100]).toBe('Z');
        expect(elapsed).toBeLessThan(5);
    }, 30_000);

    it('pastes 4000 characters as plain text in less than 20ms', () => {
        const demo = createDemoState();
        const lines = blockLines(20, 200);
        const blockId = rootBlockIds(demo.left.state)[0];

        const started = performance.now();
        const result = pastePlainText(
            demo.left.state,
            caret(blockId, 0),
            lines.join('\n'),
            makeCommandContext(demo.left),
        );
        const elapsed = performance.now() - started;

        expect(rootBlockIds(result.state)).toHaveLength(20);
        expect(rootBlockIds(result.state).map((id) => blockContents(result.state, id))).toEqual(lines);
        expect(elapsed).toBeLessThan(20);
    }, 30_000);

    it('splits at the end of the second 400 character pasted block in less than 50ms', () => {
        const demo = createDemoState();
        const lines = blockLines(2, 400);
        const blockId = rootBlockIds(demo.left.state)[0];
        const pasted = pastePlainText(
            demo.left.state,
            caret(blockId, 0),
            lines.join('\n'),
            makeCommandContext(demo.left),
        );
        const secondBlockId = rootBlockIds(pasted.state)[1];

        const started = performance.now();
        const result = splitBlock(pasted.state, caret(secondBlockId, 400), makeCommandContext(demo.left));
        const elapsed = performance.now() - started;

        expect(rootBlockIds(result.state)).toHaveLength(3);
        expect(rootBlockIds(result.state).map((id) => blockContents(result.state, id))).toEqual([
            lines[0],
            lines[1],
            '',
        ]);
        expect(elapsed).toBeLessThan(50);
    });

    it('splits everywhere at the end of the second 400 character pasted block in less than 50ms', () => {
        const demo = createDemoState();
        const lines = blockLines(2, 400);
        const blockId = rootBlockIds(demo.left.state)[0];
        const pasted = pastePlainText(
            demo.left.state,
            caret(blockId, 0),
            lines.join('\n'),
            makeCommandContext(demo.left),
        );
        const secondBlockId = rootBlockIds(pasted.state)[1];
        const selection = replacePrimarySelection(
            pasted.state,
            demo.left.selection,
            caret(secondBlockId, 400),
        );

        const started = performance.now();
        const result = splitBlockEverywhere(pasted.state, selection, makeCommandContext(demo.left));
        const elapsed = performance.now() - started;

        expect(rootBlockIds(result.state)).toHaveLength(3);
        expect(elapsed).toBeLessThan(50);
    });
});
