import {applyMany, planUndoOps, type Op} from 'umkehr/block-crdt';
import type {CachedState} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import {
    applyLocalChange,
    createDemoState,
    nextReplicaClock,
    nextReplicaTs,
    toggleOnline,
    type DemoState,
    type EditorId,
    type Replica,
} from './blockEditorRuntime';
import type {RichBlockMeta} from './blockMeta';
import {
    type BlockCommandInfo,
    type HistoryAction,
    type HistoryState,
} from './history';
import type {RetainedSelectionSet} from './selectionSet';

type DerivedBlockCommand = {
    id: string;
    actor: EditorId;
    intent: BlockCommandInfo['intent'];
    targetCommandId?: string;
    actionIndex: number;
    before: CachedState<RichBlockMeta>;
    after: CachedState<RichBlockMeta>;
    ops: Array<Op<RichBlockMeta>>;
    beforeSelection: RetainedSelectionSet;
    afterSelection: RetainedSelectionSet;
    label?: string;
    undoCommand?: DerivedBlockCommand;
};

type DerivedUndoIndex = {
    demo: DemoState;
    commands: DerivedBlockCommand[];
    undoStack: DerivedBlockCommand[];
    redoStack: DerivedBlockCommand[];
};

export const deriveUndoState = (
    history: HistoryState,
    editorId: EditorId,
): {
    canUndo: boolean;
    canRedo: boolean;
    undoReason?: string;
    redoReason?: string;
} => {
    const index = deriveUndoIndex(history, editorId);
    const undo = index.undoStack.at(-1);
    const redo = index.redoStack.at(-1);
    const undoPlan = undo ? planForUndo(index.demo[editorId], undo) : null;
    const redoPlan = redo ? planForRedo(index.demo[editorId], redo) : null;
    return {
        canUndo: Boolean(undoPlan?.ok),
        canRedo: Boolean(redoPlan?.ok),
        ...(undo && !undoPlan?.ok ? {undoReason: undoPlan?.error ?? 'Undo is unavailable.'} : {}),
        ...(redo && !redoPlan?.ok ? {redoReason: redoPlan?.error ?? 'Redo is unavailable.'} : {}),
    };
};

export const createUndoAction = (
    history: HistoryState,
    editorId: EditorId,
): {action: HistoryAction} | {error: string} => {
    const index = deriveUndoIndex(history, editorId);
    const target = index.undoStack.at(-1);
    if (!target) return {error: 'Nothing to undo.'};

    const replica = index.demo[editorId];
    const planned = planForUndo(replica, target, true);
    if (!planned.ok) return {error: planned.error};

    const afterSelection = target.beforeSelection;
    return {
        action: {
            type: 'local-change',
            editorId,
            ops: planned.ops,
            selection: afterSelection,
            command: {
                id: nextReplicaTs(replica),
                actor: editorId,
                intent: 'undo',
                targetCommandId: target.id,
                beforeSelection: replica.selection,
                afterSelection,
                label: `Undo ${target.label ?? target.id}`,
            },
        },
    };
};

export const createRedoAction = (
    history: HistoryState,
    editorId: EditorId,
): {action: HistoryAction} | {error: string} => {
    const index = deriveUndoIndex(history, editorId);
    const target = index.redoStack.at(-1);
    if (!target) return {error: 'Nothing to redo.'};

    const replica = index.demo[editorId];
    const planned = planForRedo(replica, target, true);
    if (!planned.ok) return {error: planned.error};

    const afterSelection = target.afterSelection;
    return {
        action: {
            type: 'local-change',
            editorId,
            ops: planned.ops,
            selection: afterSelection,
            command: {
                id: nextReplicaTs(replica),
                actor: editorId,
                intent: 'redo',
                targetCommandId: target.id,
                beforeSelection: replica.selection,
                afterSelection,
                label: `Redo ${target.label ?? target.id}`,
            },
        },
    };
};

const deriveUndoIndex = (history: HistoryState, editorId: EditorId): DerivedUndoIndex => {
    let demo = createDemoState();
    const commands: DerivedBlockCommand[] = [];
    const undoStack: DerivedBlockCommand[] = [];
    const redoStack: DerivedBlockCommand[] = [];
    const commandById = new Map<string, DerivedBlockCommand>();
    const cursor = Math.max(0, Math.min(history.cursor, history.actions.length));

    for (const [actionIndex, action] of history.actions.slice(0, cursor).entries()) {
        if (action.type === 'toggle-online') {
            demo = toggleOnline(demo, action.editorId);
            continue;
        }

        const beforeReplica = demo[action.editorId];
        const before = beforeReplica.state;
        const after = action.ops.length ? applyMany(before, action.ops) : before;
        demo = applyLocalChange(demo, {
            editorId: action.editorId,
            state: after,
            selection: action.selection,
            ops: action.ops,
        });

        if (!action.command || action.command.actor !== editorId) continue;
        if (commandById.has(action.command.id)) continue;

        const command: DerivedBlockCommand = {
            id: action.command.id,
            actor: action.command.actor,
            intent: action.command.intent,
            targetCommandId: action.command.targetCommandId,
            actionIndex,
            before,
            after,
            ops: action.ops,
            beforeSelection: action.command.beforeSelection,
            afterSelection: action.command.afterSelection,
            label: action.command.label,
        };
        commands.push(command);
        commandById.set(command.id, command);
        applyCommandTransition(command, undoStack, redoStack, commandById);
    }

    return {demo: advanceReplicaClocks(demo, history.actions.slice(0, cursor)), commands, undoStack, redoStack};
};

const applyCommandTransition = (
    command: DerivedBlockCommand,
    undoStack: DerivedBlockCommand[],
    redoStack: DerivedBlockCommand[],
    commandById: Map<string, DerivedBlockCommand>,
) => {
    if (command.intent === 'edit') {
        undoStack.push(command);
        redoStack.splice(0);
        return;
    }
    const targetId = command.targetCommandId;
    if (!targetId) return;
    if (command.intent === 'undo') {
        const at = undoStack.findIndex((candidate) => candidate.id === targetId);
        if (at === -1) return;
        const [target] = undoStack.splice(at, 1);
        redoStack.push({...target, undoCommand: command});
        return;
    }
    const at = redoStack.findIndex((candidate) => candidate.id === targetId);
    if (at === -1) return;
    const [target] = redoStack.splice(at, 1);
    undoStack.push({...target, undoCommand: undefined});
};

const planForUndo = (
    replica: Replica,
    command: DerivedBlockCommand,
    mutateClock = false,
): {ok: true; ops: Array<Op<RichBlockMeta>>} | {ok: false; error: string} => {
    const ts = makeTs(replica, mutateClock);
    const plan = planUndoOps(command.before, replica.state, command.ops, {actor: replica.actor, ts});
    if (!plan.complete) return {ok: false, error: plan.unsupported[0]?.reason ?? 'Undo is blocked.'};
    if (!plan.ops.length) return {ok: false, error: 'Undo has no effect.'};
    return {ok: true, ops: plan.ops};
};

const planForRedo = (
    replica: Replica,
    command: DerivedBlockCommand,
    mutateClock = false,
): {ok: true; ops: Array<Op<RichBlockMeta>>} | {ok: false; error: string} => {
    if (!command.undoCommand) return {ok: false, error: 'Redo is missing its undo command.'};
    const ts = makeTs(replica, mutateClock);
    const plan = planUndoOps(command.undoCommand.before, replica.state, command.undoCommand.ops, {
        actor: replica.actor,
        ts,
    });
    if (!plan.complete) return {ok: false, error: plan.unsupported[0]?.reason ?? 'Redo is blocked.'};
    if (!plan.ops.length) return {ok: false, error: 'Redo has no effect.'};
    return {ok: true, ops: plan.ops};
};

const makeTs = (replica: Replica, mutateClock: boolean) => {
    if (mutateClock) return () => nextReplicaTs(replica);
    let next = nextReplicaClock(replica);
    return () => lamportToString([next++, replica.actor]);
};

const advanceReplicaClocks = (demo: DemoState, actions: HistoryAction[]): DemoState => {
    const nextClock: Record<EditorId, number> = {left: demo.left.clock, right: demo.right.clock};
    for (const action of actions) scanClockValue(action, nextClock);
    return {
        left: {...demo.left, clock: Math.max(demo.left.clock, nextClock.left)},
        right: {...demo.right, clock: Math.max(demo.right.clock, nextClock.right)},
    };
};

const scanClockValue = (value: unknown, nextClock: Record<EditorId, number>) => {
    if (typeof value === 'string') {
        const lamportMatch = /^(\d+)-(left|right)$/.exec(value);
        if (lamportMatch) {
            const actor = lamportMatch[2] as EditorId;
            nextClock[actor] = Math.max(nextClock[actor], Number(lamportMatch[1]) + 1);
        }
        return;
    }
    if (isLamport(value)) {
        const actor = value[1];
        if (actor === 'left' || actor === 'right') nextClock[actor] = Math.max(nextClock[actor], value[0] + 1);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) scanClockValue(item, nextClock);
        return;
    }
    if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) scanClockValue(item, nextClock);
    }
};

const isLamport = (value: unknown): value is [number, string] =>
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    typeof value[1] === 'string';
