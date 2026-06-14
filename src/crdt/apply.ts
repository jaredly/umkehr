import {compareTimestamps, newer} from './clock.js';
import {materialize} from './materialize.js';
import {buildMeta, versionOf} from './metadata.js';
import {getChild, getMetaAtPath, normalPathForCrdtPath} from './path.js';
import {arrayItemSchema, resolveRef, schemaAtCrdtPath} from './schema.js';
import {checkParent} from './traversal.js';
import type {
    CrdtDocument,
    CrdtMeta,
    CrdtInsertUpdate,
    CrdtPathSegment,
    CrdtSetOrderUpdate,
    CrdtUpdate,
    HlcTimestamp,
    PendingUpdate,
} from './types.js';
import type {Path} from '../types.js';

type WalkResult =
    | {status: 'ready'; parent: CrdtMeta; target?: CrdtMeta; segment?: CrdtPathSegment}
    | {status: 'pending'; reason: PendingUpdate['reason']}
    | {status: 'discard'};

type ApplyResult<T> =
    | {status: 'applied'; meta: CrdtMeta; state?: T}
    | {status: 'pending'; reason: PendingUpdate['reason']}
    | {status: 'discarded'};

type CloneLeafResult =
    | {status: 'ready'; root: CrdtMeta; parent: CrdtMeta; target?: CrdtMeta; segment: CrdtPathSegment}
    | {status: 'pending'; reason: PendingUpdate['reason']}
    | {status: 'discard'};

type CloneTargetResult =
    | {status: 'ready'; root: CrdtMeta; target: CrdtMeta}
    | {status: 'pending'; reason: PendingUpdate['reason']}
    | {status: 'discard'};

export function applyCrdtUpdate<T>(doc: CrdtDocument<T>, update: CrdtUpdate): CrdtDocument<T> {
    const result = applyOne(doc, update);
    if (result.status === 'discarded') return doc;
    if (result.status === 'pending') {
        return {
            ...doc,
            pending: [
                ...doc.pending,
                {
                    update,
                    reason: result.reason,
                    queuedAt: updateTimestamp(update),
                },
            ],
        };
    }

    const retried = retryPending({
        ...doc,
        meta: result.meta,
        state: (result.state ?? doc.state) as T,
    });
    return {
        ...retried,
        state: materialize(retried.meta, retried.state, retried.schema) as T,
    };
}

function pendingResult(reason: PendingUpdate['reason']): ApplyResult<never> {
    return {status: 'pending', reason};
}

function applyOne<T>(
    doc: CrdtDocument<T>,
    update: CrdtUpdate,
): ApplyResult<T> {
    if (update.op === 'insert') return applyInsert(doc, update);
    if (update.op === 'setOrder') return applySetOrder(doc, update);
    if (update.op === 'leaf') return applyLeaf(doc, update);
    if (!update.path.length) {
        if (update.op === 'delete') {
            const version = versionOf(doc.meta);
            if (version && newer(version, update.ts)) return {status: 'discarded'};
            return {status: 'applied', meta: {kind: 'tombstone', deleted: update.ts}};
        }
        const version = versionOf(doc.meta);
        if (version && !newer(update.ts, version)) return {status: 'discarded'};
        return {
            status: 'applied',
            meta: buildMeta(update.value, doc.schema.root, doc.schema, update.ts),
        };
    }

    const walked = walkToLeaf(doc.meta, update.path);
    if (walked.status === 'pending') return pendingResult(walked.reason);
    if (walked.status === 'discard') return {status: 'discarded'};
    const {target, segment} = walked;
    if (!segment) return {status: 'discarded'};

    if (update.op === 'delete') {
        if (segment.type === 'arrayItem') return applyArrayItemDelete(doc.meta, update.path, update.ts);
        const targetVersion = target ? versionOf(target) : undefined;
        if (targetVersion && newer(targetVersion, update.ts)) return {status: 'discarded'};
        const cloned = clonePathToLeaf(doc.meta, update.path);
        if (cloned.status === 'pending') return pendingResult(cloned.reason);
        if (cloned.status === 'discard') return {status: 'discarded'};
        setChild(cloned.parent, cloned.segment, {kind: 'tombstone', deleted: update.ts});
        return {status: 'applied', meta: cloned.root};
    }

    const targetVersion = target ? versionOf(target) : undefined;
    if (targetVersion && !newer(update.ts, targetVersion)) return {status: 'discarded'};
    if (segment.type === 'arrayItem' && (!target || target.kind === 'tombstone')) {
        return pendingResult('missing-parent');
    }
    const schema = schemaAtCrdtPath(doc.schema, update.path);
    const cloned = clonePathToLeaf(doc.meta, update.path);
    if (cloned.status === 'pending') return pendingResult(cloned.reason);
    if (cloned.status === 'discard') return {status: 'discarded'};
    setChild(cloned.parent, cloned.segment, buildMeta(update.value, schema, doc.schema, update.ts));
    return {status: 'applied', meta: cloned.root};
}

function retryPending<T>(doc: CrdtDocument<T>) {
    let current: CrdtDocument<T> = {...doc};
    let changed = true;
    while (changed) {
        changed = false;
        const remaining: PendingUpdate[] = [];
        for (const pending of current.pending) {
            const result = applyOne(current, pending.update);
            if (result.status === 'applied') {
                current = {
                    ...current,
                    meta: result.meta,
                    state: (result.state ?? current.state) as T,
                };
                changed = true;
            } else if (result.status === 'pending') {
                remaining.push({
                    ...pending,
                    reason: result.reason,
                });
            }
        }
        current = {
            ...current,
            pending: remaining,
        };
    }
    return current;
}

function applyLeaf<T>(
    doc: CrdtDocument<T>,
    update: Extract<CrdtUpdate, {op: 'leaf'}>,
): ApplyResult<T> {
    const meta = getMetaAtPath(doc.meta, update.path);
    if (!meta) return pendingResult(pendingReason(doc, update));
    if (meta.kind === 'tombstone') return {status: 'discarded'};
    if (meta.kind !== 'leaf') return {status: 'discarded'};
    if (meta.plugin !== update.plugin) return {status: 'discarded'};
    const plugin = doc.schema.leafPlugins[update.plugin];
    if (!plugin) return {status: 'discarded'};
    const path = normalPathForCrdtPath(doc, update.path);
    if (!path) return pendingResult('missing-parent');
    const state = valueAtPath(doc.state, path);
    if (!plugin.isValue(state)) return {status: 'discarded'};
    const next = plugin.applyOperation({
        value: state,
        meta,
        operation: update.change,
        ts: update.ts,
        context: {sessionId: sessionIdFromTimestamp(update.ts)},
    });
    const cloned = clonePathToTarget(doc.meta, update.path);
    if (cloned.status === 'pending') return pendingResult(cloned.reason);
    if (cloned.status === 'discard') return {status: 'discarded'};
    if (cloned.target.kind !== 'leaf') return {status: 'discarded'};
    cloned.target.data = next.meta;
    return {
        status: 'applied',
        meta: cloned.root,
        state: setValueAtPath(doc.state, path, next.value) as T,
    };
}

function applyInsert<T>(
    doc: CrdtDocument<T>,
    update: CrdtInsertUpdate,
): ApplyResult<T> {
    const meta = getMetaAtPath(doc.meta, update.arrayPath);
    if (!meta) return pendingResult('missing-parent');
    if (meta.kind === 'tombstone') return {status: 'discarded'};
    if (meta.kind !== 'array') return {status: 'discarded'};

    const existing = meta.items[update.id];
    const existingVersion =
        existing?.kind === 'deleted'
            ? existing.deleted
            : existing
              ? versionOf(existing.value)
              : undefined;
    if (existingVersion && !newer(update.ts, existingVersion)) return {status: 'discarded'};

    const arraySchema = schemaAtCrdtPath(doc.schema, update.arrayPath);
    const cloned = clonePathToTarget(doc.meta, update.arrayPath);
    if (cloned.status === 'pending') return pendingResult(cloned.reason);
    if (cloned.status === 'discard') return {status: 'discarded'};
    if (cloned.target.kind !== 'array') return {status: 'discarded'};
    cloned.target.items[update.id] = {
        kind: 'live',
        order: update.order,
        value: buildMeta(
            update.value,
            arrayItemSchema(resolveRef(doc.schema, arraySchema)),
            doc.schema,
            update.ts,
        ),
    };
    return {status: 'applied', meta: cloned.root};
}

function applyArrayItemDelete(
    root: CrdtMeta,
    path: CrdtPathSegment[],
    ts: string,
): ApplyResult<never> {
    const parentPath = path.slice(0, -1);
    const segment = path.at(-1);
    if (!segment || segment.type !== 'arrayItem') return {status: 'discarded'};
    const parent = getMetaAtPath(root, parentPath);
    if (!parent) return pendingResult('missing-parent');
    if (parent.kind !== 'array') return {status: 'discarded'};
    const item = parent.items[segment.id];
    if (!item) return pendingResult('missing-parent');
    const targetVersion = item.kind === 'deleted' ? item.deleted : versionOf(item.value);
    if (targetVersion && newer(targetVersion, ts)) return {status: 'discarded'};
    const cloned = clonePathToTarget(root, parentPath);
    if (cloned.status === 'pending') return pendingResult(cloned.reason);
    if (cloned.status === 'discard') return {status: 'discarded'};
    if (cloned.target.kind !== 'array') return {status: 'discarded'};
    cloned.target.items[segment.id] = {kind: 'deleted', deleted: ts};
    return {status: 'applied', meta: cloned.root};
}

function applySetOrder<T>(
    doc: CrdtDocument<T>,
    update: CrdtSetOrderUpdate,
): ApplyResult<T> {
    const meta = getMetaAtPath(doc.meta, update.arrayPath);
    if (!meta) return pendingResult('missing-parent');
    if (meta.kind === 'tombstone') return {status: 'discarded'};
    if (meta.kind !== 'array') return {status: 'discarded'};
    if (Object.keys(update.orders).some((id) => !meta.items[id])) {
        return pendingResult('missing-parent');
    }
    let applied = false;
    let handledDeleted = false;
    const changedOrders: Array<[string, {value: string; ts: string}]> = [];
    for (const [id, order] of Object.entries(update.orders)) {
        const item = meta.items[id];
        if (!item) continue;
        if (item.kind === 'deleted') {
            handledDeleted = true;
            continue;
        }
        if (newer(order.ts, item.order.ts)) {
            changedOrders.push([id, order]);
            applied = true;
        }
    }
    if (!applied && !handledDeleted) return {status: 'discarded'};
    const cloned = clonePathToTarget(doc.meta, update.arrayPath);
    if (cloned.status === 'pending') return pendingResult(cloned.reason);
    if (cloned.status === 'discard') return {status: 'discarded'};
    if (cloned.target.kind !== 'array') return {status: 'discarded'};
    for (const [id, order] of changedOrders) {
        const item = cloned.target.items[id];
        if (!item || item.kind !== 'live') continue;
        cloned.target.items[id] = {...item, order};
    }
    return {status: 'applied', meta: cloned.root};
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

function cloneMetaNode(meta: CrdtMeta): CrdtMeta {
    switch (meta.kind) {
        case 'object':
            return {...meta, fields: {...meta.fields}};
        case 'record':
            return {...meta, entries: {...meta.entries}};
        case 'array':
            return {...meta, items: {...meta.items}};
        case 'tagged':
            return {...meta, fields: {...meta.fields}};
        case 'primitive':
        case 'tombstone':
        case 'leaf':
            return {...meta};
    }
}

function clonePathToLeaf(root: CrdtMeta, path: CrdtPathSegment[]): CloneLeafResult {
    if (!path.length) return {status: 'discard'};

    let originalParent = root;
    const clonedRoot = cloneMetaNode(root);
    let clonedParent = clonedRoot;

    for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i];
        const check = checkParent(originalParent, segment);
        if (check !== 'ready') {
            return check === 'pending'
                ? {status: 'pending', reason: 'future-incarnation'}
                : {status: 'discard'};
        }
        const child = getChild(originalParent, segment);
        if (!child) return {status: 'pending', reason: 'missing-parent'};
        if (child.kind === 'tombstone') return {status: 'discard'};
        const clonedChild = cloneMetaNode(child);
        setChild(clonedParent, segment, clonedChild);
        originalParent = child;
        clonedParent = clonedChild;
    }

    const segment = path[path.length - 1];
    const check = checkParent(originalParent, segment);
    if (check !== 'ready') {
        return check === 'pending'
            ? {status: 'pending', reason: 'future-incarnation'}
            : {status: 'discard'};
    }
    return {
        status: 'ready',
        root: clonedRoot,
        parent: clonedParent,
        segment,
        target: getChild(originalParent, segment),
    };
}

function clonePathToTarget(root: CrdtMeta, path: CrdtPathSegment[]): CloneTargetResult {
    if (!path.length) {
        const target = cloneMetaNode(root);
        return {status: 'ready', root: target, target};
    }

    const cloned = clonePathToLeaf(root, path);
    if (cloned.status !== 'ready') return cloned;
    if (!cloned.target) return {status: 'pending', reason: 'missing-parent'};
    const target = cloneMetaNode(cloned.target);
    setChild(cloned.parent, cloned.segment, target);
    return {status: 'ready', root: cloned.root, target};
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
            parent.items[segment.id] = {...item, value};
            return;
        case 'taggedField':
            if (parent.kind !== 'tagged')
                throw new Error('Cannot set tagged field on non-tagged metadata.');
            parent.fields[segment.key] = value;
            return;
    }
}

function valueAtPath(root: unknown, path: Path) {
    let current = root;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string | number, unknown>)[segment.key];
    }
    return current;
}

function setValueAtPath(root: unknown, path: Path, value: unknown): unknown {
    if (!path.length) return value;
    if (!root || typeof root !== 'object') {
        throw new Error('Cannot set rich text state on non-object root.');
    }
    const [head, ...tail] = path;
    if (!head) return value;
    const clone = Array.isArray(root) ? root.slice() : {...(root as Record<string, unknown>)};
    (clone as Record<string | number, unknown>)[head.key] = setValueAtPath(
        (root as Record<string | number, unknown>)[head.key],
        tail,
        value,
    );
    return clone;
}

function pendingReason<T>(doc: CrdtDocument<T>, update: CrdtUpdate): PendingUpdate['reason'] {
    if (update.op === 'setOrder') return 'missing-parent';
    if (update.op === 'insert') return 'missing-parent';
    if (update.op === 'leaf') return getMetaAtPath(doc.meta, update.path) ? 'future-incarnation' : 'missing-parent';
    const walked = walkToLeaf(doc.meta, update.path);
    return walked.status === 'pending' ? walked.reason : 'missing-parent';
}

function updateTimestamp(update: CrdtUpdate) {
    if (update.op === 'insert') return update.ts;
    if (update.op !== 'setOrder') return update.ts;
    return Object.values(update.orders).sort((a, b) => compareTimestamps(b.ts, a.ts))[0]?.ts ?? '';
}

function sessionIdFromTimestamp(ts: HlcTimestamp) {
    const [, , node] = ts.split(':');
    return node || 'remote';
}
