import {applyMarkOperation} from './marks.js';
import {applyInsert, applyRemove} from './sequence.js';
import type {RichTextOperation, RichTextState} from './types.js';

export function applyRichTextOperation(
    state: RichTextState,
    operation: RichTextOperation,
): RichTextState {
    if (hasOperation(state, operation)) return cloneWithPending(state);
    const applied = applyOne(state, operation);
    if (applied.status === 'pending') {
        return {
            ...cloneWithPending(state),
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
    return operations.reduce((current, operation) => applyRichTextOperation(current, operation), state);
}

function applyOne(
    state: RichTextState,
    operation: RichTextOperation,
): {status: 'applied'; state: RichTextState} | {status: 'pending'} {
    switch (operation.action) {
        case 'insert':
            try {
                return {status: 'applied', state: applyInsert(state, operation)};
            } catch (error) {
                if (isMissingDependency(error)) return {status: 'pending'};
                throw error;
            }
        case 'remove':
            try {
                return {status: 'applied', state: applyRemove(state, operation)};
            } catch (error) {
                if (isMissingDependency(error)) return {status: 'pending'};
                throw error;
            }
        case 'addMark':
        case 'removeMark':
            try {
                return {status: 'applied', state: applyMarkOperation(state, operation)};
            } catch (error) {
                if (isMissingDependency(error)) return {status: 'pending'};
                throw error;
            }
    }
}

function retryPending(state: RichTextState): RichTextState {
    let current = cloneWithPending(state);
    let changed = true;
    while (changed && current.pending?.length) {
        changed = false;
        const remaining: RichTextOperation[] = [];
        for (const operation of current.pending) {
            const applied = applyOne({...current, pending: []}, operation);
            if (applied.status === 'applied') {
                current = {...applied.state, pending: []};
                changed = true;
            } else {
                remaining.push(operation);
            }
        }
        current = remaining.length ? {...current, pending: remaining} : {...current, pending: undefined};
    }
    return current.pending?.length ? current : {chars: current.chars};
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

function cloneWithPending(state: RichTextState): RichTextState {
    return {
        chars: state.chars.map((char) => ({
            ...char,
            markOpsBefore: char.markOpsBefore?.slice(),
            markOpsAfter: char.markOpsAfter?.slice(),
        })),
        ...(state.pending?.length ? {pending: state.pending.slice()} : {}),
    };
}

function isMissingDependency(error: unknown) {
    return (
        error instanceof Error && /\b(afterId|removedId|anchor opId)\b.*\bmissing\b/.test(error.message)
    );
}
