import {formatOpId, maxOpCounter} from './ids.js';
import {applyRichTextOperations} from './apply.js';
import {applyInsertMany, emptyRichTextState} from './sequence.js';
import type {
    RichTextActorId,
    RichTextImportSnapshot,
    RichTextInsertOperation,
    RichTextOperation,
    RichTextRenderView,
    RichTextSpan,
    RichTextState,
} from './types.js';

export function richTextSnapshotFromPlainText(text: string): RichTextImportSnapshot {
    return {spans: text ? [{text}] : []};
}

export function importRichTextSnapshot(
    snapshot: RichTextImportSnapshot,
    actorId: RichTextActorId,
): {operations: RichTextOperation[]; state: RichTextState} {
    validateSnapshot(snapshot);
    let state = emptyRichTextState();
    const operations: RichTextOperation[] = [];
    let afterId = null as RichTextOperation extends never ? never : RichTextOperation['opId'] | null;
    let counter = maxOpCounter(state) + 1;
    const spanRanges: {span: RichTextSpan; start: number; end: number}[] = [];
    let visibleIndex = 0;

    const insertOperations: RichTextInsertOperation[] = [];
    for (const span of snapshot.spans) {
        const start = visibleIndex;
        for (const char of Array.from(span.text)) {
            const opId = formatOpId(counter++, actorId);
            const operation: RichTextInsertOperation = {action: 'insert', opId, afterId, char};
            operations.push(operation);
            insertOperations.push(operation);
            afterId = opId;
            visibleIndex++;
        }
        spanRanges.push({span, start, end: visibleIndex});
    }
    state = applyInsertMany(state, insertOperations);

    for (const {span, start, end} of spanRanges) {
        if (!span.marks || start === end) continue;
        const chars = state.chars.filter((char) => !char.deleted);
        const first = chars[start];
        const last = chars[end - 1];
        if (!first || !last) continue;
        for (const [markType, value] of Object.entries(span.marks)) {
            const opId = formatOpId(counter++, actorId);
            const operation: RichTextOperation = {
                action: 'addMark',
                opId,
                start: {type: 'before', opId: first.opId},
                end: {type: 'after', opId: last.opId},
                markType,
                value,
            };
            operations.push(operation);
            state = applyRichTextOperations(state, [operation]);
        }
    }

    return {operations, state};
}

export function exportRichTextSnapshot(view: RichTextRenderView): RichTextImportSnapshot {
    return {spans: view.spans.map((span) => ({...span, marks: span.marks ? {...span.marks} : undefined}))};
}

function validateSnapshot(snapshot: RichTextImportSnapshot) {
    if (!snapshot || !Array.isArray(snapshot.spans)) {
        throw new Error('Invalid rich text snapshot: expected {spans: RichTextSpan[]}.');
    }
    for (const span of snapshot.spans) {
        if (typeof span.text !== 'string') {
            throw new Error('Invalid rich text snapshot: span text must be a string.');
        }
        if (span.marks !== undefined && (!span.marks || typeof span.marks !== 'object')) {
            throw new Error('Invalid rich text snapshot: span marks must be an object.');
        }
    }
}
