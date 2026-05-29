import {deepEqual} from '../deepEqual.js';
import {applyCrdtUpdate} from './apply.js';
import type {CrdtDocument, CrdtMeta, CrdtUpdate, PendingUpdate} from './types.js';

export type ProofValidationResult =
    | {success: true}
    | {success: false; errors?: unknown; message?: string};

export type ProofValidator<T> = {
    validate(input: unknown): ProofValidationResult | {success: true; data?: T};
};

export type CanonicalCrdtDocument<T> = {
    state: T;
    meta: unknown;
};

export function applyAll<T>(doc: CrdtDocument<T>, updates: readonly CrdtUpdate[]) {
    return updates.reduce((current, update) => applyCrdtUpdate(current, update), doc);
}

export function applySchedule<T>(
    initial: CrdtDocument<T>,
    updates: readonly CrdtUpdate[],
    order: readonly number[],
) {
    return applyAll(
        initial,
        order.map((index) => {
            const update = updates[index];
            if (!update) throw new Error(`Schedule references missing update index ${index}.`);
            return update;
        }),
    );
}

export function duplicateUpdates(
    updates: readonly CrdtUpdate[],
    policy: 'none' | 'all' | {indices: readonly number[]},
) {
    if (policy === 'none') return updates.slice();
    if (policy === 'all') return updates.flatMap((update) => [update, update]);
    const duplicates = new Set(policy.indices);
    return updates.flatMap((update, index) => (duplicates.has(index) ? [update, update] : [update]));
}

export function shuffleDeterministically<T>(values: readonly T[], seed: number) {
    const shuffled = values.slice();
    let state = seed || 1;
    for (let i = shuffled.length - 1; i > 0; i--) {
        state = (state * 1664525 + 1013904223) >>> 0;
        const j = state % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function allPermutationsBounded<T>(values: readonly T[], max = 720) {
    const out: T[][] = [];
    const used = new Array(values.length).fill(false);
    const current: T[] = [];

    const visit = () => {
        if (out.length >= max) return;
        if (current.length === values.length) {
            out.push(current.slice());
            return;
        }
        for (let i = 0; i < values.length; i++) {
            if (used[i]) continue;
            used[i] = true;
            current.push(values[i]);
            visit();
            current.pop();
            used[i] = false;
        }
    };

    visit();
    return out;
}

export function canonicalizeMeta(meta: CrdtMeta) {
    return canonicalize(meta);
}

export function canonicalizeDocument<T>(doc: CrdtDocument<T>): CanonicalCrdtDocument<T> {
    return {
        state: canonicalize(doc.state) as T,
        meta: canonicalizeMeta(doc.meta),
    };
}

export function canonicalizePending(pending: readonly PendingUpdate[]) {
    return pending
        .map((item) => canonicalize(item))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function expectConverged<T>(docs: readonly CrdtDocument<T>[]) {
    if (docs.length < 2) return;
    const expected = canonicalizeDocument(docs[0]);
    for (let i = 1; i < docs.length; i++) {
        const actual = canonicalizeDocument(docs[i]);
        if (!deepEqual(actual, expected)) {
            throw new Error(
                [
                    `CRDT documents did not converge at index ${i}.`,
                    `Expected: ${JSON.stringify(expected, null, 2)}`,
                    `Actual: ${JSON.stringify(actual, null, 2)}`,
                ].join('\n'),
            );
        }
    }
}

export function expectNoReadyPending<T>(doc: CrdtDocument<T>) {
    const ready = doc.pending.filter((pending) => pendingUpdateIsReady(doc, pending));
    if (ready.length) {
        throw new Error(
            [
                `Expected no ready pending CRDT updates, found ${ready.length}.`,
                JSON.stringify(canonicalizePending(ready), null, 2),
            ].join('\n'),
        );
    }
}

export function expectValidCrdtUpdate<T>(update: CrdtUpdate, validator: ProofValidator<T>) {
    const result = validator.validate(update);
    if (!result.success) {
        throw new Error(`Expected valid CRDT update: ${JSON.stringify(result, null, 2)}`);
    }
}

export function expectValidMaterializedState<T>(
    doc: CrdtDocument<T>,
    validator: ProofValidator<T>,
) {
    const result = validator.validate(doc.state);
    if (!result.success) {
        throw new Error(`Expected valid materialized CRDT state: ${JSON.stringify(result, null, 2)}`);
    }
}

function pendingUpdateIsReady<T>(doc: CrdtDocument<T>, pending: PendingUpdate) {
    const probe = cloneDocumentWithoutPending(doc);
    const before = canonicalizeDocument(probe);
    const after = applyCrdtUpdate(probe, pending.update);
    if (after.pending.length > 0) return false;
    return !deepEqual(canonicalizeDocument(after), before);
}

function cloneDocumentWithoutPending<T>(doc: CrdtDocument<T>): CrdtDocument<T> {
    return {
        ...doc,
        state: structuredClone(doc.state) as T,
        meta: structuredClone(doc.meta) as CrdtMeta,
        pending: [],
    };
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;

    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
        out[key] = canonicalize(input[key]);
    }
    return out;
}
