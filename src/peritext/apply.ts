import {applyMarkOperation} from './marks.js';
import {applyInsert, applyInsertMany, applyRemove} from './sequence.js';
import type {
    RichTextAnchor,
    RichTextInsertOperation,
    RichTextOperation,
    RichTextState,
} from './types.js';

export function applyRichTextOperation(
    state: RichTextState,
    operation: RichTextOperation,
): RichTextState {
    if (hasOperation(state, operation)) return state;
    const applied = applyOne(state, operation);
    if (applied.status === 'pending') {
        return {
            ...state,
            pending: [...(state.pending ?? []), operation],
        };
    }
    return retryPending({
        ...applied.state,
        ...(state.pending?.length ? {pending: state.pending.slice()} : {}),
    });
}

export function applyRichTextOperations(
    state: RichTextState,
    operations: readonly RichTextOperation[],
): RichTextState {
    let current = state;
    for (let index = 0; index < operations.length; index++) {
        const operation = operations[index];
        if (!operation) continue;
        const run = insertRunAt(current, operations, index);
        if (run.length > 1) {
            current = retryPending({
                ...applyInsertMany(current, run),
                ...(current.pending?.length ? {pending: current.pending.slice()} : {}),
            });
            index += run.length - 1;
            continue;
        }
        current = applyRichTextOperation(current, operation);
    }
    return current;
}

function applyOne(
    state: RichTextState,
    operation: RichTextOperation,
): {status: 'applied'; state: RichTextState} | {status: 'pending'} {
    switch (operation.action) {
        case 'insert':
            if (
                operation.afterId !== null &&
                !state.chars.some((char) => char.opId === operation.afterId)
            ) {
                return {status: 'pending'};
            }
            return {status: 'applied', state: applyInsert(state, operation)};
        case 'remove':
            if (!state.chars.some((char) => char.opId === operation.removedId)) {
                return {status: 'pending'};
            }
            return {status: 'applied', state: applyRemove(state, operation)};
        case 'addMark':
        case 'removeMark': {
            const start = anchorOrder(state, operation.start);
            const end = anchorOrder(state, operation.end);
            if (start === null || end === null) return {status: 'pending'};
            if (start > end) {
                throw new Error('Cannot apply rich text mark: start anchor must be before end anchor.');
            }
            return {status: 'applied', state: applyMarkOperation(state, operation)};
        }
    }
}

function retryPending(state: RichTextState): RichTextState {
    let current = state;
    let changed = true;
    while (changed && current.pending?.length) {
        changed = false;
        const remaining: RichTextOperation[] = [];
        for (const operation of current.pending) {
            const applied = applyOne({...current, pending: undefined}, operation);
            if (applied.status === 'applied') {
                current = {...applied.state, pending: undefined};
                changed = true;
            } else {
                remaining.push(operation);
            }
        }
        current = remaining.length ? {...current, pending: remaining} : {...current, pending: undefined};
    }
    if (current.pending?.length) return current;
    const {pending: _pending, ...settled} = current;
    return settled;
}

function hasOperation(state: RichTextState, operation: RichTextOperation) {
    if (state.pending?.some((pending) => pending.opId === operation.opId)) return true;
    if (operation.action === 'insert') {
        return state.chars.some((char) => char.opId === operation.opId);
    }
    if (operation.action === 'remove') {
        return state.chars.some((char) => char.opId === operation.removedId && char.deleted);
    }
    return state.chars.some(
        (char) =>
            char.markOpsBefore?.some((op) => op.opId === operation.opId) ||
            char.markOpsAfter?.some((op) => op.opId === operation.opId),
    );
}

function insertRunAt(
    state: RichTextState,
    operations: readonly RichTextOperation[],
    start: number,
): RichTextInsertOperation[] {
    const first = operations[start];
    if (!first || first.action !== 'insert' || !canApplyInsertNow(state, first)) return [];
    const run = [first];
    const seen = new Set([first.opId]);
    for (let index = start + 1; index < operations.length; index++) {
        const operation = operations[index];
        const previous = run[run.length - 1];
        if (
            !operation ||
            !previous ||
            operation.action !== 'insert' ||
            operation.afterId !== previous.opId ||
            seen.has(operation.opId) ||
            state.chars.some((char) => char.opId === operation.opId)
        ) {
            break;
        }
        run.push(operation);
        seen.add(operation.opId);
    }
    return run;
}

function canApplyInsertNow(state: RichTextState, operation: RichTextInsertOperation) {
    if (state.chars.some((char) => char.opId === operation.opId)) return false;
    return operation.afterId === null || state.chars.some((char) => char.opId === operation.afterId);
}

function anchorOrder(state: RichTextState, anchor: RichTextAnchor) {
    if (anchor.type === 'startOfText') return -1;
    if (anchor.type === 'endOfText') return state.chars.length * 2;
    const index = state.chars.findIndex((char) => char.opId === anchor.opId);
    if (index === -1) return null;
    return index * 2 + (anchor.type === 'after' ? 1 : 0);
}
