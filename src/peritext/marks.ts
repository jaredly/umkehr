import {compareOpIds, maxOpCounterAfterOperation} from './ids.js';
import type {
    RichTextAnchor,
    RichTextCharMeta,
    RichTextJsonValue,
    RichTextMarkOperation,
    RichTextState,
} from './types.js';

type AnchorPoint =
    | {kind: 'char'; index: number; side: 'before' | 'after'; order: number}
    | {kind: 'start'; order: number}
    | {kind: 'end'; order: number};

export function applyMarkOperation(state: RichTextState, operation: RichTextMarkOperation) {
    const chars = cloneChars(state.chars);
    if (hasMarkOperation(chars, operation.opId)) return {...state, chars};
    const start = anchorPoint(chars, operation.start);
    const end = anchorPoint(chars, operation.end);
    if (start.order > end.order) {
        throw new Error('Cannot apply rich text mark: start anchor must be before end anchor.');
    }

    const startSet = opSetAt(chars, start) ?? nearestPrecedingOpSet(chars, start.order);
    setOpSetAt(chars, start, addOperation(startSet, operation));

    for (const point of presentOpSetPoints(chars)) {
        if (point.order <= start.order || point.order >= end.order) continue;
        setOpSetAt(chars, point, addOperation(opSetAt(chars, point) ?? [], operation));
    }

    if (end.kind !== 'end' && !opSetAt(chars, end)) {
        const endSet = nearestPrecedingOpSet(chars, end.order).filter(
            (candidate) => candidate.opId !== operation.opId,
        );
        setOpSetAt(chars, end, endSet);
    }

    return {...state, chars, maxOpCounter: maxOpCounterAfterOperation(state, operation)};
}

export function marksForOperations(operations: readonly RichTextMarkOperation[]) {
    const byType = new Map<string, RichTextMarkOperation>();
    for (const operation of operations) {
        const previous = byType.get(operation.markType);
        if (!previous || compareOpIds(operation.opId, previous.opId) > 0) {
            byType.set(operation.markType, operation);
        }
    }
    const marks: Record<string, RichTextJsonValue> = {};
    for (const [markType, operation] of byType) {
        if (operation.action === 'addMark') marks[markType] = operation.value ?? true;
    }
    return Object.keys(marks).length ? marks : undefined;
}

export function opSetForChar(chars: readonly RichTextCharMeta[], index: number) {
    let active: RichTextMarkOperation[] = [];
    for (let i = 0; i <= index; i++) {
        active = chars[i]?.markOpsBefore ?? active;
        if (i === index) return active;
        active = chars[i]?.markOpsAfter ?? active;
    }
    return active;
}

function anchorPoint(chars: readonly RichTextCharMeta[], anchor: RichTextAnchor): AnchorPoint {
    switch (anchor.type) {
        case 'startOfText':
            return {kind: 'start', order: -1};
        case 'endOfText':
            return {kind: 'end', order: chars.length * 2};
        case 'before':
        case 'after': {
            const index = chars.findIndex((char) => char.opId === anchor.opId);
            if (index === -1) {
                throw new Error(`Cannot apply rich text mark: anchor opId "${anchor.opId}" is missing.`);
            }
            return {
                kind: 'char',
                index,
                side: anchor.type,
                order: index * 2 + (anchor.type === 'after' ? 1 : 0),
            };
        }
    }
}

function presentOpSetPoints(chars: readonly RichTextCharMeta[]): AnchorPoint[] {
    const points: AnchorPoint[] = [];
    chars.forEach((char, index) => {
        if (char.markOpsBefore) points.push({kind: 'char', index, side: 'before', order: index * 2});
        if (char.markOpsAfter)
            points.push({kind: 'char', index, side: 'after', order: index * 2 + 1});
    });
    return points.sort((a, b) => a.order - b.order);
}

function nearestPrecedingOpSet(chars: readonly RichTextCharMeta[], order: number) {
    let found: RichTextMarkOperation[] = [];
    for (const point of presentOpSetPoints(chars)) {
        if (point.order >= order) break;
        found = opSetAt(chars, point) ?? found;
    }
    return found.slice();
}

function opSetAt(chars: readonly RichTextCharMeta[], point: AnchorPoint) {
    if (point.kind !== 'char') return undefined;
    return point.side === 'before'
        ? chars[point.index]?.markOpsBefore
        : chars[point.index]?.markOpsAfter;
}

function setOpSetAt(chars: RichTextCharMeta[], point: AnchorPoint, operations: RichTextMarkOperation[]) {
    if (point.kind === 'start') {
        if (!chars[0]) return;
        chars[0].markOpsBefore = operations;
        return;
    }
    if (point.kind === 'end') return;
    if (point.side === 'before') chars[point.index].markOpsBefore = operations;
    else chars[point.index].markOpsAfter = operations;
}

function addOperation(
    operations: readonly RichTextMarkOperation[],
    operation: RichTextMarkOperation,
) {
    if (operations.some((candidate) => candidate.opId === operation.opId)) return operations.slice();
    return [...operations, operation].sort((a, b) => compareOpIds(a.opId, b.opId));
}

function hasMarkOperation(chars: readonly RichTextCharMeta[], opId: string) {
    return chars.some(
        (char) =>
            char.markOpsBefore?.some((operation) => operation.opId === opId) ||
            char.markOpsAfter?.some((operation) => operation.opId === opId),
    );
}

function cloneChars(chars: readonly RichTextCharMeta[]) {
    return chars.map((char) => ({
        ...char,
        markOpsBefore: char.markOpsBefore?.slice(),
        markOpsAfter: char.markOpsAfter?.slice(),
    }));
}
