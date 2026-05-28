import {compareTimestamps, newer} from './clock.js';
import {materialize} from './materialize.js';
import {buildMeta, cloneMeta, versionOf} from './metadata.js';
import {getChild, getMetaAtPath} from './path.js';
import {arrayItemSchema, resolveRef, schemaAtCrdtPath} from './schema.js';
import {checkParent} from './traversal.js';
import type {
    CrdtDocument,
    CrdtMeta,
    CrdtInsertUpdate,
    CrdtPathSegment,
    CrdtSetOrderUpdate,
    CrdtUpdate,
    PendingUpdate,
} from './types.js';

type WalkResult =
    | {status: 'ready'; parent: CrdtMeta; target?: CrdtMeta; segment?: CrdtPathSegment}
    | {status: 'pending'; reason: PendingUpdate['reason']}
    | {status: 'discard'};

export function applyCrdtUpdate<T>(doc: CrdtDocument<T>, update: CrdtUpdate): CrdtDocument<T> {
    const next: CrdtDocument<T> = {
        ...doc,
        meta: cloneMeta(doc.meta),
        pending: doc.pending.slice(),
    };
    const result = applyOne(next, update);
    if (result === 'pending') {
        next.pending.push({
            update,
            reason: pendingReason(next, update),
            queuedAt: updateTimestamp(update),
        });
    }
    if (result === 'applied') retryPending(next);
    next.state = materialize(next.meta) as T;
    return next;
}

function applyOne<T>(
    doc: CrdtDocument<T>,
    update: CrdtUpdate,
): 'applied' | 'discarded' | 'pending' {
    if (update.op === 'insert') return applyInsert(doc, update);
    if (update.op === 'setOrder') return applySetOrder(doc, update);
    if (!update.path.length) {
        if (update.op === 'delete') {
            const version = versionOf(doc.meta);
            if (version && newer(version, update.ts)) return 'discarded';
            doc.meta = {kind: 'tombstone', deleted: update.ts};
            return 'applied';
        }
        const version = versionOf(doc.meta);
        if (version && !newer(update.ts, version)) return 'discarded';
        doc.meta = buildMeta(update.value, doc.schema.root, doc.schema, update.ts);
        return 'applied';
    }

    const walked = walkToLeaf(doc.meta, update.path);
    if (walked.status === 'pending') return 'pending';
    if (walked.status === 'discard') return 'discarded';
    const {parent, target, segment} = walked;
    if (!segment) return 'discarded';

    if (update.op === 'delete') {
        if (segment.type === 'arrayItem') return applyArrayItemDelete(parent, segment, update.ts);
        const targetVersion = target ? versionOf(target) : undefined;
        if (targetVersion && newer(targetVersion, update.ts)) return 'discarded';
        setChild(parent, segment, {kind: 'tombstone', deleted: update.ts});
        return 'applied';
    }

    const targetVersion = target ? versionOf(target) : undefined;
    if (targetVersion && !newer(update.ts, targetVersion)) return 'discarded';
    if (segment.type === 'arrayItem' && (!target || target.kind === 'tombstone')) return 'pending';
    const schema = schemaAtCrdtPath(doc.schema, update.path);
    setChild(parent, segment, buildMeta(update.value, schema, doc.schema, update.ts));
    return 'applied';
}

function applyInsert<T>(
    doc: CrdtDocument<T>,
    update: CrdtInsertUpdate,
): 'applied' | 'discarded' | 'pending' {
    const meta = getMetaAtPath(doc.meta, update.arrayPath);
    if (!meta) return 'pending';
    if (meta.kind === 'tombstone') return 'discarded';
    if (meta.kind !== 'array') return 'discarded';

    const existing = meta.items[update.id];
    const existingVersion =
        existing?.kind === 'deleted'
            ? existing.deleted
            : existing
              ? versionOf(existing.value)
              : undefined;
    if (existingVersion && !newer(update.ts, existingVersion)) return 'discarded';

    const arraySchema = schemaAtCrdtPath(doc.schema, update.arrayPath);
    meta.items[update.id] = {
        kind: 'live',
        order: update.order,
        value: buildMeta(
            update.value,
            arrayItemSchema(resolveRef(doc.schema, arraySchema)),
            doc.schema,
            update.ts,
        ),
    };
    return 'applied';
}

function applyArrayItemDelete(
    parent: CrdtMeta,
    segment: Extract<CrdtPathSegment, {type: 'arrayItem'}>,
    ts: string,
): 'applied' | 'discarded' | 'pending' {
    if (parent.kind !== 'array') return 'discarded';
    const item = parent.items[segment.id];
    if (!item) return 'pending';
    const targetVersion = item.kind === 'deleted' ? item.deleted : versionOf(item.value);
    if (targetVersion && newer(targetVersion, ts)) return 'discarded';
    parent.items[segment.id] = {kind: 'deleted', deleted: ts};
    return 'applied';
}

function applySetOrder<T>(
    doc: CrdtDocument<T>,
    update: CrdtSetOrderUpdate,
): 'applied' | 'discarded' | 'pending' {
    const meta = getMetaAtPath(doc.meta, update.arrayPath);
    if (!meta) return 'pending';
    if (meta.kind === 'tombstone') return 'discarded';
    if (meta.kind !== 'array') return 'discarded';
    if (Object.keys(update.orders).some((id) => !meta.items[id])) return 'pending';
    let applied = false;
    let handledDeleted = false;
    for (const [id, order] of Object.entries(update.orders)) {
        const item = meta.items[id];
        if (!item) continue;
        if (item.kind === 'deleted') {
            handledDeleted = true;
            continue;
        }
        if (newer(order.ts, item.order.ts)) {
            item.order = order;
            applied = true;
        }
    }
    return applied || handledDeleted ? 'applied' : 'discarded';
}

function walkToLeaf(root: CrdtMeta, path: CrdtPathSegment[]): WalkResult {
    let parent = root;
    for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i];
        const check = checkParent(parent, segment);
        if (check !== 'ready')
            return check === 'pending'
                ? {status: 'pending', reason: 'future-incarnation'}
                : {status: 'discard'};
        const child = getChild(parent, segment);
        if (!child) return {status: 'pending', reason: 'missing-parent'};
        if (child.kind === 'tombstone') return {status: 'discard'};
        parent = child;
    }
    const segment = path[path.length - 1];
    const check = checkParent(parent, segment);
    if (check !== 'ready')
        return check === 'pending'
            ? {status: 'pending', reason: 'future-incarnation'}
            : {status: 'discard'};
    return {status: 'ready', parent, segment, target: getChild(parent, segment)};
}

function setChild(parent: CrdtMeta, segment: CrdtPathSegment, value: CrdtMeta) {
    switch (segment.type) {
        case 'objectField':
            if (parent.kind !== 'object')
                throw new Error('Cannot set object field on non-object metadata.');
            parent.fields[segment.key] = value;
            return;
        case 'recordEntry':
            if (parent.kind !== 'record')
                throw new Error('Cannot set record entry on non-record metadata.');
            parent.entries[segment.key] = value;
            return;
        case 'arrayItem':
            if (parent.kind !== 'array')
                throw new Error('Cannot set array item on non-array metadata.');
            const item = parent.items[segment.id];
            if (!item || item.kind === 'deleted') {
                throw new Error('Cannot set missing or deleted array item metadata.');
            }
            item.value = value;
            return;
        case 'taggedField':
            if (parent.kind !== 'tagged')
                throw new Error('Cannot set tagged field on non-tagged metadata.');
            parent.fields[segment.key] = value;
            return;
    }
}

function retryPending<T>(doc: CrdtDocument<T>) {
    let changed = true;
    while (changed) {
        changed = false;
        const remaining: PendingUpdate[] = [];
        for (const pending of doc.pending) {
            const result = applyOne(doc, pending.update);
            if (result === 'applied') {
                changed = true;
            } else if (result === 'pending') {
                remaining.push(pending);
            }
        }
        doc.pending = remaining;
    }
}

function pendingReason<T>(doc: CrdtDocument<T>, update: CrdtUpdate): PendingUpdate['reason'] {
    if (update.op === 'setOrder') return 'missing-parent';
    if (update.op === 'insert') return 'missing-parent';
    const walked = walkToLeaf(doc.meta, update.path);
    return walked.status === 'pending' ? walked.reason : 'missing-parent';
}

function updateTimestamp(update: CrdtUpdate) {
    if (update.op === 'insert') return update.ts;
    if (update.op !== 'setOrder') return update.ts;
    return Object.values(update.orders).sort((a, b) => compareTimestamps(b.ts, a.ts))[0]?.ts ?? '';
}
