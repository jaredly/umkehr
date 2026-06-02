import type {RichTextActorId, RichTextOpId, RichTextOperation, RichTextState} from './types.js';

export type ParsedRichTextOpId = {
    counter: number;
    actorId: RichTextActorId;
};

const OP_ID_RE = /^([0-9]+)@(.+:.+)$/;

export function parseOpId(input: string): ParsedRichTextOpId {
    const parsed = tryParseOpId(input);
    if (!parsed) throw new Error(`Invalid rich text opId "${input}".`);
    return parsed;
}

export function tryParseOpId(input: string): ParsedRichTextOpId | null {
    const match = OP_ID_RE.exec(input);
    if (!match) return null;
    const counter = Number(match[1]);
    if (!Number.isSafeInteger(counter) || counter < 0) {
        return null;
    }
    const actorId = match[2] as RichTextActorId;
    if (!isValidActorId(actorId)) return null;
    return {counter, actorId};
}

export function isRichTextOpId(input: string): input is RichTextOpId {
    return tryParseOpId(input) !== null;
}

export function formatOpId(counter: number, actorId: RichTextActorId): RichTextOpId {
    if (!Number.isSafeInteger(counter) || counter < 0) {
        throw new Error(`Invalid rich text opId counter "${counter}".`);
    }
    if (!isValidActorId(actorId)) throw new Error(`Invalid rich text actor id "${actorId}".`);
    return `${counter}@${actorId}`;
}

export function compareOpIds(a: RichTextOpId, b: RichTextOpId) {
    const left = parseOpId(a);
    const right = parseOpId(b);
    if (left.counter !== right.counter) return left.counter - right.counter;
    if (left.actorId === right.actorId) return 0;
    return left.actorId < right.actorId ? -1 : 1;
}

export function maxOpCounter(state: RichTextState): number {
    let max = 0;
    for (const char of state.chars) {
        max = Math.max(max, parseOpId(char.opId).counter);
        for (const op of char.markOpsBefore ?? []) max = Math.max(max, parseOpId(op.opId).counter);
        for (const op of char.markOpsAfter ?? []) max = Math.max(max, parseOpId(op.opId).counter);
    }
    for (const op of state.pending ?? []) max = Math.max(max, parseOpId(op.opId).counter);
    return max;
}

export function nextOpCounter(state: RichTextState) {
    return maxOpCounter(state) + 1;
}

export function allocateOpIds(
    state: RichTextState,
    actorId: RichTextActorId,
    count: number,
): RichTextOpId[] {
    if (!Number.isInteger(count) || count < 0) {
        throw new Error(`Cannot allocate rich text opIds: count must be a non-negative integer.`);
    }
    const start = nextOpCounter(state);
    return Array.from({length: count}, (_, index) => formatOpId(start + index, actorId));
}

export function operationOpIds(operation: RichTextOperation): RichTextOpId[] {
    return [operation.opId];
}

export function maxOpCounterAfterOperation(maxCounter: number, operation: RichTextOperation) {
    let max = maxCounter;
    for (const opId of operationOpIds(operation)) {
        max = Math.max(max, parseOpId(opId).counter);
    }
    return max;
}

function isValidActorId(input: string): input is RichTextActorId {
    const separator = input.indexOf(':');
    return separator > 0 && separator < input.length - 1 && !input.includes('@');
}
