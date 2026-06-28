import {describe, expect, it} from 'vitest';
import {
    blockContents,
    cachedState,
    formattedMarkValues,
    materializeFormattedBlocks,
    rootBlockIds,
    visibleBlockChildren,
} from 'umkehr/block-crdt';
import {initialState} from 'umkehr/block-crdt/initialState';
import type {CachedState} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {createTable, insertText, pastePlainText, type CommandContext} from 'umkehr/block-editor';
import {ANNOTATION_MARK, annotationVirtualParents, createAnnotation, renderedAnnotations, setAnnotationBodyText} from 'umkehr/block-editor';
import {createDemoState, makeCommandContext} from './blockEditorRuntime';
import {caret, type EditorSelection} from 'umkehr/block-editor';
import {
    deleteBackwardEverywhere,
    deleteForwardEverywhere,
    extendSelectionsHorizontally,
    extendSelectionsVertically,
    indentSelections,
    insertTextEverywhere,
    insertTextWithMarksEverywhere,
    insertTextWithRetainedMarksEverywhere,
    moveSelectionsHorizontally,
    moveSelectionsVertically,
    pastePlainTextWithMarkdownShortcutsEverywhere,
    pasteRichClipboardEverywhere,
    setLinkMarkEverywhere,
    updateBlockStyleEverywhere,
    splitBlockEverywhere,
    toggleMarkEverywhere,
    unindentSelections,
    closeRetainedInlineMarkSessionsEverywhere,
} from 'umkehr/block-editor';
import {appendSelection, resolveSelectionSet, singleRetainedSelectionSet} from 'umkehr/block-editor';
import {serializeSelectionToClipboardPayload, type RichClipboardPayload} from 'umkehr/block-editor';
import type {RichBlockMeta} from 'umkehr/block-editor';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
    };
};

const init = () => cachedState(initialState('doc', '00000'));

const onlyBlock = (state: CachedState) => rootBlockIds(state)[0];

const range = (blockId: string, startOffset: number, endOffset: number): EditorSelection => ({
    type: 'range',
    anchor: {blockId, offset: startOffset},
    focus: {blockId, offset: endOffset},
});

const lines = (state: CachedState) => rootBlockIds(state).map((id) => blockContents(state, id));

const outline = (state: CachedState) =>
    materializeFormattedBlocks(state).map((block) => ({
        text: blockContents(state, block.id),
        depth: block.depth,
    }));

const annotationsFor = (state: CachedState<RichBlockMeta>) =>
    renderedAnnotations(
        state,
        materializeFormattedBlocks(state),
        materializeFormattedBlocks(state, annotationVirtualParents(state)),
    );

describe('block rich text multi-selection commands', () => {
    it('applies block style updates to selected blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = singleRetainedSelectionSet(pasted.state, {
            type: 'block',
            anchorBlockId: firstBlock,
            focusBlockId: secondBlock,
        });

        const result = updateBlockStyleEverywhere(pasted.state, set, 'background-color', 'gold', ctx());

        expect(result.ops.map((op) => op.type)).toEqual(['block:style', 'block:style']);
        expect(result.state.state.blocks[firstBlock].style['background-color']).toEqual({
            value: 'gold',
            ts: '0001-left',
        });
        expect(result.state.state.blocks[secondBlock].style['background-color']).toEqual({
            value: 'gold',
            ts: '0002-left',
        });
    });

    it('inserts text at two carets in one block', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = insertTextEverywhere(inserted.state, set, 'X', ctx());

        expect(lines(result.state)).toEqual(['aXbcXd']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 2),
            caret(blockId, 5),
        ]);
    });

    it('inserts text at carets in different blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 1), 'first'),
            caret(secondBlock, 1),
            'second',
        );

        const result = insertTextEverywhere(pasted.state, set, 'X', ctx());

        expect(lines(result.state)).toEqual(['aXb', 'cXd']);
    });

    it('pastes markdown shortcuts at multiple carets', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), '\n', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 0), 'first'),
            caret(secondBlock, 0),
            'second',
        );

        const result = pastePlainTextWithMarkdownShortcutsEverywhere(pasted.state, set, '- item', ctx());
        const ids = rootBlockIds(result.state);

        expect(lines(result.state)).toEqual(['item', 'item']);
        expect(result.state.state.blocks[ids[0]].meta).toMatchObject({type: 'list_item', kind: 'unordered'});
        expect(result.state.state.blocks[ids[1]].meta).toMatchObject({type: 'list_item', kind: 'unordered'});
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(ids[0], 4),
            caret(ids[1], 4),
        ]);
    });

    it('pastes rich clipboard marks and block metadata without markdown shortcuts', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: '- item',
            html: '<h2><strong>- item</strong></h2>',
            fragments: [
                {
                    text: '- item',
                    meta: {type: 'heading', level: 2, ts: 'heading-ts'},
                    marks: [{type: 'bold', startOffset: 0, endOffset: 6}],
                },
            ],
            annotations: [],
        };

        const result = pasteRichClipboardEverywhere(
            state,
            singleRetainedSelectionSet(state, caret(blockId, 0)),
            payload,
            ctx(),
        );

        const formatted = materializeFormattedBlocks(result.state)[0];
        expect(blockContents(result.state, formatted.id)).toBe('- item');
        expect(formatted.block.meta).toEqual({type: 'heading', level: 2, ts: 'heading-ts'});
        expect(formatted.runs).toEqual([{text: '- item', marks: {bold: true}}]);
    });

    it('pastes rich clipboard block style', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'styled',
            html: '<p>styled</p>',
            fragments: [
                {
                    text: 'styled',
                    meta: {type: 'paragraph', ts: 'paragraph-ts'},
                    style: {
                        color: 'tomato',
                        'background-color': '#fff3a0',
                        'font-size': 'large',
                    },
                    marks: [],
                },
            ],
            annotations: [],
        };

        const result = pasteRichClipboardEverywhere(
            state,
            singleRetainedSelectionSet(state, caret(blockId, 0)),
            payload,
            ctx(),
        );

        const formatted = materializeFormattedBlocks(result.state)[0];
        expect(blockContents(result.state, formatted.id)).toBe('styled');
        expect(formatted.block.style).toMatchObject({
            color: {value: 'tomato'},
            'background-color': {value: '#fff3a0'},
            'font-size': {value: 'large'},
        });
    });

    it('pastes rich clipboard links and multiple fragments as adjacent blocks', () => {
        const state = init();
        const blockId = onlyBlock(state);
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'one\ntwo',
            html: '<p>one</p><p><a href="https://example.test">two</a></p>',
            fragments: [
                {text: 'one', meta: {type: 'paragraph', ts: 'one-ts'}, marks: []},
                {
                    text: 'two',
                    meta: {type: 'paragraph', ts: 'two-ts'},
                    marks: [{type: 'link', startOffset: 0, endOffset: 3, data: 'https://example.test'}],
                },
            ],
            annotations: [],
        };

        const result = pasteRichClipboardEverywhere(
            state,
            singleRetainedSelectionSet(state, caret(blockId, 0)),
            payload,
            ctx(),
        );

        expect(lines(result.state)).toEqual(['one', 'two']);
        expect(materializeFormattedBlocks(result.state)[1].runs).toEqual([
            {text: 'two', marks: {link: 'https://example.test'}},
        ]);
    });

    it('pastes rich clipboard fragments as children of a single selected table cell', () => {
        const context = ctx();
        const state = init();
        const blockId = onlyBlock(state);
        let table = createTable(state, caret(blockId, 0), context, {rows: 1, columns: 1});
        const tableId = rootBlockIds(table.state).find((id) => table.state.state.blocks[id]?.meta.type === 'table')!;
        const rowId = visibleBlockChildren(table.state, tableId, annotationVirtualParents(table.state))[0];
        const cellId = visibleBlockChildren(table.state, rowId, annotationVirtualParents(table.state))[0];
        table = insertText(table.state, caret(cellId, 0), 'cell', context);
        const payload: RichClipboardPayload = {
            version: 1,
            plainText: 'one\ntwo',
            html: '<p>one</p><p><strong>two</strong></p>',
            fragments: [
                {text: 'one', meta: {type: 'paragraph', ts: 'one-ts'}, marks: []},
                {
                    text: 'two',
                    meta: {type: 'paragraph', ts: 'two-ts'},
                    marks: [{type: 'bold', startOffset: 0, endOffset: 3}],
                },
            ],
            annotations: [],
        };

        const result = pasteRichClipboardEverywhere(
            table.state,
            singleRetainedSelectionSet(table.state, {
                type: 'table-cells',
                tableId,
                anchorCellId: cellId,
                focusCellId: cellId,
            }),
            payload,
            context,
        );

        const childIds = visibleBlockChildren(result.state, cellId, annotationVirtualParents(result.state));
        expect(blockContents(result.state, cellId)).toBe('cell');
        expect(childIds.map((id) => blockContents(result.state, id))).toEqual(['one', 'two']);
        expect(materializeFormattedBlocks(result.state).find((block) => block.id === childIds[1])?.runs).toEqual([
            {text: 'two', marks: {bold: true}},
        ]);
        expect(resolveSelectionSet(result.state, result.selection).entries[0].selection).toEqual(caret(childIds[1], 3));
    });

    it('reuses an existing annotation when rich pasting inside the same document', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'hello', ctx());
        const annotated = createAnnotation(result.state, range(blockId, 1, 4), 'sidebar', makeCommandContext(demo.left));
        if (!annotated.annotationId || !annotated.bodyBlockId) throw new Error('missing annotation');
        result = setAnnotationBodyText(annotated.state, annotated.bodyBlockId, 'note', ctx());
        const payload = serializeSelectionToClipboardPayload(
            result.state,
            singleRetainedSelectionSet(result.state, range(blockId, 1, 4)),
        );
        if (!payload) throw new Error('missing payload');

        const pasted = pasteRichClipboardEverywhere(
            result.state,
            singleRetainedSelectionSet(result.state, caret(blockId, 5)),
            payload,
            ctx(),
        );

        const annotationId = lamportToString(annotated.annotationId);
        const annotationRuns = materializeFormattedBlocks(pasted.state, annotationVirtualParents(pasted.state))[0].runs;
        const pastedAnnotationIds = annotationRuns.flatMap((run) =>
            formattedMarkValues(run, ANNOTATION_MARK).map((value) =>
                typeof value === 'object' && value && 'id' in value
                    ? lamportToString((value as {id: [number, string]}).id)
                    : '',
            ),
        );
        expect(pastedAnnotationIds.every((id) => id === annotationId)).toBe(true);
        expect(annotationsFor(pasted.state)[0].bodyBlocks.map((body) => body.text)).toEqual(['note']);
    });

    it('imports annotations with fresh ids when rich pasting into another document', () => {
        const source = createDemoState();
        const sourceBlock = rootBlockIds(source.left.state)[0];
        let sourceResult = insertText(source.left.state, caret(sourceBlock, 0), 'hello', ctx());
        const annotated = createAnnotation(sourceResult.state, range(sourceBlock, 1, 4), 'sidebar', makeCommandContext(source.left));
        if (!annotated.annotationId || !annotated.bodyBlockId) throw new Error('missing annotation');
        sourceResult = setAnnotationBodyText(annotated.state, annotated.bodyBlockId, 'note', ctx());
        const payload = serializeSelectionToClipboardPayload(
            sourceResult.state,
            singleRetainedSelectionSet(sourceResult.state, range(sourceBlock, 1, 4)),
        );
        if (!payload) throw new Error('missing payload');

        const destination = init();
        const pasted = pasteRichClipboardEverywhere(
            destination,
            singleRetainedSelectionSet(destination, caret(onlyBlock(destination), 0)),
            payload,
            ctx('right'),
        );

        const annotation = annotationsFor(pasted.state)[0];
        expect(annotation.id).not.toBe(lamportToString(annotated.annotationId));
        expect(annotation.referenceText).toBe('ell');
        expect(annotation.bodyBlocks.map((body) => body.text)).toEqual(['note']);
    });

    it('inserts marked text at selected carets', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = insertTextWithMarksEverywhere(inserted.state, set, 'X', ['bold'], ctx());

        expect(materializeFormattedBlocks(result.state)[0].runs).toEqual([
            {text: 'a', marks: {}},
            {text: 'X', marks: {bold: true}},
            {text: 'bc', marks: {}},
            {text: 'X', marks: {bold: true}},
            {text: 'd', marks: {}},
        ]);
    });

    it('uses retained marks independently at multiple carets', () => {
        const context = ctx();
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', context);
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const first = insertTextWithRetainedMarksEverywhere(inserted.state, set, 'X', ['bold'], {}, context);
        const second = insertTextWithRetainedMarksEverywhere(
            first.state,
            first.selection,
            'Y',
            ['bold'],
            first.retainedMarks,
            context,
        );
        const closed = closeRetainedInlineMarkSessionsEverywhere(
            second.state,
            second.selection,
            second.retainedMarks,
            'bold',
            context,
        );

        expect(first.ops.filter((op) => op.type === 'mark')).toHaveLength(2);
        expect(second.ops.filter((op) => op.type === 'mark')).toHaveLength(0);
        expect(closed.ops.filter((op) => op.type === 'mark')).toHaveLength(4);
        expect(materializeFormattedBlocks(closed.state)[0].runs).toEqual([
            {text: 'a', marks: {}},
            {text: 'XY', marks: {bold: true}},
            {text: 'bc', marks: {}},
            {text: 'XY', marks: {bold: true}},
            {text: 'd', marks: {}},
        ]);
    });

    it('moves every selected caret horizontally', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = moveSelectionsHorizontally(inserted.state, set, 'right');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 2),
            caret(blockId, 4),
        ]);
    });

    it('moves every selected caret to block boundaries', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const left = moveSelectionsHorizontally(inserted.state, set, 'left', 'block');
        const right = moveSelectionsHorizontally(inserted.state, set, 'right', 'block');

        expect(resolveSelectionSet(left.state, left.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 0),
        ]);
        expect(resolveSelectionSet(right.state, right.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 4),
        ]);
    });

    it('moves every selected caret by word', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'one two three', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 5),
            'second',
        );

        const result = moveSelectionsHorizontally(inserted.state, set, 'right', 'word');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(blockId, 3),
            caret(blockId, 7),
        ]);
    });

    it('moves every selected caret across block boundaries', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 2), 'first'),
            caret(secondBlock, 0),
            'second',
        );

        const result = moveSelectionsHorizontally(pasted.state, set, 'right');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 0),
            caret(secondBlock, 1),
        ]);
    });

    it('moves every selected caret vertically to adjacent blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncdef\nx', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 2), 'first'),
            caret(secondBlock, 3),
            'second',
        );

        const result = moveSelectionsVertically(pasted.state, set, 'down');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 2),
            caret(thirdBlock, 1),
        ]);
    });

    it('extends every selected caret horizontally', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 1), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = extendSelectionsHorizontally(inserted.state, set, 'right');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            {
                type: 'range',
                anchor: {blockId, offset: 1},
                focus: {blockId, offset: 2},
            },
            {
                type: 'range',
                anchor: {blockId, offset: 3},
                focus: {blockId, offset: 4},
            },
        ]);
    });

    it('extends every selected caret vertically', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncdef\nx', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(firstBlock, 2), 'first'),
            caret(secondBlock, 3),
            'second',
        );

        const result = extendSelectionsVertically(pasted.state, set, 'down');

        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            {
                type: 'range',
                anchor: {blockId: firstBlock, offset: 2},
                focus: {blockId: secondBlock, offset: 2},
            },
            {
                type: 'range',
                anchor: {blockId: secondBlock, offset: 3},
                focus: {blockId: thirdBlock, offset: 1},
            },
        ]);
    });

    it('indents adjacent selected caret blocks without cascading them', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, caret(secondBlock, 1), 'first'),
            caret(thirdBlock, 1),
            'second',
        );

        const result = indentSelections(pasted.state, set, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
            {text: 'd', depth: 0},
        ]);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 1),
            caret(thirdBlock, 1),
        ]);
    });

    it('indents every block touched by a cross-block selection', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const set = singleRetainedSelectionSet(
            pasted.state,
            {
                type: 'range',
                anchor: {blockId: secondBlock, offset: 1},
                focus: {blockId: thirdBlock, offset: 1},
            },
            'range',
        );

        const result = indentSelections(pasted.state, set, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 1},
            {text: 'c', depth: 1},
            {text: 'd', depth: 0},
        ]);
    });

    it('unindents adjacent selected caret blocks without nesting them under each other', () => {
        const context = ctx();
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'a\nb\nc\nd', context);
        const [, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const indented = indentSelections(
            pasted.state,
            appendSelection(
                pasted.state,
                singleRetainedSelectionSet(pasted.state, caret(secondBlock, 1), 'first'),
                caret(thirdBlock, 1),
                'second',
            ),
            context,
        );

        const result = unindentSelections(indented.state, indented.selection, context);

        expect(outline(result.state)).toEqual([
            {text: 'a', depth: 0},
            {text: 'b', depth: 0},
            {text: 'c', depth: 0},
            {text: 'd', depth: 0},
        ]);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(secondBlock, 1),
            caret(thirdBlock, 1),
        ]);
    });

    it('replaces overlapping ranges once after merging', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', ctx());
        const blockId = onlyBlock(inserted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 1},
            focus: {blockId, offset: 4},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId, offset: 3},
            focus: {blockId, offset: 5},
        };
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, first, 'first'),
            second,
            'second',
        );

        const result = insertTextEverywhere(inserted.state, set, 'X', ctx());

        expect(lines(result.state)).toEqual(['aXf']);
    });

    it('deletes backward from adjacent same-block carets', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcd', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 2), 'first'),
            caret(blockId, 3),
            'second',
        );

        const result = deleteBackwardEverywhere(inserted.state, set, ctx());

        expect(lines(result.state)).toEqual(['ad']);
    });

    it('deletes a single retained cross-block range by joining blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 2},
            focus: {blockId: secondBlock, offset: 1},
        };
        const set = singleRetainedSelectionSet(pasted.state, selection, 'primary');

        const result = deleteBackwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['onwo']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(firstBlock, 2),
        ]);
    });

    it('deletes a boundary-only retained cross-block range by joining blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 3},
            focus: {blockId: secondBlock, offset: 0},
        };
        const set = singleRetainedSelectionSet(pasted.state, selection, 'primary');

        const result = deleteBackwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['onetwo']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(firstBlock, 3),
        ]);
    });

    it('deletes a single retained cross-block range forward by joining blocks', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'one\ntwo', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const selection: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 2},
            focus: {blockId: secondBlock, offset: 1},
        };
        const set = singleRetainedSelectionSet(pasted.state, selection, 'primary');

        const result = deleteForwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['onwo']);
        expect(resolveSelectionSet(result.state, result.selection).entries.map((entry) => entry.selection)).toEqual([
            caret(firstBlock, 2),
        ]);
    });

    it('merges overlapping cross-block ranges before deleting', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd\nef', ctx());
        const [firstBlock, secondBlock, thirdBlock] = rootBlockIds(pasted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 1},
            focus: {blockId: secondBlock, offset: 1},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId: secondBlock, offset: 0},
            focus: {blockId: thirdBlock, offset: 1},
        };
        const set = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, first, 'first'),
            second,
            'second',
        );

        const result = deleteBackwardEverywhere(pasted.state, set, ctx());

        expect(lines(result.state)).toEqual(['af']);
    });

    it('splits at two carets in one block', () => {
        const inserted = insertText(init(), caret(onlyBlock(init()), 0), 'abcdef', ctx());
        const blockId = onlyBlock(inserted.state);
        const set = appendSelection(
            inserted.state,
            singleRetainedSelectionSet(inserted.state, caret(blockId, 2), 'first'),
            caret(blockId, 4),
            'second',
        );

        const result = splitBlockEverywhere(inserted.state, set, ctx());

        expect(lines(result.state)).toEqual(['ab', 'cd', 'ef']);
    });

    it('toggles marks on all selected ranges and ignores carets', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 0},
            focus: {blockId: firstBlock, offset: 2},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId: secondBlock, offset: 0},
            focus: {blockId: secondBlock, offset: 2},
        };
        const withRange = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, first, 'first'),
            second,
            'second',
        );
        const withCaret = appendSelection(pasted.state, withRange, caret(firstBlock, 1), 'caret');

        const result = toggleMarkEverywhere(pasted.state, withCaret, 'bold', ctx());

        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {bold: true}}],
            [{text: 'cd', marks: {bold: true}}],
        ]);
    });

    it('sets links on all selected ranges and ignores carets', () => {
        const pasted = pastePlainText(init(), caret(onlyBlock(init()), 0), 'ab\ncd', ctx());
        const [firstBlock, secondBlock] = rootBlockIds(pasted.state);
        const first: EditorSelection = {
            type: 'range',
            anchor: {blockId: firstBlock, offset: 0},
            focus: {blockId: firstBlock, offset: 2},
        };
        const second: EditorSelection = {
            type: 'range',
            anchor: {blockId: secondBlock, offset: 0},
            focus: {blockId: secondBlock, offset: 2},
        };
        const withRange = appendSelection(
            pasted.state,
            singleRetainedSelectionSet(pasted.state, first, 'first'),
            second,
            'second',
        );
        const withCaret = appendSelection(pasted.state, withRange, caret(firstBlock, 1), 'caret');

        const result = setLinkMarkEverywhere(pasted.state, withCaret, 'https://example.test', ctx());

        expect(materializeFormattedBlocks(result.state).map((block) => block.runs)).toEqual([
            [{text: 'ab', marks: {link: 'https://example.test'}}],
            [{text: 'cd', marks: {link: 'https://example.test'}}],
        ]);
    });

    it('moves horizontally through editable table row headers', () => {
        const context = ctx();
        const demo = createDemoState();
        let result = pastePlainText(demo.left.state, caret(rootBlockIds(demo.left.state)[0], 0), 'a\nb', context);
        let roots = rootBlockIds(result.state);
        const third = roots.find((id) => blockContents(result.state, id) === 'b')!;
        result = createTable(result.state, caret(third, 0), context, {rows: 1, columns: 1});
        roots = rootBlockIds(result.state);
        const tableId = roots.find((id) => result.state.state.blocks[id]?.meta.type === 'table')!;
        const row = visibleBlockChildren(result.state, tableId, annotationVirtualParents(result.state))[0];
        result = insertText(result.state, caret(row, 0), 'row', context);

        const cell = visibleBlockChildren(result.state, row, annotationVirtualParents(result.state))[0];

        let moved = moveSelectionsHorizontally(
            result.state,
            singleRetainedSelectionSet(result.state, caret(tableId, 0)),
            'right',
        );
        expect(resolveSelectionSet(moved.state, moved.selection).entries[0].selection).toEqual(caret(row, 0));

        moved = moveSelectionsHorizontally(
            result.state,
            singleRetainedSelectionSet(result.state, caret(cell, 0)),
            'left',
        );
        expect(resolveSelectionSet(moved.state, moved.selection).entries[0].selection).toEqual(caret(row, 3));
    });
});
