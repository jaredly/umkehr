import {applyMarkOperation} from './marks.js';
import {maxOpCounterAfterOperation} from './ids.js';
import {applyInsert, applyRemove} from './sequence.js';
import type {RichTextAnchor, RichTextOperation, RichTextState} from './types.js';

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
            maxOpCounter: maxOpCounterAfterOperation(state, operation),
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
    return operations.reduce((current, operation) => applyRichTextOperation(current, operation), state);
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
    return current.pending?.length
        ? current
        : {
              chars: current.chars,
              ...(current.maxOpCounter !== undefined ? {maxOpCounter: current.maxOpCounter} : {}),
          };
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

function anchorOrder(state: RichTextState, anchor: RichTextAnchor) {
    if (anchor.type === 'startOfText') return -1;
    if (anchor.type === 'endOfText') return state.chars.length * 2;
    const index = state.chars.findIndex((char) => char.opId === anchor.opId);
    if (index === -1) return null;
    return index * 2 + (anchor.type === 'after' ? 1 : 0);
}
