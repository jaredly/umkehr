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
    const resolved = resolveVisibleRange(state, range);
    if (!resolved.ids.length) throw new Error('Cannot create rich text mark anchors for an empty range.');

    const start =
        preset === 'none' && range.start > 0
            ? ({type: 'after', opId: requiredId(resolved.previousId)} as const)
            : ({type: 'before', opId: requiredId(resolved.ids[0])} as const);
    const last = resolved.ids[resolved.ids.length - 1];
    const end =
        preset === 'inclusive'
            ? resolved.nextId
                ? ({type: 'before', opId: resolved.nextId} as const)
                : ({type: 'endOfText'} as const)
            : ({type: 'after', opId: requiredId(last)} as const);
    return {start, end};
}

export function insertionAfterIdForIndexPreservingBoundary(
    state: RichTextState,
    index: number,
): RichTextOpId | null {
    if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Cannot resolve rich text insertion index ${index}: index is out of range.`);
    }
    if (index === 0) return null;
    let visibleIndex = 0;
    let previousId: RichTextOpId | null = null;
    let previousIndex = -1;
    let nextIndex = state.chars.length;
    for (let i = 0; i < state.chars.length; i++) {
        const char = state.chars[i];
        if (!char || char.deleted) continue;
        if (visibleIndex === index) {
            nextIndex = i;
            break;
        }
        visibleIndex++;
        if (visibleIndex === index) {
            previousId = char.opId;
            previousIndex = i;
        }
    }
    if (!previousId) {
        throw new Error(`Cannot resolve rich text insertion index ${index}: index is out of range.`);
    }
    let boundaryId: RichTextOpId | null = null;
    for (let i = previousIndex + 1; i < nextIndex; i++) {
        const char = state.chars[i];
        if (char?.deleted && hasFormattingBoundary(char)) boundaryId = char.opId;
    }
    return boundaryId ?? previousId;
}

function resolveVisibleRange(state: RichTextState, range: RichTextIndexRange) {
    if (
        !Number.isInteger(range.start) ||
        !Number.isInteger(range.end) ||
        range.start < 0 ||
        range.end < range.start
    ) {
        throw new Error(
            `Cannot resolve rich text range ${range.start}:${range.end}: range is out of bounds.`,
        );
    }
    const ids: RichTextOpId[] = [];
    let visibleIndex = 0;
    let previousId: RichTextOpId | undefined;
    let nextId: RichTextOpId | undefined;
    for (const char of state.chars) {
        if (char.deleted) continue;
        if (visibleIndex === range.start - 1) previousId = char.opId;
        if (visibleIndex >= range.start && visibleIndex < range.end) ids.push(char.opId);
        if (visibleIndex === range.end) {
            nextId = char.opId;
            break;
        }
        visibleIndex++;
    }
    if (visibleIndex < range.end) {
        throw new Error(
            `Cannot resolve rich text range ${range.start}:${range.end}: range is out of bounds.`,
        );
    }
    return {ids, previousId, nextId};
}

function hasFormattingBoundary(char: {
    markOpsBefore?: unknown[] | undefined;
    markOpsAfter?: unknown[] | undefined;
}) {
    return Boolean(char.markOpsBefore || char.markOpsAfter);
}

function requiredId(id: RichTextOpId | undefined): RichTextOpId {
    if (!id) throw new Error('Cannot resolve rich text boundary: expected a visible opId.');
    return id;
}
