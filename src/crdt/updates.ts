import type {Patch, Path} from '../types.js';
import {fractionalIndexBetween} from './fractionalIndex.js';
import {crdtPathForExisting, getMetaAtPath, liveArrayItems} from './path.js';
import type {
    CrdtDocument,
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
            return [{op: 'delete', path: crdtPathForExisting(doc, patch.path), ts}];
        case 'reorder':
            return [createReorderUpdate(doc, patch.path, patch.indices, ts)];
        case 'move':
            throw new Error('CRDT updates do not support move. Use remove plus add instead.');
    }
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
                op: 'set',
                path: [
                    ...arrayAdd.parentPath,
                    {
                        type: 'arrayItem',
                        id: arrayAdd.id,
                        parentCreated: arrayAdd.parentCreated,
                        order: {value: arrayAdd.order, ts},
                    },
                ],
                value,
                ts,
            },
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
