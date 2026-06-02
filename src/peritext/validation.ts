import {isRichTextOpId} from './ids.js';
import type {RichTextAnchor, RichTextOperation, RichTextState} from './types.js';

export type RichTextValidationIssue = {
    path: string;
    message: string;
    value?: unknown;
};

export type RichTextValidationResult =
    | {success: true; data: RichTextOperation}
    | {success: false; errors: RichTextValidationIssue[]};

export function validateRichTextOperation(
    input: unknown,
    state?: RichTextState,
): RichTextValidationResult {
    const errors: RichTextValidationIssue[] = [];
    if (!isRecord(input)) {
        return {success: false, errors: [{path: '<operation>', message: 'Operation must be an object.', value: input}]};
    }
    if (!isAction(input.action)) {
        errors.push({path: 'action', message: 'Unknown rich text operation action.', value: input.action});
        return {success: false, errors};
    }
    if (typeof input.opId !== 'string' || !isRichTextOpId(input.opId)) {
        errors.push({path: 'opId', message: 'Operation requires a valid opId.', value: input.opId});
    }

    switch (input.action) {
        case 'insert':
            if (input.afterId !== null && (typeof input.afterId !== 'string' || !isRichTextOpId(input.afterId))) {
                errors.push({path: 'afterId', message: 'Insert afterId must be null or a valid opId.', value: input.afterId});
            }
            if (typeof input.char !== 'string' || Array.from(input.char).length !== 1) {
                errors.push({path: 'char', message: 'Insert char must contain exactly one character.', value: input.char});
            }
            break;
        case 'remove':
            if (typeof input.removedId !== 'string' || !isRichTextOpId(input.removedId)) {
                errors.push({path: 'removedId', message: 'Remove requires a valid removedId.', value: input.removedId});
            }
            break;
        case 'addMark':
        case 'removeMark':
            validateAnchor(input.start, 'start', errors);
            validateAnchor(input.end, 'end', errors);
            if (typeof input.markType !== 'string' || input.markType.length === 0) {
                errors.push({path: 'markType', message: 'Mark operation requires a non-empty markType.', value: input.markType});
            }
            if (state && errors.length === 0) {
                const start = anchorOrder(state, input.start as RichTextAnchor);
                const end = anchorOrder(state, input.end as RichTextAnchor);
                if (start === null) errors.push({path: 'start', message: 'Start anchor references a missing opId.', value: input.start});
                if (end === null) errors.push({path: 'end', message: 'End anchor references a missing opId.', value: input.end});
                if (start !== null && end !== null && start > end) {
                    errors.push({path: 'start', message: 'Start anchor must be before end anchor.', value: input.start});
                }
            }
            break;
    }

    return errors.length ? {success: false, errors} : {success: true, data: input as RichTextOperation};
}

function validateAnchor(
    input: unknown,
    path: string,
    errors: RichTextValidationIssue[],
) {
    if (!isRecord(input)) {
        errors.push({path, message: 'Anchor must be an object.', value: input});
        return;
    }
    if (input.type === 'startOfText' || input.type === 'endOfText') return;
    if (input.type !== 'before' && input.type !== 'after') {
        errors.push({path: `${path}/type`, message: 'Anchor type is invalid.', value: input.type});
        return;
    }
    if (typeof input.opId !== 'string' || !isRichTextOpId(input.opId)) {
        errors.push({path: `${path}/opId`, message: 'Anchor requires a valid opId.', value: input.opId});
    }
}

function anchorOrder(state: RichTextState, anchor: RichTextAnchor) {
    if (anchor.type === 'startOfText') return -1;
    if (anchor.type === 'endOfText') return state.chars.length * 2;
    const index = state.chars.findIndex((char) => char.opId === anchor.opId);
    if (index === -1) return null;
    return index * 2 + (anchor.type === 'after' ? 1 : 0);
}

function isAction(input: unknown): input is RichTextOperation['action'] {
    return input === 'insert' || input === 'remove' || input === 'addMark' || input === 'removeMark';
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return Boolean(input && typeof input === 'object' && !Array.isArray(input));
}
