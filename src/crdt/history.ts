import equal from 'fast-deep-equal';
import type {EqualFn} from '../internal.js';
import type {DraftPatch, Patch} from '../types.js';
import {resolveAndApply, type MaybeNested} from '../make.js';
import {applyCrdtUpdate} from './apply.js';
import * as hlc from './hlc.js';
import {materialize} from './materialize.js';
import {cloneMeta, versionOf} from './metadata.js';
import {getMetaAtPath} from './path.js';
import {createCrdtUpdates} from './updates.js';
import type {
    CrdtDocument,
    CrdtMeta,
    CrdtPathSegment,
    CrdtSetOrderUpdate,
    CrdtUpdate,
    FractionalIndex,
    HlcTimestamp,
    ItemId,
    JsonValue,
} from './types.js';

export type CrdtLocalHistory<T> = {
    doc: CrdtDocument<T>;
    undoStack: LocalCommand[];
    redoStack: LocalCommand[];
};

export type LocalCommand = {
    id: string;
    forward: CrdtUpdate[];
    effects: LocalEffect[];
    undoEffects?: LocalEffect[];
};

export type LocalEffect =
    | {
          kind: 'set';
          path: CrdtPathSegment[];
          localTs: HlcTimestamp;
          before: CrdtMeta | undefined;
          after: CrdtMeta;
      }
    | {
          kind: 'delete';
          path: CrdtPathSegment[];
          localTs: HlcTimestamp;
          before: CrdtMeta | undefined;
      }
    | {
          kind: 'setOrder';
          arrayPath: CrdtPathSegment[];
          localTs: HlcTimestamp;
          before: Record<ItemId, {value: FractionalIndex; ts: HlcTimestamp} | undefined>;
          after: Record<ItemId, {value: FractionalIndex; ts: HlcTimestamp}>;
      };

export type BlockedEffect = {
    command: LocalCommand;
    effect: LocalEffect;
    reason: 'missing-target' | 'superseded' | 'wrong-incarnation' | 'deleted';
};

type SetOrderEffect = Extract<LocalEffect, {kind: 'setOrder'}>;

export type ApplyLocalCommandResult<T> = {
    history: CrdtLocalHistory<T>;
    updates: CrdtUpdate[];
    clock: hlc.HLC;
};

export type UndoRedoResult<T> =
    | {
          ok: true;
          history: CrdtLocalHistory<T>;
          updates: CrdtUpdate[];
          clock: hlc.HLC;
      }
    | {
          ok: false;
          reason: 'empty' | 'blocked';
          blocked?: BlockedEffect[];
          history: CrdtLocalHistory<T>;
          clock: hlc.HLC;
      };

type CreatedCrdtCommand<T> = {
    doc: CrdtDocument<T>;
    command: LocalCommand;
    updates: CrdtUpdate[];
    clock: hlc.HLC;
};

export function createCrdtLocalHistory<T>(doc: CrdtDocument<T>): CrdtLocalHistory<T> {
    return {doc, undoStack: [], redoStack: []};
}

export function canUndoLocalCommand<T>(history: CrdtLocalHistory<T>) {
    const command = history.undoStack.at(-1);
    if (!command) return false;
    return checkEffects(history.doc, command, command.effects.toReversed()).length === 0;
}

export function canRedoLocalCommand<T>(history: CrdtLocalHistory<T>) {
    const command = history.redoStack.at(-1);
    if (!command) return false;
    const guardEffects = command.undoEffects ?? command.effects;
    return checkEffects(history.doc, command, guardEffects).length === 0;
}

export function applyLocalCommand<T, Tag extends string = 'type', Context = undefined>(
    history: CrdtLocalHistory<T>,
    draft: MaybeNested<DraftPatch<T, Tag, Context>>,
    clock: hlc.HLC,
    extra?: Context,
    tag?: Tag,
    equalFn: EqualFn = equal,
): ApplyLocalCommandResult<T> {
    const {changes} = resolveAndApply(
        history.doc.state,
        draft,
        extra as Context,
        tag ?? (history.doc.schema.tagKey as Tag),
        equalFn,
    );
    const created = createLocalCrdtCommand(history.doc, changes, clock);
    return {
        history: {
            doc: created.doc,
            undoStack: [...history.undoStack, created.command],
            redoStack: [],
        },
        updates: created.updates,
        clock: created.clock,
    };
}

export function applyRemoteHistoryUpdate<T>(
    history: CrdtLocalHistory<T>,
    update: CrdtUpdate,
): CrdtLocalHistory<T> {
    return {
        ...history,
        doc: applyCrdtUpdate(history.doc, update),
    };
}

export function receiveRemoteUpdate<T>(
    history: CrdtLocalHistory<T>,
    update: CrdtUpdate,
    clock: hlc.HLC,
): {history: CrdtLocalHistory<T>; clock: hlc.HLC} {
    const ts = latestUpdateTimestamp(update);
    return {
        history: applyRemoteHistoryUpdate(history, update),
        clock: ts ? hlc.recv(clock, hlc.unpack(ts), Date.now()) : clock,
    };
}

export const applyRemoteUpdate = receiveRemoteUpdate;

export function undoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    clock: hlc.HLC,
): UndoRedoResult<T> {
    const command = history.undoStack.at(-1);
    if (!command) return {ok: false, reason: 'empty', history, clock};

    const blocked = checkEffects(history.doc, command, command.effects.toReversed());
    if (blocked.length) return {ok: false, reason: 'blocked', blocked, history, clock};

    const nextTs = nextTimestamper(clock);
    const generated = applyGeneratedUpdates(
        history.doc,
        createUndoUpdates(command, nextTs),
        nextTs.current(),
    );
    const undone: LocalCommand = {...command, undoEffects: generated.effects};
    return {
        ok: true,
        history: {
            doc: generated.doc,
            undoStack: history.undoStack.slice(0, -1),
            redoStack: [...history.redoStack, undone],
        },
        updates: generated.updates,
        clock: generated.clock,
    };
}

export function redoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    clock: hlc.HLC,
): UndoRedoResult<T> {
    const command = history.redoStack.at(-1);
    if (!command) return {ok: false, reason: 'empty', history, clock};

    const guardEffects = command.undoEffects ?? command.effects;
    const blocked = checkEffects(history.doc, command, guardEffects);
    if (blocked.length) return {ok: false, reason: 'blocked', blocked, history, clock};

    const nextTs = nextTimestamper(clock);
    const generated = applyGeneratedUpdates(
        history.doc,
        createRedoUpdates(command, nextTs),
        nextTs.current(),
    );
    const redone: LocalCommand = {...command, effects: generated.effects, undoEffects: undefined};
    return {
        ok: true,
        history: {
            doc: generated.doc,
            undoStack: [...history.undoStack, redone],
            redoStack: history.redoStack.slice(0, -1),
        },
        updates: generated.updates,
        clock: generated.clock,
    };
}

function createLocalCrdtCommand<T>(
    doc: CrdtDocument<T>,
    patches: Patch<T>[],
    clock: hlc.HLC,
): CreatedCrdtCommand<T> {
    const nextTs = nextTimestamper(clock);
    const updates: CrdtUpdate[] = [];
    let current = doc;

    for (const patch of patches) {
        const ts = nextTs();
        for (const update of createCrdtUpdates(current, patch, ts)) {
            const next = applyCrdtUpdate(current, update);
            updates.push(update);
            current = next;
        }
    }

    const applied = applyGeneratedUpdates(doc, updates, nextTs.current());
    return {
        doc: applied.doc,
        command: {
            id: updates[0]
                ? (latestUpdateTimestamp(updates[0]) ?? nextTs.currentPacked())
                : nextTs.currentPacked(),
            forward: updates,
            effects: applied.effects,
        },
        updates,
        clock: applied.clock,
    };
}

function applyGeneratedUpdates<T>(
    doc: CrdtDocument<T>,
    updates: CrdtUpdate[],
    initialClock?: hlc.HLC,
): {doc: CrdtDocument<T>; updates: CrdtUpdate[]; effects: LocalEffect[]; clock: hlc.HLC} {
    let current = doc;
    const effects: LocalEffect[] = [];
    let clock =
        initialClock ??
        hlc.unpack(
            latestUpdateTimestamp(updates.at(-1) ?? {op: 'setOrder', arrayPath: [], orders: {}}) ??
                '000000000000000:00000:history',
        );

    for (const update of updates) {
        const before = captureBefore(current, update);
        const next = applyCrdtUpdate(current, update);
        effects.push(captureEffect(current, next, update, before));
        current = next;
        const ts = latestUpdateTimestamp(update);
        if (ts) clock = hlc.unpack(ts);
    }

    return {doc: current, updates, effects, clock};
}

function captureBefore<T>(doc: CrdtDocument<T>, update: CrdtUpdate) {
    if (update.op === 'setOrder') {
        const array = getMetaAtPath(doc.meta, update.arrayPath);
        const before: SetOrderEffect['before'] = {};
        for (const id of Object.keys(update.orders)) {
            before[id] =
                array?.kind === 'array' && array.items[id] ? {...array.items[id].order} : undefined;
        }
        return before;
    }
    return cloneEffectMeta(getMetaAtPath(doc.meta, update.path));
}

function captureEffect<T>(
    beforeDoc: CrdtDocument<T>,
    afterDoc: CrdtDocument<T>,
    update: CrdtUpdate,
    before: CrdtMeta | undefined | SetOrderEffect['before'],
): LocalEffect {
    if (update.op === 'setOrder') {
        const array = getMetaAtPath(afterDoc.meta, update.arrayPath);
        const after: SetOrderEffect['after'] = {};
        for (const id of Object.keys(update.orders)) {
            if (array?.kind === 'array' && array.items[id]) {
                after[id] = {...array.items[id].order};
            }
        }
        return {
            kind: 'setOrder',
            arrayPath: update.arrayPath,
            localTs: latestUpdateTimestamp(update) ?? '',
            before: before as SetOrderEffect['before'],
            after,
        };
    }

    if (update.op === 'delete') {
        return {
            kind: 'delete',
            path: update.path,
            localTs: update.ts,
            before: before as CrdtMeta | undefined,
        };
    }

    const after = cloneEffectMeta(getMetaAtPath(afterDoc.meta, update.path));
    if (!after) {
        throw new Error('Cannot capture local CRDT set effect: target is missing after apply.');
    }
    return {
        kind: 'set',
        path: update.path,
        localTs: update.ts,
        before: before as CrdtMeta | undefined,
        after,
    };
}

function createUndoUpdates(command: LocalCommand, nextTs: ReturnType<typeof nextTimestamper>) {
    const updates: CrdtUpdate[] = [];
    for (const effect of command.effects.toReversed()) {
        switch (effect.kind) {
            case 'set':
                updates.push(metaToUpdate(effect.path, effect.before, nextTs()));
                break;
            case 'delete':
                if (effect.before && effect.before.kind !== 'tombstone') {
                    updates.push(metaToUpdate(effect.path, effect.before, nextTs()));
                }
                break;
            case 'setOrder': {
                const orders: CrdtSetOrderUpdate['orders'] = {};
                const ts = nextTs();
                for (const [id, order] of Object.entries(effect.before)) {
                    if (order) orders[id] = {value: order.value, ts};
                }
                if (Object.keys(orders).length) {
                    updates.push({op: 'setOrder', arrayPath: effect.arrayPath, orders});
                }
                break;
            }
        }
    }
    return updates;
}

function createRedoUpdates(command: LocalCommand, nextTs: ReturnType<typeof nextTimestamper>) {
    const updates: CrdtUpdate[] = [];
    for (const effect of command.effects) {
        switch (effect.kind) {
            case 'set':
                updates.push(metaToUpdate(effect.path, effect.after, nextTs()));
                break;
            case 'delete':
                updates.push({op: 'delete', path: effect.path, ts: nextTs()});
                break;
            case 'setOrder': {
                const orders: CrdtSetOrderUpdate['orders'] = {};
                const ts = nextTs();
                for (const [id, order] of Object.entries(effect.after)) {
                    orders[id] = {value: order.value, ts};
                }
                updates.push({op: 'setOrder', arrayPath: effect.arrayPath, orders});
                break;
            }
        }
    }
    return updates;
}

function metaToUpdate(
    path: CrdtPathSegment[],
    meta: CrdtMeta | undefined,
    ts: HlcTimestamp,
): CrdtUpdate {
    if (!meta || meta.kind === 'tombstone') return {op: 'delete', path, ts};
    const value = materialize(meta);
    if (value === undefined) return {op: 'delete', path, ts};
    return {op: 'set', path, value, ts};
}

function checkEffects<T>(
    doc: CrdtDocument<T>,
    command: LocalCommand,
    effects: LocalEffect[],
): BlockedEffect[] {
    return effects
        .map((effect) => checkEffect(doc, command, effect))
        .filter((blocked): blocked is BlockedEffect => blocked !== null);
}

function checkEffect<T>(
    doc: CrdtDocument<T>,
    command: LocalCommand,
    effect: LocalEffect,
): BlockedEffect | null {
    if (effect.kind === 'setOrder') {
        const array = getMetaAtPath(doc.meta, effect.arrayPath);
        if (!array) return {command, effect, reason: 'missing-target'};
        if (array.kind !== 'array') return {command, effect, reason: 'wrong-incarnation'};
        for (const id of Object.keys(effect.after)) {
            const item = array.items[id];
            if (!item) return {command, effect, reason: 'missing-target'};
            if (item.value.kind === 'tombstone') return {command, effect, reason: 'deleted'};
            if (item.order.ts !== effect.localTs) return {command, effect, reason: 'superseded'};
        }
        return null;
    }

    const target = getMetaAtPath(doc.meta, effect.path);
    if (!target) return {command, effect, reason: 'missing-target'};
    if (effect.kind === 'delete') {
        if (target.kind !== 'tombstone') return {command, effect, reason: 'superseded'};
        if (target.deleted !== effect.localTs) return {command, effect, reason: 'superseded'};
        return null;
    }
    const version = versionOf(target);
    if (version !== effect.localTs) return {command, effect, reason: 'superseded'};
    return null;
}

function cloneEffectMeta(meta: CrdtMeta | undefined): CrdtMeta | undefined {
    return meta ? cloneMeta(meta) : undefined;
}

function nextTimestamper(clock: hlc.HLC) {
    let current = clock;
    const next = () => {
        current = hlc.inc(current, Date.now());
        return hlc.pack(current);
    };
    next.current = () => current;
    next.currentPacked = () => hlc.pack(current);
    return next;
}

function latestUpdateTimestamp(update: CrdtUpdate) {
    if (update.op !== 'setOrder') return update.ts;
    return Object.values(update.orders)
        .map(({ts}) => ts)
        .sort()
        .at(-1);
}
