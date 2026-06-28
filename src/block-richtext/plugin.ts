import {
    applyMany,
    cachedState,
    deleteRangeOps,
    insertTextOps,
    joinBlocksOps,
    lamportToString,
    maxLamportCounterForOp,
    moveBlockOps,
    planUndoOps,
    parseLamportString,
    setBlockMetaOps,
    splitBlockOps,
    validateOp,
    type Lamport,
    type Op,
    type State as BlockState,
} from '../block-crdt/index.js';
import {initialStateWithMeta} from '../block-crdt/initialState.js';
import {paragraphMeta, richTextCrdtConfig, type RichBlockMeta} from '../block-editor/index.js';
import {defineLeafBuilderExtension} from '../builderExtensions.js';
import {deepEqual as equal} from '../deepEqual.js';
import type {LeafCrdtPlugin} from '../crdt/plugins.js';
import {normalPathForCrdtPath} from '../crdt/path.js';
import type {BlockedEffect, LocalEffect} from '../crdt/history.js';
import type {CrdtDocument, CrdtUpdate, HlcTimestamp, JsonValue, LeafMeta} from '../crdt/types.js';
import type {BlockRichText} from './index.js';

export const BLOCK_RICH_TEXT_LEAF_PLUGIN_ID = 'umkehr.block-rich-text';
export const BLOCK_RICH_TEXT_LEAF_PLUGIN_VERSION = 1;
export const BLOCK_RICH_TEXT_INITIAL_SESSION = 'seed';
export const BLOCK_RICH_TEXT_INITIAL_TS = '000000000000000:00000:seed';

export type BlockRichTextLeafMeta = {
    maxSeenCount: number;
};

export type BlockRichTextLamportRef = string | Lamport;

export type BlockRichTextOpsChange = {
    kind: 'ops';
    ops: Array<Op<RichBlockMeta>>;
};

export type BlockRichTextInsertTextChange = {
    kind: 'insertText';
    block: BlockRichTextLamportRef;
    offset: number;
    text: string;
};

export type BlockRichTextDeleteRangeChange = {
    kind: 'deleteRange';
    block: BlockRichTextLamportRef;
    startOffset: number;
    endOffset: number;
};

export type BlockRichTextSplitBlockChange = {
    kind: 'splitBlock';
    block: BlockRichTextLamportRef;
    offset: number;
};

export type BlockRichTextJoinBlocksChange = {
    kind: 'joinBlocks';
    left: BlockRichTextLamportRef;
    right: BlockRichTextLamportRef;
};

export type BlockRichTextMoveBlockArgs = {
    block: BlockRichTextLamportRef;
    parent: BlockRichTextLamportRef;
    before?: BlockRichTextLamportRef | null;
    after?: BlockRichTextLamportRef | null;
};

export type BlockRichTextMoveBlockChange = {
    kind: 'moveBlock';
} & BlockRichTextMoveBlockArgs;

export type BlockRichTextSetBlockMetaChange = {
    kind: 'setBlockMeta';
    block: BlockRichTextLamportRef;
    meta: RichBlockMeta;
};

export type BlockRichTextPatchChange =
    | BlockRichTextOpsChange
    | BlockRichTextInsertTextChange
    | BlockRichTextDeleteRangeChange
    | BlockRichTextSplitBlockChange
    | BlockRichTextJoinBlocksChange
    | BlockRichTextMoveBlockChange
    | BlockRichTextSetBlockMetaChange;

export type BlockRichTextOpsCommand = Omit<BlockRichTextOpsChange, 'kind'>;
export type BlockRichTextInsertTextCommand = Omit<BlockRichTextInsertTextChange, 'kind'>;
export type BlockRichTextDeleteRangeCommand = Omit<BlockRichTextDeleteRangeChange, 'kind'>;
export type BlockRichTextSplitBlockCommand = Omit<BlockRichTextSplitBlockChange, 'kind'>;
export type BlockRichTextJoinBlocksCommand = Omit<BlockRichTextJoinBlocksChange, 'kind'>;
export type BlockRichTextMoveBlockCommand = BlockRichTextMoveBlockArgs;
export type BlockRichTextSetBlockMetaCommand = Omit<BlockRichTextSetBlockMetaChange, 'kind'>;

export const blockRichTextBuilderExtension = defineLeafBuilderExtension<
    BlockRichText,
    BlockRichTextPatchChange
>()({
    key: '$block',
    plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    commands: {
        ops: (change: BlockRichTextOpsCommand): BlockRichTextOpsChange => ({
            kind: 'ops',
            ...change,
        }),
        insertText: (change: BlockRichTextInsertTextCommand): BlockRichTextInsertTextChange => ({
            kind: 'insertText',
            ...change,
        }),
        deleteRange: (change: BlockRichTextDeleteRangeCommand): BlockRichTextDeleteRangeChange => ({
            kind: 'deleteRange',
            ...change,
        }),
        splitBlock: (change: BlockRichTextSplitBlockCommand): BlockRichTextSplitBlockChange => ({
            kind: 'splitBlock',
            ...change,
        }),
        joinBlocks: (change: BlockRichTextJoinBlocksCommand): BlockRichTextJoinBlocksChange => ({
            kind: 'joinBlocks',
            ...change,
        }),
        moveBlock: (change: BlockRichTextMoveBlockCommand): BlockRichTextMoveBlockChange => ({
            kind: 'moveBlock',
            ...change,
        }),
        setBlockMeta: (
            change: BlockRichTextSetBlockMetaCommand,
        ): BlockRichTextSetBlockMetaChange => ({
            kind: 'setBlockMeta',
            ...change,
        }),
    },
});

export const blockRichTextLeafPlugin: LeafCrdtPlugin<
    typeof BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    JsonValue,
    BlockRichTextPatchChange,
    JsonValue,
    JsonValue
> = {
    id: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    version: BLOCK_RICH_TEXT_LEAF_PLUGIN_VERSION,
    builder: blockRichTextBuilderExtension,
    empty() {
        return blockRichTextJson(
            initialBlockRichTextState(),
        );
    },
    isValue(value): value is JsonValue {
        return isBlockRichTextJson(value);
    },
    init({value}) {
        const nextValue = isBlockRichTextJson(value)
            ? value
            : blockRichTextJson(
                  initialBlockRichTextState(),
              );
        return {
            value: nextValue,
            meta: {maxSeenCount: blockStateFromJson(nextValue).maxSeenCount},
        };
    },
    createOperations({value, change, ts, context}) {
        return createBlockRichTextOperations(
            blockStateFromJson(value),
            change,
            ts,
            context.sessionId,
        ) as JsonValue[];
    },
    applyOperation({value, meta, operation}) {
        const op = operation as unknown as Op<RichBlockMeta>;
        const current = cachedState(blockStateFromJson(value));
        const nextState = applyMany(current, [op], richTextCrdtConfig(current)).state;
        const previous = meta.data as BlockRichTextLeafMeta | undefined;
        const maxSeenCount = Math.max(
            previous?.maxSeenCount ?? 0,
            nextState.maxSeenCount,
            maxLamportCounterForOp(op),
        );
        return {
            value: blockRichTextJson(nextState),
            meta: {maxSeenCount} as JsonValue,
        };
    },
    validateOperation(input) {
        if (!isRecord(input) || typeof input.type !== 'string') {
            return {
                success: false,
                errors: [
                    {
                        path: '<operation>',
                        message: 'Block rich text operation must be a block-crdt op object.',
                        expected: 'block-crdt Op',
                        value: input,
                    },
                ],
            };
        }
        let result: ReturnType<typeof validateOp>;
        try {
            result = validateOp(input as unknown as Op);
        } catch (error) {
            return {
                success: false,
                errors: [
                    {
                        path: '<operation>',
                        message: error instanceof Error ? error.message : String(error),
                        expected: 'block-crdt Op',
                        value: input,
                    },
                ],
            };
        }
        return result.valid
            ? {success: true, data: input as JsonValue}
            : {
                  success: false,
                  errors: result.errors.map((message) => ({path: '<operation>', message})),
              };
    },
    captureEffect({path, localTs, before, after, operation}) {
        return {
            kind: 'leaf',
            plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
            path,
            localTs,
            before,
            after,
            change: operation,
        };
    },
    createUndoOperationsForEffects({doc, effects, ts, context}) {
        return createBlockRichTextUndoUpdates(doc, effects, ts, context.sessionId);
    },
    createRedoOperationsForEffects({doc, redoGuardEffects, ts, context}) {
        return createBlockRichTextUndoUpdates(doc, redoGuardEffects ?? [], ts, context.sessionId);
    },
    checkEffect({doc, command, effect}) {
        return checkBlockRichTextEffectTarget(doc, command, effect);
    },
};

function createBlockRichTextOperations(
    state: BlockState<RichBlockMeta>,
    change: BlockRichTextPatchChange,
    ts: HlcTimestamp,
    sessionId: string,
): Array<Op<RichBlockMeta>> {
    const cached = cachedState(state);
    switch (change.kind) {
        case 'ops':
            return change.ops;
        case 'insertText':
            return insertTextOps(cached, {
                actor: sessionId,
                block: lamportRef(change.block),
                offset: change.offset,
                text: change.text,
                ts: () => ts,
            });
        case 'deleteRange':
            return deleteRangeOps(cached, {
                block: lamportRef(change.block),
                startOffset: change.startOffset,
                endOffset: change.endOffset,
                ts: () => ts,
            });
        case 'splitBlock':
            return splitBlockOps(cached, {
                actor: sessionId,
                block: lamportRef(change.block),
                offset: change.offset,
                ts,
            });
        case 'joinBlocks':
            return joinBlocksOps(cached, {
                actor: sessionId,
                left: lamportRef(change.left),
                right: lamportRef(change.right),
                ts,
            });
        case 'moveBlock':
            return moveBlockOps(cached, {
                actor: sessionId,
                block: lamportRef(change.block),
                parent: lamportRef(change.parent),
                before: change.before ? lamportRef(change.before) : null,
                after: change.after ? lamportRef(change.after) : null,
                ts,
            });
        case 'setBlockMeta':
            return setBlockMetaOps(cached, {
                block: lamportRef(change.block),
                meta: change.meta,
            });
    }
}

function lamportRef(ref: BlockRichTextLamportRef): Lamport {
    return typeof ref === 'string' ? parseLamportString(ref) : ref;
}

function blockRichTextJson(state: BlockState<RichBlockMeta>): JsonValue {
    return {
        kind: 'block-rich-text',
        version: 1,
        state: state as unknown as JsonValue,
    };
}

function blockStateFromJson(value: JsonValue): BlockState<RichBlockMeta> {
    return (value as unknown as BlockRichText).state;
}

type BlockRichTextLeafEffect = Extract<LocalEffect, {kind: 'leaf'}>;

function createBlockRichTextUndoUpdates(
    doc: CrdtDocument<unknown>,
    effects: BlockRichTextLeafEffect[],
    ts: HlcTimestamp,
    sessionId: string,
): CrdtUpdate[] {
    const first = effects[0];
    if (!first || !isBlockRichTextJson(first.before)) return [];
    const current = blockRichTextAtCrdtPath(doc, first.path);
    if (!current) return [];
    const plan = planUndoOps(
        cachedState(blockStateFromJson(first.before)),
        cachedState(blockStateFromJson(current)),
        effects.map((effect) => effect.change as unknown as Op<RichBlockMeta>),
        {actor: sessionId, ts: () => ts},
    );
    if (!plan.complete) return [];
    return plan.ops.map(
        (op): CrdtUpdate => ({
            op: 'leaf',
            plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
            path: first.path,
            change: op as unknown as JsonValue,
            ts,
        }),
    );
}

function checkBlockRichTextEffectTarget(
    doc: CrdtDocument<unknown>,
    command: {id: HlcTimestamp},
    effect: BlockRichTextLeafEffect,
): BlockedEffect | null {
    const before = effect.before;
    const target = blockRichTextAtCrdtPath(doc, effect.path);
    if (!target || !isBlockRichTextJson(before)) return {command, effect, reason: 'missing-target'};
    const operation = effect.change as unknown as Op<RichBlockMeta>;
    const targetIssue = blockOperationTargetIssue(blockStateFromJson(target), operation);
    if (targetIssue) return {command, effect, reason: targetIssue};
    try {
        const plan = planUndoOps(
            cachedState(blockStateFromJson(before)),
            cachedState(blockStateFromJson(target)),
            [operation],
            {actor: 'check', ts: () => effect.localTs || command.id},
        );
        return plan.complete ? null : {command, effect, reason: 'unsupported'};
    } catch {
        return {command, effect, reason: 'unsupported'};
    }
}

function blockOperationTargetIssue(
    state: BlockState<RichBlockMeta>,
    op: Op<RichBlockMeta>,
): BlockedEffect['reason'] | null {
    switch (op.type) {
        case 'char': {
            const char = state.chars[lamportToString(op.char.id)];
            if (!char) return 'missing-target';
            return char.deleted ? 'deleted' : null;
        }
        case 'char:delete': {
            const char = state.chars[lamportToString(op.id)];
            if (!char) return 'missing-target';
            return char.deleted ? null : 'superseded';
        }
        case 'char:move': {
            const char = state.chars[lamportToString(op.id)];
            if (!char) return 'missing-target';
            if (char.deleted) return 'deleted';
            return equal(char.parent, op.parent) ? null : 'superseded';
        }
        case 'block': {
            const block = state.blocks[lamportToString(op.block.id)];
            if (!block) return 'missing-target';
            return block.deleted ? 'deleted' : null;
        }
        case 'block:delete': {
            const block = state.blocks[lamportToString(op.id)];
            if (!block) return 'missing-target';
            return block.deleted ? null : 'superseded';
        }
        case 'block:move': {
            const block = state.blocks[lamportToString(op.id)];
            if (!block) return 'missing-target';
            if (block.deleted) return 'deleted';
            return equal(block.order, op.order) ? null : 'superseded';
        }
        case 'block:meta': {
            const block = state.blocks[lamportToString(op.id)];
            if (!block) return 'missing-target';
            if (block.deleted) return 'deleted';
            return equal(block.meta, op.meta) ? null : 'superseded';
        }
        case 'block:style': {
            const block = state.blocks[lamportToString(op.id)];
            if (!block) return 'missing-target';
            if (block.deleted) return 'deleted';
            return Object.entries(op.style).every(([key, value]) => equal(block.style[key], value))
                ? null
                : 'superseded';
        }
        case 'mark': {
            const mark = state.marks[lamportToString(op.mark.id)];
            if (!mark) return 'missing-target';
            return equal(mark, op.mark) ? null : 'superseded';
        }
        case 'split-record':
            return state.splits[lamportToString(op.split.id)] ? null : 'missing-target';
        case 'join-record':
            return state.joins[lamportToString(op.join.id)] ? null : 'missing-target';
    }
}

function blockRichTextAtCrdtPath(
    doc: CrdtDocument<unknown>,
    path: BlockRichTextLeafEffect['path'],
): JsonValue | undefined {
    const normalPath = normalPathForCrdtPath(doc, path);
    if (!normalPath) return undefined;
    let value: unknown = doc.state;
    for (const segment of normalPath) {
        if (!value || typeof value !== 'object') return undefined;
        value = (value as Record<string | number, unknown>)[segment.key];
    }
    return isBlockRichTextJson(value) ? structuredClone(value) : undefined;
}

function isBlockRichTextJson(value: unknown): value is JsonValue {
    return Boolean(
        value &&
        typeof value === 'object' &&
        (value as {kind?: unknown}).kind === 'block-rich-text' &&
        (value as {version?: unknown}).version === 1 &&
        valueHasBlockState((value as {state?: unknown}).state),
    );
}

function valueHasBlockState(value: unknown): value is BlockState<RichBlockMeta> {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as {chars?: unknown}).chars &&
        (value as {blocks?: unknown}).blocks &&
        (value as {marks?: unknown}).marks &&
        (value as {splits?: unknown}).splits &&
        (value as {joins?: unknown}).joins &&
        typeof (value as {maxSeenCount?: unknown}).maxSeenCount === 'number',
    );
}

function initialBlockRichTextState(): BlockState<RichBlockMeta> {
    return initialStateWithMeta(
        BLOCK_RICH_TEXT_INITIAL_SESSION,
        paragraphMeta(BLOCK_RICH_TEXT_INITIAL_TS),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
