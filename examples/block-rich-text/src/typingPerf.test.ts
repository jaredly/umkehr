import {describe, expect, it} from 'vitest';
import {blockContents, rootBlockIds} from 'umkehr/block-crdt';
import {insertText} from './blockCommands';
import {applyLocalChange, createDemoState, makeCommandContext, type DemoState} from './blockEditorRuntime';
import {replacePrimarySelection} from './selectionSet';
import {caret, type EditorSelection} from './selectionModel';

const typedText = (length: number): string =>
    Array.from({length}, (_, index) => String.fromCharCode(97 + (index % 26))).join('');

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
});
