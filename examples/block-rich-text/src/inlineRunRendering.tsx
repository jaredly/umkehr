import type {CachedState, FormattedBlock} from 'umkehr/block-crdt';

import type {RichBlockMeta} from './blockMeta';
import type {PendingInlineMarks} from './blockEditorTypes';
import {
    focusPoint,
    normalizeSelectionSegments,
    segmentText,
    type EditorSelection,
} from './selectionModel';
import {
    CODE_MARK,
    isCodeMarkValue,
    type BareInlineMark,
    type BooleanInlineMark,
} from './inlineMarks';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;

const BOOLEAN_INLINE_MARKS: BooleanInlineMark[] = ['bold', 'italic', 'strikethrough'];
const BARE_INLINE_MARKS: BareInlineMark[] = [...BOOLEAN_INLINE_MARKS, CODE_MARK];

export const deriveActiveInlineMarks = (
    state: CachedState<RichBlockMeta>,
    blocks: RichFormattedBlock[],
    selection: EditorSelection,
    pendingMarks: PendingInlineMarks,
): PendingInlineMarks => {
    const result: PendingInlineMarks = {};
    for (const mark of BARE_INLINE_MARKS) {
        result[mark] =
            selection.type === 'caret'
                ? !!pendingMarks[mark] || caretInsertionHasInlineMark(blocks, selection.point, mark)
                : selectionHasInlineMark(state, blocks, selection, mark);
    }
    return result;
};

const selectionHasInlineMark = (
    state: CachedState<RichBlockMeta>,
    blocks: RichFormattedBlock[],
    selection: EditorSelection,
    markType: BareInlineMark,
): boolean => {
    if (selection.type === 'caret') return false;

    const segments = normalizeSelectionSegments(state, selection);
    if (!segments.length) return false;
    return segments.every((segment) => {
        const block = blocks.find((candidate) => candidate.id === segment.blockId);
        if (!block) return false;
        const marksByOffset = inlineMarksByOffset(block);
        const selected = marksByOffset.slice(segment.startOffset, segment.endOffset);
        return (
            selected.length > 0 &&
            selected.every((marks) =>
                markType === CODE_MARK ? isCodeMarkValue(marks[markType]) : marks[markType] === true,
            )
        );
    });
};

const caretInsertionHasInlineMark = (
    blocks: RichFormattedBlock[],
    point: ReturnType<typeof focusPoint>,
    markType: BareInlineMark,
): boolean => {
    const block = blocks.find((candidate) => candidate.id === point.blockId);
    if (!block) return false;
    const marksByOffset = inlineMarksByOffset(block);
    const value = marksByOffset[point.offset]?.[markType];
    return markType === CODE_MARK ? isCodeMarkValue(value) : value === true;
};

const inlineMarksByOffset = (block: RichFormattedBlock): Record<string, unknown>[] => {
    const result: Record<string, unknown>[] = [];
    for (const run of block.runs) {
        for (const _ of segmentText(run.text)) {
            result.push(run.marks);
        }
    }
    return result;
};
