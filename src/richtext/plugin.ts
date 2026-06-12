import {
    anchorsForMarkRange,
    charIdsForVisibleRange,
    emptyRichTextState,
    formatOpId,
    importRichTextSnapshot,
    insertionAfterIdForIndexPreservingBoundary,
} from '../peritext/index.js';
import {applyRichTextOperation} from '../peritext/apply.js';
import {maxOpCounterAfterOperation} from '../peritext/ids.js';
import {materializeRichTextState} from '../peritext/materialize.js';
import {validateRichTextOperation} from '../peritext/validation.js';
import {defineLeafBuilderExtension} from '../builderExtensions.js';
import * as hlc from '../crdt/hlc.js';
import {getMetaAtPath, normalPathForCrdtPath} from '../crdt/path.js';
import type {
    RichTextActorId,
    RichTextAnchor,
    RichTextImportSnapshot,
    RichTextJsonValue,
    RichTextOpId,
    RichTextOperation,
    RichTextState,
} from '../peritext/types.js';
import type {LeafCrdtPlugin} from '../crdt/plugins.js';
import type {
    CrdtDocument,
    CrdtPathSegment,
    CrdtUpdate,
    HlcTimestamp,
    JsonValue,
    LeafMeta,
} from '../crdt/types.js';
import type {BlockedEffect, LocalEffect} from '../crdt/history.js';

export const RICH_TEXT_LEAF_PLUGIN_ID = 'umkehr.rich-text';
export const RICH_TEXT_LEAF_PLUGIN_VERSION = 1;

export type RichTextLeafMeta = {
    maxOpCounter: number;
};

export type RichTextBuilderValue = {
    kind: 'rich-text';
    version: 1;
    chars: RichTextState['chars'];
    pending?: RichTextState['pending'];
};

export type RichTextIndexPosition = {index: number};
export type RichTextIndexRange = {start: number; end: number};
export type RichTextMarkPreset = 'inclusive' | 'exclusive' | 'none';

export type RichTextPatchChange =
    | {kind: 'insert'; at: RichTextIndexPosition; text: string}
    | {kind: 'delete'; range: RichTextIndexRange}
    | {
          kind: 'mark';
          range: RichTextIndexRange;
          markType: string;
          value: RichTextJsonValue;
          preset?: RichTextMarkPreset;
      }
    | {
          kind: 'unmark';
          range: RichTextIndexRange;
          markType: string;
          preset?: RichTextMarkPreset;
      }
    | {kind: 'replace'; snapshot: RichTextImportSnapshot};

export type RichTextInsertCommand = Omit<Extract<RichTextPatchChange, {kind: 'insert'}>, 'kind'>;
export type RichTextDeleteCommand = Omit<Extract<RichTextPatchChange, {kind: 'delete'}>, 'kind'>;
export type RichTextMarkCommand = Omit<Extract<RichTextPatchChange, {kind: 'mark'}>, 'kind'>;
export type RichTextUnmarkCommand = Omit<Extract<RichTextPatchChange, {kind: 'unmark'}>, 'kind'>;
export type RichTextReplaceCommand = Omit<Extract<RichTextPatchChange, {kind: 'replace'}>, 'kind'>;

export const richTextBuilderExtension = defineLeafBuilderExtension<
    RichTextBuilderValue,
    RichTextPatchChange
>()({
    key: '$text',
    plugin: RICH_TEXT_LEAF_PLUGIN_ID,
    commands: {
        insert: (
            change: RichTextInsertCommand,
        ): Extract<RichTextPatchChange, {kind: 'insert'}> => ({
            kind: 'insert',
            ...change,
        }),
        delete: (
            change: RichTextDeleteCommand,
        ): Extract<RichTextPatchChange, {kind: 'delete'}> => ({
            kind: 'delete',
            ...change,
        }),
        mark: (change: RichTextMarkCommand): Extract<RichTextPatchChange, {kind: 'mark'}> => ({
            kind: 'mark',
            ...change,
        }),
        unmark: (
            change: RichTextUnmarkCommand,
        ): Extract<RichTextPatchChange, {kind: 'unmark'}> => ({
            kind: 'unmark',
            ...change,
        }),
        replace: (
            change: RichTextReplaceCommand,
        ): Extract<RichTextPatchChange, {kind: 'replace'}> => ({
            kind: 'replace',
            ...change,
        }),
    },
});

export const richTextLeafPlugin: LeafCrdtPlugin<
    typeof RICH_TEXT_LEAF_PLUGIN_ID,
    JsonValue,
    RichTextPatchChange,
    JsonValue,
    JsonValue
> = {
    id: RICH_TEXT_LEAF_PLUGIN_ID,
    version: RICH_TEXT_LEAF_PLUGIN_VERSION,
    builder: richTextBuilderExtension,
    empty() {
        return {kind: 'rich-text', version: 1, ...emptyRichTextState()} as JsonValue;
    },
    isValue(value): value is JsonValue {
        return isRichTextState(value);
    },
    init({value}) {
        return {
            value: isRichTextState(value)
                ? (value as JsonValue)
                : ({kind: 'rich-text', version: 1, ...emptyRichTextState()} as JsonValue),
            meta: {maxOpCounter: 0},
        };
    },
    createOperations({value, meta, change, ts, context}) {
        return createRichTextOperations(
            value as RichTextState,
            meta as LeafMeta<RichTextLeafMeta>,
            change,
            richTextActorIdFromContext(ts, context.sessionId),
        ) as JsonValue[];
    },
    applyOperation({value, meta, operation}) {
        const next = applyRichTextOperation(value as RichTextState, operation as RichTextOperation);
        return {
            value: next as JsonValue,
            meta: {
                ...((meta.data as RichTextLeafMeta) ?? {maxOpCounter: 0}),
                maxOpCounter: maxOpCounterAfterOperation(
                    (meta.data as RichTextLeafMeta | undefined)?.maxOpCounter ?? 0,
                    operation as RichTextOperation,
                ),
            } as JsonValue,
        };
    },
    validateOperation(input) {
        const result = validateRichTextOperation(input);
        if (result.success) return {success: true, data: result.data as JsonValue};
        return {
            success: false,
            errors: result.errors.map((error) => ({
                path: error.path,
                message: error.message,
                value: error.value,
            })),
        };
    },
    createUndoOperations({doc, effect, ts}) {
        const update = createRichTextUndoUpdate(doc, effect, ts);
        return update ? [update] : [];
    },
    createRedoOperations({doc, effect, ts}) {
        const update = createRichTextRedoUpdate(doc, effect, ts);
        return update ? [update] : [];
    },
    checkEffect({doc, command, effect}) {
        return checkRichTextEffectTarget(doc, command, effect);
    },
};

function createRichTextOperations(
    state: RichTextState,
    meta: LeafMeta<RichTextLeafMeta>,
    change: RichTextPatchChange,
    actorId: RichTextActorId,
): RichTextOperation[] {
    switch (change.kind) {
        case 'insert': {
            let afterId = insertionAfterIdForIndexPreservingBoundary(state, change.at.index);
            const chars = Array.from(change.text);
            const opIds = allocateOpIdsFromMeta(meta.data.maxOpCounter, actorId, chars.length);
            return chars.map((char, index) => {
                const opId = opIds[index];
                if (!opId)
                    throw new Error('Cannot create rich text insert: missing allocated opId.');
                const operation: RichTextOperation = {action: 'insert', opId, afterId, char};
                afterId = opId;
                return operation;
            });
        }
        case 'delete': {
            const ids = charIdsForVisibleRange(state, change.range);
            const opIds = allocateOpIdsFromMeta(meta.data.maxOpCounter, actorId, ids.length);
            return ids.map((removedId, index) => {
                const opId = opIds[index];
                if (!opId)
                    throw new Error('Cannot create rich text remove: missing allocated opId.');
                return {action: 'remove', opId, removedId};
            });
        }
        case 'mark': {
            const [opId] = allocateOpIdsFromMeta(meta.data.maxOpCounter, actorId, 1);
            if (!opId) return [];
            return [
                {
                    action: 'addMark',
                    opId,
                    ...anchorsForMarkRange(state, change.range, change.preset ?? 'inclusive'),
                    markType: change.markType,
                    value: change.value,
                },
            ];
        }
        case 'unmark': {
            const [opId] = allocateOpIdsFromMeta(meta.data.maxOpCounter, actorId, 1);
            if (!opId) return [];
            return [
                {
                    action: 'removeMark',
                    opId,
                    ...anchorsForMarkRange(state, change.range, change.preset ?? 'inclusive'),
                    markType: change.markType,
                },
            ];
        }
        case 'replace': {
            const imported = importRichTextSnapshot(change.snapshot, actorId);
            const offset = meta.data.maxOpCounter;
            return imported.operations.map((operation) =>
                remapRichTextOperation(operation, offset),
            );
        }
    }
}

function allocateOpIdsFromMeta(maxOpCounter: number, actorId: RichTextActorId, count: number) {
    if (!Number.isInteger(count) || count < 0) {
        throw new Error(`Cannot allocate rich text opIds: count must be a non-negative integer.`);
    }
    return Array.from({length: count}, (_, index) => formatOpId(maxOpCounter + index + 1, actorId));
}

function remapRichTextOperation(operation: RichTextOperation, offset: number): RichTextOperation {
    const remapId = (id: RichTextOpId) => {
        const [counter, actorId] = id.split('@');
        return formatOpId(Number(counter) + offset, actorId as RichTextActorId);
    };
    const remapAnchor = (anchor: RichTextAnchor): RichTextAnchor => {
        if (anchor.type !== 'before' && anchor.type !== 'after') return anchor;
        return {...anchor, opId: remapId(anchor.opId)};
    };
    switch (operation.action) {
        case 'insert':
            return {
                ...operation,
                opId: remapId(operation.opId),
                afterId: operation.afterId ? remapId(operation.afterId) : null,
            };
        case 'remove':
            return {
                ...operation,
                opId: remapId(operation.opId),
                removedId: remapId(operation.removedId),
            };
        case 'addMark':
        case 'removeMark':
            return {
                ...operation,
                opId: remapId(operation.opId),
                start: remapAnchor(operation.start),
                end: remapAnchor(operation.end),
            };
    }
}

function richTextActorIdFromContext(_ts: HlcTimestamp, sessionId: string) {
    return `${sessionId}:main` as const;
}

function createRichTextUndoUpdate(
    doc: CrdtDocument<unknown>,
    effect: Extract<LocalEffect, {kind: 'leaf'}>,
    ts: HlcTimestamp,
): CrdtUpdate | null {
    const change = effect.change as RichTextOperation;
    const opId = nextRichTextOpId(doc, effect.path, ts);
    switch (change.action) {
        case 'insert':
            return {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: effect.path,
                ts,
                change: {action: 'remove', opId, removedId: change.opId} as JsonValue,
            };
        case 'remove': {
            const before = effect.before as RichTextState | undefined;
            const removed = before?.chars.find((char) => char.opId === change.removedId);
            if (!removed) return null;
            return {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: effect.path,
                ts,
                change: {
                    action: 'insert',
                    opId,
                    afterId: removed.afterId,
                    char: removed.char,
                } as JsonValue,
            };
        }
        case 'addMark':
            return {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: effect.path,
                ts,
                change: {
                    action: 'removeMark',
                    opId,
                    start: change.start,
                    end: change.end,
                    markType: change.markType,
                } as JsonValue,
            };
        case 'removeMark':
            return {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: effect.path,
                ts,
                change: {
                    action: 'addMark',
                    opId,
                    start: change.start,
                    end: change.end,
                    markType: change.markType,
                    value: richTextMarkValueBefore(effect),
                } as JsonValue,
            };
    }
}

function createRichTextRedoUpdate(
    doc: CrdtDocument<unknown>,
    effect: Extract<LocalEffect, {kind: 'leaf'}>,
    ts: HlcTimestamp,
): CrdtUpdate | null {
    const change = effect.change as RichTextOperation;
    const opId = nextRichTextOpId(doc, effect.path, ts);
    switch (change.action) {
        case 'insert':
            return {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: effect.path,
                ts,
                change: {
                    action: 'insert',
                    opId,
                    afterId: change.afterId,
                    char: change.char,
                } as JsonValue,
            };
        case 'remove':
            return {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: effect.path,
                ts,
                change: {
                    action: 'remove',
                    opId,
                    removedId: change.removedId,
                } as JsonValue,
            };
        case 'addMark':
        case 'removeMark':
            return {
                op: 'leaf',
                plugin: RICH_TEXT_LEAF_PLUGIN_ID,
                path: effect.path,
                ts,
                change: {...change, opId} as JsonValue,
            };
    }
}

function nextRichTextOpId(doc: CrdtDocument<unknown>, path: CrdtPathSegment[], ts: HlcTimestamp) {
    const meta = getMetaAtPath(doc.meta, path);
    if (!meta || meta.kind !== 'leaf' || meta.plugin !== RICH_TEXT_LEAF_PLUGIN_ID) {
        throw new Error('Cannot create rich text undo/redo update: target is not rich text.');
    }
    const unpacked = hlc.unpack(ts);
    const maxOpCounter = (meta.data as RichTextLeafMeta).maxOpCounter;
    return formatOpId(maxOpCounter + 1, `${unpacked.node}:${unpacked.suffix ?? 'main'}`);
}

function richTextMarkValueBefore(effect: Extract<LocalEffect, {kind: 'leaf'}>) {
    const change = effect.change as RichTextOperation;
    const markType = change.action === 'removeMark' ? change.markType : undefined;
    if (!markType || !effect.before) return undefined;
    return materializeRichTextState(effect.before as RichTextState).spans.find(
        (span) => span.marks?.[markType] !== undefined,
    )?.marks?.[markType];
}

function checkRichTextEffectTarget(
    doc: CrdtDocument<unknown>,
    command: {id: HlcTimestamp},
    effect: Extract<LocalEffect, {kind: 'leaf'}>,
): BlockedEffect | null {
    const target = cloneRichTextStateAtCrdtPath(doc, effect.path);
    const change = effect.change as RichTextOperation;
    if (!target) return {command, effect, reason: 'missing-target'};
    switch (change.action) {
        case 'insert': {
            const char = target.chars.find((candidate) => candidate.opId === change.opId);
            if (!char) return {command, effect, reason: 'missing-target'};
            if (char.deleted) return {command, effect, reason: 'deleted'};
            return null;
        }
        case 'remove': {
            const char = target.chars.find((candidate) => candidate.opId === change.removedId);
            if (!char) return {command, effect, reason: 'missing-target'};
            if (!char.deleted) return {command, effect, reason: 'superseded'};
            return null;
        }
        case 'addMark':
        case 'removeMark':
            return richTextHasMarkOperation(target, change.opId)
                ? null
                : {command, effect, reason: 'missing-target'};
    }
}

function richTextHasMarkOperation(state: RichTextState, opId: string) {
    return state.chars.some(
        (char) =>
            char.markOpsBefore?.some((operation) => operation.opId === opId) ||
            char.markOpsAfter?.some((operation) => operation.opId === opId),
    );
}

function cloneRichTextStateAtCrdtPath(
    doc: CrdtDocument<unknown>,
    path: CrdtPathSegment[],
): RichTextState | undefined {
    const normalPath = normalPathForCrdtPath(doc, path);
    if (!normalPath) return undefined;
    let value: unknown = doc.state;
    for (const segment of normalPath) {
        if (!value || typeof value !== 'object') return undefined;
        value = (value as Record<string | number, unknown>)[segment.key];
    }
    return isRichTextState(value) ? structuredClone(value) : undefined;
}

function isRichTextState(value: unknown): value is RichTextState {
    return Boolean(
        value && typeof value === 'object' && Array.isArray((value as {chars?: unknown}).chars),
    );
}
