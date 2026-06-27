import {applyMany} from './apply.js';
import {validateOp} from './ops.js';
import {planUndoOps, type UndoUnsupported} from './undo.js';
import type {
    CachedState,
    DefaultBlockMeta,
    HLC,
    Op,
    TimestampedBlockMeta,
} from './types.js';
import type {VirtualBlockParentConfig} from './blocks.js';
import type {BranchAdapter, UpdateEvent} from '../branches/index.js';

export type BlockCrdtUpdate<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    eventId: string;
    ops: Op<M>[];
};

export type BlockCrdtBranchAdapterOptions<M extends TimestampedBlockMeta> = {
    createInitialHistory(): CachedState<M>;
    configFor?(history: CachedState<M>): VirtualBlockParentConfig<M>;
};

export type BlockCrdtUpdateValidationResult =
    | {valid: true}
    | {valid: false; errors: string[]};

export type BlockBranchCommandIntent = 'edit' | 'undo' | 'redo';

export type BlockBranchCommand<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    id: string;
    actor: string;
    before: CachedState<M>;
    after: CachedState<M>;
    update: BlockCrdtUpdate<M>;
    intent: BlockBranchCommandIntent;
    targetCommandId?: string;
};

export type BlockBranchHistory<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    state: CachedState<M>;
    commands: BlockBranchCommand<M>[];
    undoStack: string[];
    redoStack: string[];
};

export type BlockBranchUndoRedoResult<M extends TimestampedBlockMeta = DefaultBlockMeta> =
    | {ok: true; history: BlockBranchHistory<M>; update: BlockCrdtUpdate<M>}
    | {
          ok: false;
          reason: 'empty' | 'unsupported';
          history: BlockBranchHistory<M>;
          unsupported?: UndoUnsupported<M>[];
      };

export function createBlockCrdtBranchAdapter<M extends TimestampedBlockMeta>({
    createInitialHistory,
    configFor,
}: BlockCrdtBranchAdapterOptions<M>): BranchAdapter<CachedState<M>, BlockCrdtUpdate<M>> {
    return {
        createInitialHistory,
        applyUpdate(history, update) {
            return applyMany(history, update.ops, configFor?.(history) ?? {});
        },
        sameContents(left, right) {
            return JSON.stringify(left.state) === JSON.stringify(right.state);
        },
    };
}

export function createBlockCrdtUpdate<M extends TimestampedBlockMeta>(
    eventId: string,
    ops: Op<M>[],
): BlockCrdtUpdate<M> {
    const result = validateBlockCrdtUpdate({eventId, ops});
    if (!result.valid) {
        throw new Error(`Invalid block CRDT branch update: ${result.errors.join('; ')}`);
    }
    return {eventId, ops};
}

export function createBlockBranchHistory<M extends TimestampedBlockMeta>(
    state: CachedState<M>,
): BlockBranchHistory<M> {
    return {state, commands: [], undoStack: [], redoStack: []};
}

export function appendBlockBranchCommand<M extends TimestampedBlockMeta>({
    history,
    update,
    actor,
    intent = 'edit',
    targetCommandId,
    config = {},
}: {
    history: BlockBranchHistory<M>;
    update: BlockCrdtUpdate<M>;
    actor: string;
    intent?: BlockBranchCommandIntent;
    targetCommandId?: string;
    config?: VirtualBlockParentConfig<M>;
}): BlockBranchHistory<M> {
    const before = history.state;
    const after = applyMany(before, update.ops, config);
    const command: BlockBranchCommand<M> = {
        id: update.eventId,
        actor,
        before,
        after,
        update,
        intent,
        targetCommandId,
    };
    const undoStack = [...history.undoStack];
    const redoStack = [...history.redoStack];
    applyCommandTransition(command, undoStack, redoStack);
    return {
        state: after,
        commands: [...history.commands, command],
        undoStack,
        redoStack,
    };
}

export function undoBlockBranchCommand<M extends TimestampedBlockMeta>({
    history,
    actor,
    eventId,
    ts,
    config = {},
}: {
    history: BlockBranchHistory<M>;
    actor: string;
    eventId: string;
    ts: () => HLC;
    config?: VirtualBlockParentConfig<M>;
}): BlockBranchUndoRedoResult<M> {
    const target = latestStackCommandForActor(history, history.undoStack, actor);
    if (!target) return {ok: false, reason: 'empty', history};
    const plan = planUndoOps(target.before, history.state, target.update.ops, {actor, ts});
    if (!plan.complete) {
        return {ok: false, reason: 'unsupported', history, unsupported: plan.unsupported};
    }
    const update = createBlockCrdtUpdate(eventId, plan.ops);
    return {
        ok: true,
        update,
        history: appendBlockBranchCommand({
            history,
            update,
            actor,
            intent: 'undo',
            targetCommandId: target.id,
            config,
        }),
    };
}

export function redoBlockBranchCommand<M extends TimestampedBlockMeta>({
    history,
    actor,
    eventId,
    ts,
    config = {},
}: {
    history: BlockBranchHistory<M>;
    actor: string;
    eventId: string;
    ts: () => HLC;
    config?: VirtualBlockParentConfig<M>;
}): BlockBranchUndoRedoResult<M> {
    const target = latestStackCommandForActor(history, history.redoStack, actor);
    if (!target) return {ok: false, reason: 'empty', history};
    const undoCommand = history.commands.findLast(
        (command) =>
            command.intent === 'undo' &&
            command.targetCommandId === target.id &&
            command.actor === actor,
    );
    if (!undoCommand) return {ok: false, reason: 'empty', history};
    const plan = planUndoOps(undoCommand.before, history.state, undoCommand.update.ops, {
        actor,
        ts,
    });
    if (!plan.complete) {
        return {ok: false, reason: 'unsupported', history, unsupported: plan.unsupported};
    }
    const update = createBlockCrdtUpdate(eventId, plan.ops);
    return {
        ok: true,
        update,
        history: appendBlockBranchCommand({
            history,
            update,
            actor,
            intent: 'redo',
            targetCommandId: target.id,
            config,
        }),
    };
}

export function blockCrdtUpdateEvent<M extends TimestampedBlockMeta>({
    branchId,
    eventIndex,
    eventId,
    ops,
    recorded,
    receivedAt,
}: {
    branchId: string;
    eventIndex: number;
    eventId: string;
    ops: Op<M>[];
    recorded?: boolean;
    receivedAt?: string;
}): UpdateEvent<BlockCrdtUpdate<M>> {
    return {
        kind: 'update',
        branchId,
        eventIndex,
        eventId,
        update: createBlockCrdtUpdate(eventId, ops),
        recorded,
        receivedAt,
    };
}

export function validateBlockCrdtUpdate<M extends TimestampedBlockMeta>(
    input: unknown,
): BlockCrdtUpdateValidationResult {
    const errors: string[] = [];
    if (!isRecord(input)) {
        return {valid: false, errors: ['update must be an object']};
    }
    if (typeof input.eventId !== 'string' || input.eventId.length === 0) {
        errors.push('eventId must be a non-empty string');
    }
    if (!Array.isArray(input.ops)) {
        errors.push('ops must be an array');
    } else {
        input.ops.forEach((op, index) => {
            const result = validateUnknownOp(op as Op<M>);
            if (!result.valid) {
                errors.push(...result.errors.map((error) => `ops[${index}]: ${error}`));
            }
        });
    }
    return errors.length ? {valid: false, errors} : {valid: true};
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function applyCommandTransition<M extends TimestampedBlockMeta>(
    command: BlockBranchCommand<M>,
    undoStack: string[],
    redoStack: string[],
) {
    if (command.intent === 'edit') {
        undoStack.push(command.id);
        redoStack.splice(0);
        return;
    }
    if (!command.targetCommandId) return;
    if (command.intent === 'undo') {
        removeLast(undoStack, command.targetCommandId);
        redoStack.push(command.targetCommandId);
        return;
    }
    removeLast(redoStack, command.targetCommandId);
    undoStack.push(command.targetCommandId);
}

function latestStackCommandForActor<M extends TimestampedBlockMeta>(
    history: BlockBranchHistory<M>,
    stack: string[],
    actor: string,
) {
    for (let index = stack.length - 1; index >= 0; index--) {
        const id = stack[index];
        const command = history.commands.find((candidate) => candidate.id === id);
        if (command?.actor === actor) return command;
    }
    return null;
}

function removeLast(values: string[], value: string) {
    const index = values.lastIndexOf(value);
    if (index >= 0) values.splice(index, 1);
}

function validateUnknownOp<M extends TimestampedBlockMeta>(op: Op<M>) {
    try {
        return validateOp(op);
    } catch (error) {
        return {
            valid: false as const,
            errors: [error instanceof Error ? error.message : String(error)],
        };
    }
}
