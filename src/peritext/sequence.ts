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
    if (state.chars.some((char) => char.opId === operation.opId)) return state;
    if (operation.afterId !== null && !state.chars.some((char) => char.opId === operation.afterId)) {
        throw new Error(`Cannot apply rich text insert: afterId "${operation.afterId}" is missing.`);
    }
    const inserted = {
        opId: operation.opId,
        afterId: operation.afterId,
        char: operation.char,
        deleted: false,
    };
    const chars = state.chars.slice();
    chars.splice(insertionIndexForInsert(state.chars, inserted), 0, inserted);
    return {...state, chars, ...(state.pending?.length ? {pending: state.pending.slice()} : {})};
}

export function applyInsertMany(
    state: RichTextState,
    operations: readonly RichTextInsertOperation[],
): RichTextState {
    if (!operations.length) return state;
    validateInsertRun(state, operations);
    const inserted = operations.map((operation) => ({
        opId: operation.opId,
        afterId: operation.afterId,
        char: operation.char,
        deleted: false,
    }));
    const first = inserted[0];
    if (!first) return state;
    const chars = state.chars.slice();
    chars.splice(insertionIndexForInsert(state.chars, first), 0, ...inserted);
    return {...state, chars, ...(state.pending?.length ? {pending: state.pending.slice()} : {})};
}

export function applyRemove(state: RichTextState, operation: RichTextRemoveOperation): RichTextState {
    const index = state.chars.findIndex((char) => char.opId === operation.removedId);
    if (index === -1) {
        throw new Error(`Cannot apply rich text remove: removedId "${operation.removedId}" is missing.`);
    }
    const existing = state.chars[index];
    if (!existing || existing.deleted) return state;
    const chars = state.chars.slice();
    chars[index] = {...existing, deleted: true};
    return {...state, chars};
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
    if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Cannot resolve rich text insertion index ${index}: index is out of range.`);
    }
    if (index === 0) return null;
    let visibleIndex = 0;
    for (const char of state.chars) {
        if (char.deleted) continue;
        visibleIndex++;
        if (visibleIndex === index) return char.opId;
    }
    if (visibleIndex === index) return null;
    throw new Error(`Cannot resolve rich text insertion index ${index}: index is out of range.`);
}

export function charIdsForVisibleRange(state: RichTextState, range: RichTextIndexRange): RichTextOpId[] {
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
    for (const char of state.chars) {
        if (char.deleted) continue;
        if (visibleIndex >= range.start && visibleIndex < range.end) ids.push(char.opId);
        visibleIndex++;
        if (visibleIndex >= range.end) break;
    }
    if (visibleIndex < range.end) {
        throw new Error(
            `Cannot resolve rich text range ${range.start}:${range.end}: range is out of bounds.`,
        );
    }
    return ids;
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

function cloneChars(chars: RichTextCharMeta[]): RichTextCharMeta[] {
    return chars.map((char) => ({
        ...char,
        markOpsBefore: char.markOpsBefore?.slice(),
        markOpsAfter: char.markOpsAfter?.slice(),
    }));
}

function validateInsertRun(
    state: RichTextState,
    operations: readonly RichTextInsertOperation[],
) {
    const existingIds = new Set(state.chars.map((char) => char.opId));
    const runIds = new Set<RichTextOpId>();
    let previousId: RichTextOpId | null = null;
    operations.forEach((operation, index) => {
        if (operation.char.length !== 1) {
            throw new Error('Cannot apply rich text insert: operation char must be one character.');
        }
        if (existingIds.has(operation.opId) || runIds.has(operation.opId)) {
            throw new Error(`Cannot apply rich text insert run: duplicate opId "${operation.opId}".`);
        }
        const expectedAfterId = index === 0 ? operation.afterId : previousId;
        if (operation.afterId !== expectedAfterId) {
            throw new Error('Cannot apply rich text insert run: operations must be sequential.');
        }
        if (index === 0 && operation.afterId !== null && !existingIds.has(operation.afterId)) {
            throw new Error(`Cannot apply rich text insert: afterId "${operation.afterId}" is missing.`);
        }
        runIds.add(operation.opId);
        previousId = operation.opId;
    });
}

function insertionIndexForInsert(
    chars: readonly RichTextCharMeta[],
    inserted: RichTextCharMeta,
) {
    let parentIndex = -1;
    let previousSiblingIndex = -1;
    for (let index = 0; index < chars.length; index++) {
        const char = chars[index];
        if (!char) continue;
        if (char.opId === inserted.afterId) parentIndex = index;
        if (char.afterId !== inserted.afterId) continue;
        if (compareOpIds(inserted.opId, char.opId) > 0) return index;
        previousSiblingIndex = index;
    }
    if (previousSiblingIndex !== -1) {
        return subtreeEndIndex(chars, previousSiblingIndex);
    }
    return inserted.afterId === null ? 0 : parentIndex + 1;
}

function subtreeEndIndex(chars: readonly RichTextCharMeta[], rootIndex: number) {
    const root = chars[rootIndex];
    if (!root) return rootIndex;
    const byId = new Map(chars.map((char) => [char.opId, char]));
    let end = rootIndex + 1;
    while (end < chars.length && isDescendantOf(chars[end], root.opId, byId)) end++;
    return end;
}

function isDescendantOf(
    char: RichTextCharMeta | undefined,
    ancestorId: RichTextOpId,
    byId: ReadonlyMap<RichTextOpId, RichTextCharMeta>,
) {
    let afterId = char?.afterId;
    while (afterId !== null && afterId !== undefined) {
        if (afterId === ancestorId) return true;
        afterId = byId.get(afterId)?.afterId;
    }
    return false;
}
