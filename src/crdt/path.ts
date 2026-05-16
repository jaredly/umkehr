import type {Path} from '../types.js';
import {compareStrings} from './fractionalIndex.js';
import {checkParent} from './traversal.js';
import {fieldSegmentType, walkSchema} from './schema.js';
import type {ArrayMeta, CrdtDocument, CrdtMeta, CrdtPathSegment} from './types.js';

export function crdtPathForExisting<T>(doc: CrdtDocument<T>, path: Path) {
    let meta = doc.meta;
    let schema = doc.schema.root;
    const out: CrdtPathSegment[] = [];
    for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const parentSchema = schema;
        schema = walkSchema(doc.schema, schema, segment);
        if (segment.type === 'tag') {
            if (meta.kind !== 'tagged')
                throw new Error('Cannot translate CRDT path: expected tagged metadata.');
            continue;
        }
        if (meta.kind === 'array') {
            if (typeof segment.key !== 'number')
                throw new Error('Cannot translate CRDT path: array key must be numeric.');
            const live = liveArrayItems(meta);
            const item = live[segment.key];
            if (!item)
                throw new Error(
                    `Cannot translate CRDT path: array index ${segment.key} is missing.`,
                );
            out.push({type: 'arrayItem', id: item[0], parentCreated: meta.created});
            meta = item[1].value;
            continue;
        }
        if (meta.kind === 'tagged') {
            const key = String(segment.key);
            out.push({
                type: 'taggedField',
                key,
                tagKey: meta.tagKey,
                tagValue: meta.tagValue,
                parentCreated: meta.created,
                tagTs: meta.tagTs,
            });
            meta = meta.fields[key];
            continue;
        }
        if (meta.kind === 'object') {
            const key = String(segment.key);
            const fieldType = fieldSegmentType(doc.schema, parentSchema, key);
            out.push({type: fieldType, key, parentCreated: meta.created});
            meta = meta.fields[key];
            continue;
        }
        if (meta.kind === 'record') {
            const key = String(segment.key);
            out.push({type: 'recordEntry', key, parentCreated: meta.created});
            meta = meta.entries[key];
            continue;
        }
        throw new Error('Cannot translate CRDT path through a non-container value.');
    }
    return out;
}

export function getMetaAtPath(root: CrdtMeta, path: CrdtPathSegment[]) {
    let meta: CrdtMeta | undefined = root;
    for (const segment of path) {
        if (!meta || meta.kind === 'tombstone') return undefined;
        const check = checkParent(meta, segment);
        if (check !== 'ready') return undefined;
        meta = getChild(meta, segment);
    }
    return meta;
}

export function getChild(parent: CrdtMeta, segment: CrdtPathSegment): CrdtMeta | undefined {
    switch (segment.type) {
        case 'objectField':
            return parent.kind === 'object' ? parent.fields[segment.key] : undefined;
        case 'recordEntry':
            return parent.kind === 'record' ? parent.entries[segment.key] : undefined;
        case 'arrayItem':
            return parent.kind === 'array' ? parent.items[segment.id]?.value : undefined;
        case 'taggedField':
            return parent.kind === 'tagged' ? parent.fields[segment.key] : undefined;
    }
}

export function liveArrayItems(meta: ArrayMeta) {
    return Object.entries(meta.items)
        .filter(([, item]) => item.value.kind !== 'tombstone')
        .sort(([aId, a], [bId, b]) => {
            const order = compareStrings(a.order.value, b.order.value);
            return order || compareStrings(aId, bId);
        });
}

export function lastArrayOrder(meta: ArrayMeta) {
    return liveArrayItems(meta).at(-1)?.[1].order.value;
}
