import {compareOpIds} from './ids.js';
import type {
    RichTextCharMeta,
    RichTextInsertOperation,
    RichTextOpId,
    RichTextRemoveOperation,
    RichTextState,
} from './types.js';

export type RichTextIndexRange = {
    start: number;
    end: number;
};

export function emptyRichTextState(): RichTextState {
    return {chars: []};
}

export function applyInsert(state: RichTextState, operation: RichTextInsertOperation): RichTextState {
    if (operation.char.length !== 1) {
        throw new Error('Cannot apply rich text insert: operation char must be one character.');
    }
    if (state.chars.some((char) => char.opId === operation.opId)) return cloneState(state);
    if (operation.afterId !== null && !state.chars.some((char) => char.opId === operation.afterId)) {
        throw new Error(`Cannot apply rich text insert: afterId "${operation.afterId}" is missing.`);
    }
    return {
        chars: sortChars([
            ...cloneChars(state.chars),
            {
                opId: operation.opId,
                afterId: operation.afterId,
                char: operation.char,
                deleted: false,
            },
        ]),
    };
}

export function applyRemove(state: RichTextState, operation: RichTextRemoveOperation): RichTextState {
    let changed = false;
    const chars = cloneChars(state.chars).map((char) => {
        if (char.opId !== operation.removedId || char.deleted) return char;
        changed = true;
        return {...char, deleted: true};
    });
    if (!state.chars.some((char) => char.opId === operation.removedId)) {
        throw new Error(`Cannot apply rich text remove: removedId "${operation.removedId}" is missing.`);
    }
    return changed ? {...state, chars} : cloneState(state);
}

export function visibleChars(state: RichTextState) {
    return state.chars.filter((char) => !char.deleted);
}

export function plainText(state: RichTextState) {
    return visibleChars(state)
        .map((char) => char.char)
        .join('');
}

export function insertionAfterIdForIndex(state: RichTextState, index: number): RichTextOpId | null {
    const visible = visibleChars(state);
    if (!Number.isInteger(index) || index < 0 || index > visible.length) {
        throw new Error(`Cannot resolve rich text insertion index ${index}: index is out of range.`);
    }
    return index === 0 ? null : visible[index - 1]?.opId ?? null;
}

export function charIdsForVisibleRange(state: RichTextState, range: RichTextIndexRange): RichTextOpId[] {
    const visible = visibleChars(state);
    if (
        !Number.isInteger(range.start) ||
        !Number.isInteger(range.end) ||
        range.start < 0 ||
        range.end < range.start ||
        range.end > visible.length
    ) {
        throw new Error(
            `Cannot resolve rich text range ${range.start}:${range.end}: range is out of bounds.`,
        );
    }
    return visible.slice(range.start, range.end).map((char) => char.opId);
}

export function sortChars(chars: RichTextCharMeta[]): RichTextCharMeta[] {
    const byParent = new Map<RichTextOpId | null, RichTextCharMeta[]>();
    const ids = new Set(chars.map((char) => char.opId));
    for (const char of chars) {
        if (char.afterId !== null && !ids.has(char.afterId)) {
            throw new Error(`Cannot sort rich text chars: afterId "${char.afterId}" is missing.`);
        }
        const siblings = byParent.get(char.afterId) ?? [];
        siblings.push(char);
        byParent.set(char.afterId, siblings);
    }
    for (const siblings of byParent.values()) {
        siblings.sort((a, b) => compareOpIds(b.opId, a.opId));
    }

    const sorted: RichTextCharMeta[] = [];
    const visit = (parent: RichTextOpId | null) => {
        for (const child of byParent.get(parent) ?? []) {
            sorted.push(child);
            visit(child.opId);
        }
    };
    visit(null);
    if (sorted.length !== chars.length) {
        throw new Error('Cannot sort rich text chars: character graph contains a cycle.');
    }
    return sorted;
}

export function cloneState(state: RichTextState): RichTextState {
    return {
        chars: cloneChars(state.chars),
        ...(state.pending?.length ? {pending: state.pending.slice()} : {}),
    };
}

function cloneChars(chars: RichTextCharMeta[]) {
    return chars.map((char) => ({
        ...char,
        markOpsBefore: char.markOpsBefore?.slice(),
        markOpsAfter: char.markOpsAfter?.slice(),
    }));
}
