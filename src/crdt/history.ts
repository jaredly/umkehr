import {deepEqual as equal} from '../deepEqual.js';
import type {LeafBuilderExtensionAny} from '../builderExtensions.js';
import type {EqualFn} from '../internal.js';
import type {DraftPatch, Patch} from '../types.js';
import {resolveAndApply, type MaybeNested} from '../make.js';
import {applyCrdtUpdate} from './apply.js';
import * as hlc from './hlc.js';
import {materialize} from './materialize.js';
import {cloneMeta} from './metadata.js';
import {getMetaAtPath, normalPathForCrdtPath} from './path.js';
import {createCrdtUpdates} from './updates.js';
import type {
    CrdtDocument,
    CrdtCommandInfo,
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
    base: CrdtDocument<T>;
    doc: CrdtDocument<T>;
    updates: CrdtUpdate[];
};

type DerivedCommand = {
    id: HlcTimestamp;
    intent: CrdtCommandInfo['intent'];
    targetCommandId?: HlcTimestamp;
    updates: CrdtUpdate[];
    effects: LocalEffect[];
    redoGuardEffects?: LocalEffect[];
};

export type LocalEffect =
    | {
          kind: 'insert';
          arrayPath: CrdtPathSegment[];
          path: CrdtPathSegment[];
          id: ItemId;
          order: {value: FractionalIndex; ts: HlcTimestamp};
          localTs: HlcTimestamp;
          value: JsonValue;
          after: CrdtMeta;
      }
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
      }
    | {
          kind: 'leaf';
          plugin: string;
          path: CrdtPathSegment[];
          localTs: HlcTimestamp;
          before: JsonValue | undefined;
          after: JsonValue;
          change: JsonValue;
      };

export type BlockedEffect = {
    command: {id: HlcTimestamp};
    effect: LocalEffect;
    reason: 'missing-target' | 'superseded' | 'wrong-incarnation' | 'deleted' | 'unsupported';
};

type SetOrderEffect = Extract<LocalEffect, {kind: 'setOrder'}>;

type DerivedUndoCache<T> = {
    doc: CrdtDocument<T>;
    commands: DerivedCommand[];
    undoStack: DerivedCommand[];
    redoStack: DerivedCommand[];
    commandById: Map<HlcTimestamp, DerivedCommand>;
};

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
    command: DerivedCommand;
    updates: CrdtUpdate[];
    clock: hlc.HLC;
};

const undoCaches = new WeakMap<CrdtLocalHistory<unknown>, Map<string, DerivedUndoCache<unknown>>>();

export function createCrdtLocalHistory<T>(doc: CrdtDocument<T>): CrdtLocalHistory<T> {
    const base = cloneDocumentWithoutPending(doc);
    return {base, doc: base, updates: []};
}

export function canUndoLocalCommand<T>(history: CrdtLocalHistory<T>, actor: string) {
    const command = getUndoCache(history, actor).undoStack.at(-1);
    if (!command) return false;
    return checkEffects(history.doc, command, command.effects.toReversed()).length === 0;
}

export function canRedoLocalCommand<T>(history: CrdtLocalHistory<T>, actor: string) {
    const command = getUndoCache(history, actor).redoStack.at(-1);
    if (!command) return false;
    return (
        checkEffects(history.doc, command, command.redoGuardEffects ?? command.effects).length === 0
    );
}

export function applyLocalCommand<
    T,
    Tag extends string = 'type',
    Context = undefined,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
>(
    history: CrdtLocalHistory<T>,
    draft: MaybeNested<DraftPatch<T, Tag, Context, Extensions>>,
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
        history: appendAppliedUpdates(history, created.doc, created.updates),
        updates: created.updates,
        clock: created.clock,
    };
}

export function applyRemoteHistoryUpdate<T>(
    history: CrdtLocalHistory<T>,
    update: CrdtUpdate,
): CrdtLocalHistory<T> {
    return appendUpdate(history, update);
}

export function receiveRemoteUpdate<T>(
    history: CrdtLocalHistory<T>,
    update: CrdtUpdate,
    clock: hlc.HLC,
): {history: CrdtLocalHistory<T>; clock: hlc.HLC} {
    const ts = latestCrdtUpdateTimestamp(update);
    return {
        history: applyRemoteHistoryUpdate(history, update),
        clock: ts ? hlc.recv(clock, hlc.unpack(ts), Date.now()) : clock,
    };
}

export const applyRemoteUpdate = receiveRemoteUpdate;

export function undoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    actor: string,
    clock: hlc.HLC,
): UndoRedoResult<T> {
    const command = getUndoCache(history, actor).undoStack.at(-1);
    if (!command) return {ok: false, reason: 'empty', history, clock};

    const blocked = checkEffects(history.doc, command, command.effects.toReversed());
    if (blocked.length) return {ok: false, reason: 'blocked', blocked, history, clock};

    const nextTs = nextTimestamper(clock);
    const undoUpdates = createUndoUpdates(history.doc, command, nextTs);
    const commandId = undoUpdates[0]
        ? (latestCrdtUpdateTimestamp(undoUpdates[0]) ?? nextTs.currentPacked())
        : nextTs.currentPacked();
    const updates = withCommand(undoUpdates, {
        commandId,
        intent: 'undo',
        targetCommandId: command.id,
    });
    const generated = applyGeneratedUpdates(history.doc, updates, nextTs.current());
    return {
        ok: true,
        history: appendAppliedUpdates(history, generated.doc, generated.updates),
        updates: generated.updates,
        clock: generated.clock,
    };
}

export function redoLocalCommand<T>(
    history: CrdtLocalHistory<T>,
    actor: string,
    clock: hlc.HLC,
): UndoRedoResult<T> {
    const command = getUndoCache(history, actor).redoStack.at(-1);
    if (!command) return {ok: false, reason: 'empty', history, clock};

    const blocked = checkEffects(history.doc, command, command.redoGuardEffects ?? command.effects);
    if (blocked.length) return {ok: false, reason: 'blocked', blocked, history, clock};

    const nextTs = nextTimestamper(clock);
    const redoUpdates = createRedoUpdates(history.doc, command, nextTs);
    const commandId = redoUpdates[0]
        ? (latestCrdtUpdateTimestamp(redoUpdates[0]) ?? nextTs.currentPacked())
        : nextTs.currentPacked();
    const updates = withCommand(redoUpdates, {
        commandId,
        intent: 'redo',
        targetCommandId: command.id,
    });
    const generated = applyGeneratedUpdates(history.doc, updates, nextTs.current());
    return {
        ok: true,
        history: appendAppliedUpdates(history, generated.doc, generated.updates),
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
        for (const update of createCrdtUpdates(current, patch, ts, {
            sessionId: sessionIdFromTimestamp(ts),
        })) {
            const next = applyCrdtUpdate(current, update);
            updates.push(update);
            current = next;
        }
    }

    const commandId = updates[0]
        ? (latestCrdtUpdateTimestamp(updates[0]) ?? nextTs.currentPacked())
        : nextTs.currentPacked();
    const stamped = withCommand(updates, {commandId, intent: 'edit'});
    const applied = applyGeneratedUpdates(doc, stamped, nextTs.current());
    return {
        doc: applied.doc,
        command: {
            id: commandId,
            intent: 'edit',
            updates: stamped,
            effects: applied.effects,
        },
        updates: stamped,
        clock: applied.clock,
    };
}

function appendUpdate<T>(history: CrdtLocalHistory<T>, update: CrdtUpdate): CrdtLocalHistory<T> {
    const doc = applyCrdtUpdate(history.doc, update);
    return appendAppliedUpdates(history, doc, [update]);
}

function appendAppliedUpdates<T>(
    history: CrdtLocalHistory<T>,
    doc: CrdtDocument<T>,
    updates: CrdtUpdate[],
): CrdtLocalHistory<T> {
    const next: CrdtLocalHistory<T> = {
        base: history.base,
        doc,
        updates: [...history.updates, ...updates],
    };
    carryUndoCaches(history, next, updates);
    return next;
}

function carryUndoCaches<T>(
    previous: CrdtLocalHistory<T>,
    next: CrdtLocalHistory<T>,
    updates: CrdtUpdate[],
) {
    const previousCaches = undoCaches.get(previous as CrdtLocalHistory<unknown>);
    if (!previousCaches || previousCaches.size === 0) return;

    const nextCaches = new Map<string, DerivedUndoCache<unknown>>();
    for (const [actor, cache] of previousCaches.entries()) {
        let nextCache = cache;
        for (const update of updates) {
            nextCache = appendUpdateToCache(nextCache, update, actor);
        }
        nextCaches.set(actor, nextCache);
    }
    undoCaches.set(next as CrdtLocalHistory<unknown>, nextCaches);
}

function getUndoCache<T>(history: CrdtLocalHistory<T>, actor: string): DerivedUndoCache<T> {
    const key = history as CrdtLocalHistory<unknown>;
    let caches = undoCaches.get(key);
    if (!caches) {
        caches = new Map();
        undoCaches.set(key, caches);
    }
    const existing = caches.get(actor) as DerivedUndoCache<T> | undefined;
    if (existing) return existing;

    let cache = emptyUndoCache(history.base);
    for (const update of history.updates) {
        cache = appendUpdateToCache(cache, update, actor);
    }
    caches.set(actor, cache as DerivedUndoCache<unknown>);
    return cache;
}

function emptyUndoCache<T>(base: CrdtDocument<T>): DerivedUndoCache<T> {
    return {
        doc: base,
        commands: [],
        undoStack: [],
        redoStack: [],
        commandById: new Map(),
    };
}

function appendUpdateToCache<T>(
    cache: DerivedUndoCache<T>,
    update: CrdtUpdate,
    actor: string,
): DerivedUndoCache<T> {
    const before = captureBefore(cache.doc, update);
    const doc = applyCrdtUpdate(cache.doc, update);
    const next: DerivedUndoCache<T> = {
        doc,
        commands: cache.commands.slice(),
        undoStack: cache.undoStack.slice(),
        redoStack: cache.redoStack.slice(),
        commandById: new Map(cache.commandById),
    };

    const commandInfo = update.command;
    if (!commandInfo || !isAuthoredBy(update, actor)) return next;

    let effect: LocalEffect;
    try {
        effect = captureEffect(cache.doc, doc, update, before);
    } catch {
        return next;
    }

    const previous = next.commands.at(-1);
    let isNewCommand = false;
    let command =
        previous?.id === commandInfo.commandId && previous.intent === commandInfo.intent
            ? {...previous}
            : undefined;
    if (command && previous) {
        next.commands[next.commands.length - 1] = command;
        next.commandById.set(command.id, command);
        const commandId = command.id;
        const undoAt = next.undoStack.findIndex((candidate) => candidate.id === commandId);
        if (undoAt !== -1) next.undoStack[undoAt] = command;
        const redoAt = next.redoStack.findIndex((candidate) => candidate.id === commandId);
        if (redoAt !== -1) next.redoStack[redoAt] = command;
    }
    if (!command) {
        if (next.commandById.has(commandInfo.commandId)) return next;
        command = {
            id: commandInfo.commandId,
            intent: commandInfo.intent,
            targetCommandId: commandInfo.targetCommandId,
            updates: [],
            effects: [],
        };
        next.commands.push(command);
        next.commandById.set(command.id, command);
        isNewCommand = true;
    }

    command.updates = [...command.updates, update];
    command.effects = [...command.effects, effect];
    if (isNewCommand) {
        applyCommandTransition(next, command);
    } else if (command.intent === 'undo' && command.targetCommandId) {
        const redoAt = next.redoStack.findIndex(
            (candidate) => candidate.id === command.targetCommandId,
        );
        if (redoAt !== -1) {
            next.redoStack[redoAt] = {
                ...next.redoStack[redoAt],
                redoGuardEffects: command.effects,
            };
        }
    }
    return next;
}

function applyCommandTransition<T>(cache: DerivedUndoCache<T>, command: DerivedCommand) {
    if (command.intent === 'edit') {
        cache.undoStack = [...cache.undoStack, command];
        cache.redoStack = [];
        return;
    }
    const targetId = command.targetCommandId;
    if (!targetId) return;
    if (command.intent === 'undo') {
        const at = cache.undoStack.findIndex((candidate) => candidate.id === targetId);
        if (at === -1) return;
        const [target] = cache.undoStack.splice(at, 1);
        cache.redoStack = [...cache.redoStack, {...target, redoGuardEffects: command.effects}];
        return;
    }
    const at = cache.redoStack.findIndex((candidate) => candidate.id === targetId);
    if (at === -1) return;
    const [target] = cache.redoStack.splice(at, 1);
    cache.undoStack = [...cache.undoStack, {...target, redoGuardEffects: undefined}];
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
            latestCrdtUpdateTimestamp(
                updates.at(-1) ?? {op: 'setOrder', arrayPath: [], orders: {}},
            ) ?? '000000000000000:00000:history',
        );

    for (const update of updates) {
        const before = captureBefore(current, update);
        const next = applyCrdtUpdate(current, update);
        effects.push(captureEffect(current, next, update, before));
        current = next;
        const ts = latestCrdtUpdateTimestamp(update);
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
                array?.kind === 'array' && array.items[id]?.kind === 'live'
                    ? {...array.items[id].order}
                    : undefined;
        }
        return before;
    }
    if (update.op === 'leaf') return cloneLeafValueAtCrdtPath(doc, update.path);
    if (update.op === 'insert') return undefined;
    return cloneEffectMeta(getMetaAtPath(doc.meta, update.path));
}

function captureEffect<T>(
    beforeDoc: CrdtDocument<T>,
    afterDoc: CrdtDocument<T>,
    update: CrdtUpdate,
    before: CrdtMeta | JsonValue | undefined | SetOrderEffect['before'],
): LocalEffect {
    if (update.op === 'setOrder') {
        const array = getMetaAtPath(afterDoc.meta, update.arrayPath);
        const after: SetOrderEffect['after'] = {};
        for (const id of Object.keys(update.orders)) {
            if (array?.kind === 'array' && array.items[id]?.kind === 'live') {
                after[id] = {...array.items[id].order};
            }
        }
        return {
            kind: 'setOrder',
            arrayPath: update.arrayPath,
            localTs: latestCrdtUpdateTimestamp(update) ?? '',
            before: before as SetOrderEffect['before'],
            after,
        };
    }

    if (update.op === 'insert') {
        const array = getMetaAtPath(afterDoc.meta, update.arrayPath);
        if (!array || array.kind !== 'array') {
            throw new Error(
                'Cannot capture local CRDT insert effect: array is missing after apply.',
            );
        }
        const item = array.items[update.id];
        if (!item || item.kind !== 'live') {
            throw new Error(
                'Cannot capture local CRDT insert effect: item is missing after apply.',
            );
        }
        return {
            kind: 'insert',
            arrayPath: update.arrayPath,
            path: [
                ...update.arrayPath,
                {type: 'arrayItem', id: update.id, parentCreated: array.created},
            ],
            id: update.id,
            order: update.order,
            localTs: update.ts,
            value: update.value,
            after: item.value,
        };
    }

    if (update.op === 'leaf') {
        const afterMeta = getMetaAtPath(afterDoc.meta, update.path);
        if (!afterMeta || afterMeta.kind !== 'leaf') {
            throw new Error(
                'Cannot capture local CRDT leaf effect: target is missing after apply.',
            );
        }
        const after = cloneLeafValueAtCrdtPath(afterDoc, update.path);
        if (!after)
            throw new Error('Cannot capture local CRDT leaf effect: state is missing after apply.');
        const plugin = afterDoc.schema.leafPlugins[update.plugin];
        const fallback = {
            kind: 'leaf' as const,
            plugin: update.plugin,
            path: update.path,
            localTs: update.ts,
            before: before as JsonValue | undefined,
            after,
            change: update.change,
        };
        const captured = plugin?.captureEffect?.({
            path: update.path,
            localTs: update.ts,
            before: before as JsonValue | undefined,
            after,
            meta: afterMeta,
            operation: update.change,
        });
        return {
            ...fallback,
            ...captured,
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

function createUndoUpdates<T>(
    doc: CrdtDocument<T>,
    command: DerivedCommand,
    nextTs: ReturnType<typeof nextTimestamper>,
) {
    const updates: CrdtUpdate[] = [];
    let current = doc;
    const effects = command.effects.toReversed();
    for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        switch (effect.kind) {
            case 'insert':
                updates.push({op: 'delete', path: effect.path, ts: nextTs()});
                break;
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
            case 'leaf': {
                const ts = nextTs();
                const plugin = current.schema.leafPlugins[effect.plugin];
                let leafUpdates: CrdtUpdate[];
                if (plugin?.createUndoOperationsForEffects) {
                    const group = sameLeafEffectRun(effects, index);
                    leafUpdates = plugin.createUndoOperationsForEffects({
                        doc: current as CrdtDocument<unknown>,
                        effects: group.toReversed(),
                        ts,
                        context: {sessionId: sessionIdFromTimestamp(ts)},
                    });
                    index += group.length - 1;
                } else {
                    leafUpdates =
                        plugin?.createUndoOperations?.({
                            doc: current as CrdtDocument<unknown>,
                            effect,
                            ts,
                            context: {sessionId: sessionIdFromTimestamp(ts)},
                        }) ?? [];
                }
                for (const update of leafUpdates) {
                    updates.push(update);
                    current = applyCrdtUpdate(current, update);
                }
                break;
            }
        }
    }
    return updates;
}

function createRedoUpdates<T>(
    doc: CrdtDocument<T>,
    command: DerivedCommand,
    nextTs: ReturnType<typeof nextTimestamper>,
) {
    const updates: CrdtUpdate[] = [];
    let current = doc;
    const effects = command.effects;
    for (let index = 0; index < effects.length; index++) {
        const effect = effects[index];
        switch (effect.kind) {
            case 'insert':
                updates.push({
                    op: 'insert',
                    arrayPath: effect.arrayPath,
                    id: effect.id,
                    order: {...effect.order, ts: nextTs()},
                    value: effect.value,
                    ts: nextTs.currentPacked(),
                });
                break;
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
            case 'leaf': {
                const ts = nextTs();
                const plugin = current.schema.leafPlugins[effect.plugin];
                let leafUpdates: CrdtUpdate[];
                if (plugin?.createRedoOperationsForEffects) {
                    const group = sameLeafEffectRun(effects, index);
                    leafUpdates = plugin.createRedoOperationsForEffects({
                        doc: current as CrdtDocument<unknown>,
                        effects: group,
                        redoGuardEffects: command.redoGuardEffects?.filter(
                            (guard): guard is Extract<LocalEffect, {kind: 'leaf'}> =>
                                guard.kind === 'leaf' &&
                                guard.plugin === effect.plugin &&
                                sameCrdtPath(guard.path, effect.path),
                        ),
                        ts,
                        context: {sessionId: sessionIdFromTimestamp(ts)},
                    });
                    index += group.length - 1;
                } else {
                    leafUpdates =
                        plugin?.createRedoOperations?.({
                            doc: current as CrdtDocument<unknown>,
                            effect,
                            ts,
                            context: {sessionId: sessionIdFromTimestamp(ts)},
                        }) ?? [];
                }
                for (const update of leafUpdates) {
                    updates.push(update);
                    current = applyCrdtUpdate(current, update);
                }
                break;
            }
        }
    }
    return updates;
}

function sameLeafEffectRun(effects: LocalEffect[], start: number) {
    const first = effects[start];
    if (!first || first.kind !== 'leaf') return [];
    const group: Extract<LocalEffect, {kind: 'leaf'}>[] = [first];
    for (let index = start + 1; index < effects.length; index++) {
        const effect = effects[index];
        if (
            effect.kind !== 'leaf' ||
            effect.plugin !== first.plugin ||
            !sameCrdtPath(effect.path, first.path)
        ) {
            break;
        }
        group.push(effect);
    }
    return group;
}

function sameCrdtPath(a: CrdtPathSegment[], b: CrdtPathSegment[]) {
    return equal(a, b);
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
    command: DerivedCommand,
    effects: LocalEffect[],
): BlockedEffect[] {
    return effects
        .map((effect) => checkEffect(doc, command, effect))
        .filter((blocked): blocked is BlockedEffect => blocked !== null);
}

function checkEffect<T>(
    doc: CrdtDocument<T>,
    command: DerivedCommand,
    effect: LocalEffect,
): BlockedEffect | null {
    if (effect.kind === 'setOrder') {
        const array = getMetaAtPath(doc.meta, effect.arrayPath);
        if (!array) return {command, effect, reason: 'missing-target'};
        if (array.kind !== 'array') return {command, effect, reason: 'wrong-incarnation'};
        for (const id of Object.keys(effect.after)) {
            const item = array.items[id];
            if (!item) return {command, effect, reason: 'missing-target'};
            if (item.kind === 'deleted') return {command, effect, reason: 'deleted'};
            if (item.order.ts !== effect.localTs) return {command, effect, reason: 'superseded'};
        }
        return null;
    }

    if (effect.kind === 'insert') {
        const target = getMetaAtPath(doc.meta, effect.path);
        if (!target) return {command, effect, reason: 'missing-target'};
        if (target.kind === 'tombstone') return {command, effect, reason: 'deleted'};
        if (!equal(materialize(target), effect.value)) {
            return {command, effect, reason: 'superseded'};
        }
        return null;
    }

    if (effect.kind === 'leaf') {
        const target = getMetaAtPath(doc.meta, effect.path);
        if (!target) return {command, effect, reason: 'missing-target'};
        if (target.kind !== 'leaf' || target.plugin !== effect.plugin) {
            return {command, effect, reason: 'wrong-incarnation'};
        }
        const plugin = doc.schema.leafPlugins[effect.plugin];
        if (plugin?.checkEffect) {
            return plugin.checkEffect({
                doc: doc as CrdtDocument<unknown>,
                history: createCrdtLocalHistory(doc) as CrdtLocalHistory<unknown>,
                command,
                effect,
            });
        }
        return {command, effect, reason: 'unsupported'};
    }

    const target = getMetaAtPath(doc.meta, effect.path);
    if (!target) return {command, effect, reason: 'missing-target'};
    if (effect.kind === 'delete') {
        if (target.kind !== 'tombstone') return {command, effect, reason: 'superseded'};
        if (target.deleted !== effect.localTs) return {command, effect, reason: 'superseded'};
        return null;
    }
    if (!equal(materialize(target), materialize(effect.after))) {
        return {command, effect, reason: 'superseded'};
    }
    return null;
}

function withCommand(
    updates: CrdtUpdate[],
    command: Omit<CrdtCommandInfo, 'commandSeq'>,
): CrdtUpdate[] {
    return updates.map((update, commandSeq) => ({
        ...update,
        command: {...command, commandSeq},
    }));
}

function isAuthoredBy(update: CrdtUpdate, actor: string) {
    const actors = updateActors(update);
    return actors.length > 0 && actors.every((candidate) => candidate === actor);
}

function updateActors(update: CrdtUpdate) {
    if (update.op !== 'setOrder') return [hlc.unpack(update.ts).node];
    return Object.values(update.orders).map(({ts}) => hlc.unpack(ts).node);
}

function cloneEffectMeta(meta: CrdtMeta | undefined): CrdtMeta | undefined {
    return meta ? cloneMeta(meta) : undefined;
}

function cloneLeafValueAtCrdtPath<T>(
    doc: CrdtDocument<T>,
    path: CrdtPathSegment[],
): JsonValue | undefined {
    const normalPath = normalPathForCrdtPath(doc, path);
    if (!normalPath) return undefined;
    let value: unknown = doc.state;
    for (const segment of normalPath) {
        if (!value || typeof value !== 'object') return undefined;
        value = (value as Record<string | number, unknown>)[segment.key];
    }
    return isJsonValue(value) ? structuredClone(value) : undefined;
}

function cloneDocumentWithoutPending<T>(doc: CrdtDocument<T>): CrdtDocument<T> {
    const meta = cloneMeta(doc.meta);
    return {
        state: materialize(meta, doc.state, doc.schema) as T,
        meta,
        pending: [],
        schema: doc.schema,
    };
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

export function latestCrdtUpdateTimestamp(update: CrdtUpdate): HlcTimestamp | undefined {
    if (update.op !== 'setOrder') return update.ts;
    return Object.values(update.orders)
        .map(({ts}) => ts)
        .sort()
        .at(-1);
}

export function latestCrdtUpdateBatchTimestamp(
    updates: readonly CrdtUpdate[],
): HlcTimestamp | undefined {
    return updates
        .map((update) => latestCrdtUpdateTimestamp(update))
        .filter((timestamp): timestamp is HlcTimestamp => timestamp !== undefined)
        .sort()
        .at(-1);
}

function sessionIdFromTimestamp(ts: HlcTimestamp) {
    return hlc.unpack(ts).node;
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
