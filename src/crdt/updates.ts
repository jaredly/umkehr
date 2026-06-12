import type {Patch, Path} from '../types.js';
import {tryUnpack} from './hlc.js';
import {fractionalIndexBetween} from './fractionalIndex.js';
import {crdtPathForExisting, getMetaAtPath, liveArrayItems} from './path.js';
import type {
    CrdtDocument,
    CrdtInsertUpdate,
    CrdtLeafUpdate,
    CrdtSetOrderUpdate,
    CrdtUpdate,
    FractionalIndex,
    HlcTimestamp,
    ItemId,
    JsonValue,
} from './types.js';

export function createCrdtUpdates<T>(
    doc: CrdtDocument<T>,
    patch: Patch<T>,
    ts: HlcTimestamp,
    options: {sessionId?: string} = {},
): CrdtUpdate[] {
    switch (patch.op) {
        case 'add':
        case 'replace':
            return createSetUpdates(
                doc,
                patch.path,
                patch.value as JsonValue,
                ts,
                patch.op === 'add',
            );
        case 'remove':
            return [
                {
                    op: 'delete',
                    path: crdtPathForExisting(doc, patch.path),
                    ts,
                },
            ];
        case 'reorder':
            return [createReorderUpdate(doc, patch.path, patch.indices, ts)];
        case 'move':
            return createMoveUpdates(
                doc,
                patch.path,
                patch.fromIdx,
                patch.targetIdx,
                patch.after,
                ts,
            );
        case 'leaf':
            return createLeafUpdates(doc, patch, ts, options.sessionId);
    }
}

function createLeafUpdates<T>(
    doc: CrdtDocument<T>,
    patch: Extract<Patch<T>, {op: 'leaf'}>,
    ts: HlcTimestamp,
    sessionId?: string,
): CrdtLeafUpdate[] {
    const path = crdtPathForExisting(doc, patch.path);
    const meta = getMetaAtPath(doc.meta, path);
    if (!meta || meta.kind !== 'leaf') {
        throw new Error('Cannot create leaf CRDT update: path is not a leaf field.');
    }
    if (meta.plugin !== patch.plugin) {
        throw new Error(
            `Cannot create leaf CRDT update: patch plugin "${patch.plugin}" does not match target plugin "${meta.plugin}".`,
        );
    }
    const plugin = doc.schema.leafPlugins[meta.plugin];
    if (!plugin) {
        throw new Error(`Cannot create leaf CRDT update: missing plugin "${meta.plugin}".`);
    }
    const value = valueAtPath(doc.state, patch.path);
    if (!plugin.isValue(value)) {
        throw new Error('Cannot create leaf CRDT update: state value does not match plugin.');
    }
    const operations = plugin.createOperations({
        value,
        meta,
        change: patch.change,
        ts,
        context: {sessionId: sessionId ?? sessionIdFromTimestamp(ts)},
    });
    const make = (change: JsonValue): CrdtLeafUpdate => ({
        op: 'leaf',
        plugin: plugin.id,
        path,
        change,
        ts,
    });
    return operations.map(make);
}

function valueAtPath(root: unknown, path: Path): JsonValue {
    let current = root;
    for (const segment of path) {
        if (!current || typeof current !== 'object') {
            throw new Error('Cannot create leaf CRDT update: state path is missing.');
        }
        current = (current as Record<string | number, unknown>)[segment.key];
    }
    if (!isJsonValue(current)) {
        throw new Error('Cannot create leaf CRDT update: state value is not JSON.');
    }
    return current;
}

function sessionIdFromTimestamp(ts: HlcTimestamp) {
    const unpacked = tryUnpack(ts);
    return unpacked?.node ?? 'local';
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null) return true;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (typeof value !== 'object') return false;
    return Object.values(value).every((item) => item === undefined || isJsonValue(item));
}

function createSetUpdates<T>(
    doc: CrdtDocument<T>,
    path: Path,
    value: JsonValue,
    ts: HlcTimestamp,
    isAdd: boolean,
): CrdtUpdate[] {
    const arrayAdd = isAdd ? arrayAddTarget(doc, path, ts) : null;
    if (arrayAdd) {
        return [
            {
                op: 'insert',
                arrayPath: arrayAdd.parentPath,
                id: arrayAdd.id,
                order: {value: arrayAdd.order, ts},
                value,
                ts,
            } satisfies CrdtInsertUpdate,
        ];
    }
    return [{op: 'set', path: crdtPathForExisting(doc, path), value, ts}];
}

function createReorderUpdate<T>(
    doc: CrdtDocument<T>,
    path: Path,
    indices: number[],
    ts: HlcTimestamp,
): CrdtSetOrderUpdate {
    const arrayPath = crdtPathForExisting(doc, path);
    const meta = getMetaAtPath(doc.meta, arrayPath);
    if (!meta || meta.kind !== 'array')
        throw new Error('Cannot create CRDT reorder update: path is not an array.');
    const live = liveArrayItems(meta);
    if (indices.length !== live.length) {
        throw new Error(
            'Cannot create CRDT reorder update: indices length must match live array length.',
        );
    }
    const seen = new Set(indices);
    if (
        seen.size !== live.length ||
        indices.some((index) => !Number.isInteger(index) || index < 0 || index >= live.length)
    ) {
        throw new Error(
            'Cannot create CRDT reorder update: indices must be a permutation of live array indices.',
        );
    }
    const reordered = indices.map((index) => live[index]);
    let previous: FractionalIndex | undefined;
    const orders: CrdtSetOrderUpdate['orders'] = {};
    for (const [id] of reordered) {
        const order = fractionalIndexBetween(previous);
        previous = order;
        orders[id] = {value: order, ts};
    }
    return {op: 'setOrder', arrayPath, orders};
}

function createMoveUpdates<T>(
    doc: CrdtDocument<T>,
    path: Path,
    fromIdx: number,
    targetIdx: number,
    after: boolean,
    ts: HlcTimestamp,
): CrdtUpdate[] {
    const arrayPath = crdtPathForExisting(doc, path);
    const meta = getMetaAtPath(doc.meta, arrayPath);
    if (!meta || meta.kind !== 'array')
        throw new Error('Cannot create CRDT move update: path is not an array.');
    const live = liveArrayItems(meta);
    if (!Number.isInteger(fromIdx)) {
        throw new Error('Cannot create CRDT move update: fromIdx must be an integer.');
    }
    if (!Number.isInteger(targetIdx)) {
        throw new Error('Cannot create CRDT move update: targetIdx must be an integer.');
    }
    if (fromIdx < 0 || fromIdx >= live.length) {
        throw new Error('Cannot create CRDT move update: fromIdx is out of range.');
    }
    if (targetIdx < 0 || targetIdx >= live.length) {
        throw new Error('Cannot create CRDT move update: targetIdx is out of range.');
    }
    if (
        fromIdx === targetIdx ||
        (!after && targetIdx === fromIdx + 1) ||
        (after && targetIdx === fromIdx - 1)
    ) {
        return [];
    }

    const moved = live[fromIdx];
    if (!moved) return [];
    const previousItem = after ? live[targetIdx] : live[toPreviousIndex(fromIdx, targetIdx)];
    const nextItem = after ? live[toNextIndex(fromIdx, targetIdx)] : live[targetIdx];
    const previous = previousItem?.[1].order.value;
    const next = nextItem?.[1].order.value;

    return [
        {
            op: 'setOrder',
            arrayPath,
            orders: {
                [moved[0]]: {value: fractionalIndexBetween(previous, next), ts},
            },
        },
    ];
}

function toPreviousIndex(fromIdx: number, targetIdx: number) {
    const previousIdx = targetIdx - 1;
    return previousIdx === fromIdx ? previousIdx - 1 : previousIdx;
}

function toNextIndex(fromIdx: number, targetIdx: number) {
    const nextIdx = targetIdx + 1;
    return nextIdx === fromIdx ? nextIdx + 1 : nextIdx;
}

function arrayAddTarget<T>(doc: CrdtDocument<T>, path: Path, ts: HlcTimestamp) {
    const last = path.at(-1);
    if (!last || last.type !== 'key' || typeof last.key !== 'number') return null;
    const parentPath = path.slice(0, -1);
    const parentCrdtPath = crdtPathForExisting(doc, parentPath);
    const parent = getMetaAtPath(doc.meta, parentCrdtPath);
    if (!parent || parent.kind !== 'array') return null;
    const live = liveArrayItems(parent);
    const before = live[last.key - 1]?.[1].order.value;
    const after = live[last.key]?.[1].order.value;
    const id: ItemId = ts;
    return {
        id,
        parentPath: parentCrdtPath,
        parentCreated: parent.created,
        order: fractionalIndexBetween(before, after),
    };
}
