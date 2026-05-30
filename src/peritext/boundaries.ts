import {charIdsForVisibleRange, visibleChars} from './sequence.js';
import type {RichTextAnchor, RichTextOpId, RichTextState} from './types.js';
import type {RichTextIndexRange} from './sequence.js';

export type RichTextMarkPreset = 'inclusive' | 'exclusive' | 'none';

export type RichTextAnchorRange = {
    start: RichTextAnchor;
    end: RichTextAnchor;
};

export function anchorsForMarkRange(
    state: RichTextState,
    range: RichTextIndexRange,
    preset: RichTextMarkPreset,
): RichTextAnchorRange {
    const visible = visibleChars(state);
    const ids = charIdsForVisibleRange(state, range);
    if (!ids.length) throw new Error('Cannot create rich text mark anchors for an empty range.');

    const start =
        preset === 'none' && range.start > 0
            ? ({type: 'after', opId: visible[range.start - 1]?.opId} as const)
            : ({type: 'before', opId: ids[0]} as const);
    const last = ids[ids.length - 1];
    const end =
        preset === 'inclusive'
            ? range.end < visible.length
                ? ({type: 'before', opId: visible[range.end]?.opId} as const)
                : ({type: 'endOfText'} as const)
            : ({type: 'after', opId: last} as const);
    return {start, end};
}

export function insertionAfterIdForIndexPreservingBoundary(
    state: RichTextState,
    index: number,
): RichTextOpId | null {
    const visible = visibleChars(state);
    if (!Number.isInteger(index) || index < 0 || index > visible.length) {
        throw new Error(`Cannot resolve rich text insertion index ${index}: index is out of range.`);
    }
    if (index === 0) return null;
    const previous = visible[index - 1];
    if (!previous) return null;
    const previousIndex = state.chars.findIndex((char) => char.opId === previous.opId);
    const nextVisible = visible[index];
    const nextIndex = nextVisible
        ? state.chars.findIndex((char) => char.opId === nextVisible.opId)
        : state.chars.length;
    const tombstones = state.chars
        .slice(previousIndex + 1, nextIndex)
        .filter((char) => char.deleted && hasFormattingBoundary(char));
    return tombstones.at(-1)?.opId ?? previous.opId;
}

function hasFormattingBoundary(char: {
    markOpsBefore?: unknown[] | undefined;
    markOpsAfter?: unknown[] | undefined;
}) {
    return Boolean(char.markOpsBefore || char.markOpsAfter);
}
