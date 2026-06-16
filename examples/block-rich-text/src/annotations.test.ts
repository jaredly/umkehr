import {describe, expect, it} from 'vitest';
import {
    applyMany,
    blockContents,
    markRangeOp,
    materializedBlockParent,
    materializeFormattedBlocks,
    rootBlockIds,
    visibleBlockChildren,
} from 'umkehr/block-crdt';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {parseLamportString} from 'umkehr/block-crdt/utils';
import {deleteBackward, insertText, splitBlock, type CommandContext} from './blockCommands';
import {applyLocalChange, createDemoState, makeCommandContext} from './blockEditorRuntime';
import {
    ANNOTATION_MARK,
    annotationVirtualParents,
    createAnnotation,
    replaceAnnotationBodySelection,
    renderedAnnotations,
    setAnnotationBodyText,
    toggleAnnotationBodyMark,
} from './annotations';
import {
    appendHistoryAction,
    initialHistoryState,
    parseHistoryExport,
    replayHistory,
    serializeHistory,
} from './history';
import {caret, type EditorSelection} from './selectionModel';

const ctx = (actor = 'left'): CommandContext => {
    let i = 1;
    return {
        actor,
        nextTs: () => lamportToString([i++, actor]),
    };
};

const annotationsFor = (state: ReturnType<typeof createDemoState>['left']['state']) =>
    renderedAnnotations(
        state,
        materializeFormattedBlocks(state),
        materializeFormattedBlocks(state, annotationVirtualParents(state)),
    );

const range = (
    blockId: string,
    startOffset: number,
    endOffset: number,
): EditorSelection => ({
    type: 'range',
    anchor: {blockId, offset: startOffset},
    focus: {blockId, offset: endOffset},
});

describe('block rich text annotations', () => {
    it('syncs annotation metadata and virtual body blocks to the peer replica', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        const typed = insertText(demo.left.state, caret(blockId, 0), 'hello', ctx());
        const annotated = createAnnotation(
            typed.state,
            range(blockId, 1, 4),
            'sidebar',
            makeCommandContext(demo.left),
        );

        const synced = applyLocalChange(
            applyLocalChange(demo, {
                editorId: 'left',
                state: typed.state,
                selection: demo.left.selection,
                ops: typed.ops,
            }),
            {
                editorId: 'left',
                state: annotated.state,
                selection: demo.left.selection,
                ops: annotated.ops,
            },
        );
        const leftAnnotation = annotationsFor(synced.left.state)[0];
        const rightAnnotation = annotationsFor(synced.right.state)[0];
        const bodyId = leftAnnotation.bodyBlocks[0].id;

        expect(leftAnnotation.referenceText).toBe('ell');
        expect(rightAnnotation.referenceText).toBe('ell');
        expect(annotated.annotationId).toEqual(leftAnnotation.data.id);
        expect(annotated.bodyBlockId).toBe(bodyId);
        expect(materializedBlockParent(synced.left.state, bodyId, annotationVirtualParents(synced.left.state))).toEqual(
            leftAnnotation.data.id,
        );
        expect(visibleBlockChildren(synced.left.state, lamportToString(leftAnnotation.data.id), annotationVirtualParents(synced.left.state))).toEqual([
            bodyId,
        ]);
    });

    it('replays annotation body blocks through exported history', () => {
        let history = initialHistoryState();
        let demo = replayHistory(history.actions, history.cursor);
        const blockId = rootBlockIds(demo.left.state)[0];
        const typed = insertText(demo.left.state, caret(blockId, 0), 'hello', makeCommandContext(demo.left));
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: typed.ops,
            selection: demo.left.selection,
        });

        demo = replayHistory(history.actions, history.cursor);
        const annotated = createAnnotation(
            demo.left.state,
            range(rootBlockIds(demo.left.state)[0], 0, 5),
            'sidebar',
            makeCommandContext(demo.left),
        );
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: annotated.ops,
            selection: demo.left.selection,
        });

        demo = replayHistory(history.actions, history.cursor);
        const bodyId = annotationsFor(demo.left.state)[0].bodyBlocks[0].id;
        const bodyText = setAnnotationBodyText(
            demo.left.state,
            bodyId,
            'comment body',
            makeCommandContext(demo.left),
        );
        history = appendHistoryAction(history, {
            type: 'local-change',
            editorId: 'left',
            ops: bodyText.ops,
            selection: demo.left.selection,
        });

        const parsed = parseHistoryExport(serializeHistory(history));
        expect('history' in parsed).toBe(true);
        if (!('history' in parsed)) return;

        const replayed = replayHistory(parsed.history.actions, parsed.history.cursor);
        const annotation = annotationsFor(replayed.left.state)[0];
        expect(annotation.bodyBlocks).toHaveLength(1);
        expect(annotation.bodyBlocks[0].text).toBe('comment body');
        expect(blockContents(replayed.right.state, annotation.bodyBlocks[0].id)).toBe('comment body');
    });

    it('keeps annotation marks across split and join', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'abcd', ctx());
        result = createAnnotation(result.state, range(blockId, 1, 3), 'sidebar', ctx());

        result = splitBlock(result.state, caret(blockId, 2), ctx());
        expect(annotationsFor(result.state)[0].referenceText).toBe('bc');

        const second = rootBlockIds(result.state)[1];
        result = deleteBackward(result.state, caret(second, 0), ctx());
        expect(annotationsFor(result.state)[0].referenceText).toBe('bc');
    });

    it('orders footnotes by visible reference order', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'first second', ctx());

        result = createAnnotation(result.state, range(blockId, 6, 12), 'footnote', ctx());
        result = createAnnotation(result.state, range(blockId, 0, 5), 'footnote', ctx());

        expect(annotationsFor(result.state).map((annotation) => annotation.referenceText)).toEqual([
            'first',
            'second',
        ]);
    });

    it('hides annotation bodies when the reference text is deleted', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'hello', ctx());
        result = createAnnotation(result.state, range(blockId, 1, 4), 'sidebar', ctx());
        expect(annotationsFor(result.state)).toHaveLength(1);

        result = deleteBackward(result.state, range(blockId, 1, 4), ctx());

        expect(annotationsFor(result.state)).toEqual([]);
    });

    it('uses one annotation mark type for sidebar comments, footnotes, and popovers', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'abc def ghi', ctx());

        result = createAnnotation(result.state, range(blockId, 0, 3), 'sidebar', ctx());
        result = createAnnotation(result.state, range(blockId, 4, 7), 'footnote', ctx());
        result = createAnnotation(result.state, range(blockId, 8, 11), 'popover', ctx());

        const marks = Object.values(result.state.state.marks).filter((mark) => mark.type === ANNOTATION_MARK);
        expect(marks).toHaveLength(3);
        expect(annotationsFor(result.state).map((annotation) => annotation.data.presentation)).toEqual([
            'sidebar',
            'footnote',
            'popover',
        ]);
    });

    it('materializes formatted annotation body runs under mark virtual parents', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'hello', ctx());
        result = createAnnotation(result.state, range(blockId, 0, 5), 'sidebar', ctx());
        const annotation = annotationsFor(result.state)[0];
        const bodyId = annotation.bodyBlocks[0].id;

        const bodyText = setAnnotationBodyText(result.state, bodyId, 'body', ctx());
        const markedBody = applyMany(bodyText.state, [
            markRangeOp(
                bodyText.state,
                parseLamportString(bodyId),
                0,
                4,
                'bold',
                true,
                false,
                [100, 'left'],
            ),
        ]);

        expect(annotationsFor(markedBody)[0].bodyBlocks[0].runs).toEqual([
            {text: 'body', marks: {bold: true}},
        ]);
    });

    it('edits annotation bodies as rich text CRDT blocks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'hello', ctx());
        result = createAnnotation(result.state, range(blockId, 0, 5), 'sidebar', ctx());
        const bodyId = annotationsFor(result.state)[0].bodyBlocks[0].id;

        result = replaceAnnotationBodySelection(result.state, caret(bodyId, 0), 'note', ctx());
        result = toggleAnnotationBodyMark(result.state, range(bodyId, 0, 4), 'italic', ctx());

        expect(annotationsFor(result.state)[0].bodyBlocks[0].runs).toEqual([
            {text: 'note', marks: {italic: true}},
        ]);
    });

    it('creates annotations over annotation body text', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'hello', ctx());
        result = createAnnotation(result.state, range(blockId, 0, 5), 'sidebar', ctx());
        const bodyId = annotationsFor(result.state)[0].bodyBlocks[0].id;
        result = replaceAnnotationBodySelection(result.state, caret(bodyId, 0), 'note', ctx());

        result = createAnnotation(result.state, range(bodyId, 1, 3), 'sidebar', ctx());

        expect(annotationsFor(result.state).map((annotation) => annotation.referenceText)).toEqual([
            'hello',
            'ot',
        ]);
    });

    it('renders overlapping annotation marks without newer marks hiding older marks', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'abcdef', ctx());

        result = createAnnotation(result.state, range(blockId, 1, 4), 'sidebar', ctx());
        result = createAnnotation(result.state, range(blockId, 2, 5), 'sidebar', ctx());

        expect(annotationsFor(result.state).map((annotation) => annotation.referenceText)).toEqual([
            'bcd',
            'cde',
        ]);
        expect(
            materializeFormattedBlocks(result.state, annotationVirtualParents(result.state))[0].runs,
        ).toEqual([
            {text: 'a', marks: {}},
            {text: 'b', marks: {}, stackedMarks: {annotation: [annotationsFor(result.state)[0].data]}},
            {text: 'cd', marks: {}, stackedMarks: {annotation: annotationsFor(result.state).map((annotation) => annotation.data)}},
            {text: 'e', marks: {}, stackedMarks: {annotation: [annotationsFor(result.state)[1].data]}},
            {text: 'f', marks: {}},
        ]);
    });

    it('adds a new body block instead of a new annotation mark for an exact overlap', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];
        let result = insertText(demo.left.state, caret(blockId, 0), 'abcdef', ctx());

        result = createAnnotation(result.state, range(blockId, 1, 4), 'sidebar', ctx());
        const firstAnnotationId = result.annotationId;
        const exact = createAnnotation(result.state, range(blockId, 1, 4), 'sidebar', ctx());
        result = exact;

        const annotations = annotationsFor(result.state);
        expect(annotations).toHaveLength(1);
        expect(annotations[0].referenceText).toBe('bcd');
        expect(annotations[0].bodyBlocks).toHaveLength(2);
        expect(exact.annotationId).toEqual(firstAnnotationId);
        expect(exact.bodyBlockId).toBe(annotations[0].bodyBlocks[1].id);
        expect(Object.values(result.state.state.marks).filter((mark) => mark.type === ANNOTATION_MARK)).toHaveLength(1);
    });

    it('returns null annotation ids when a selection cannot create an annotation', () => {
        const demo = createDemoState();
        const blockId = rootBlockIds(demo.left.state)[0];

        const result = createAnnotation(demo.left.state, caret(blockId, 0), 'sidebar', ctx());

        expect(result.ops).toEqual([]);
        expect(result.annotationId).toBeNull();
        expect(result.bodyBlockId).toBeNull();
    });
});
