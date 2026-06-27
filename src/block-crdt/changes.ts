import {applyMany, charOp} from './apply.js';
import {
    ROOT_ID,
    materializedBlockParent,
    materializedBlockPath,
    virtualParentOwner,
    type VirtualBlockParentConfig,
} from './blocks.js';
import {isDeleted} from './deletion.js';
import {assertActorId, lamportToString, parseLamportString} from './ids.js';
import {createLseqIdBetween, LseqOptions} from './lseq.js';
import {markRange} from './marks.js';
import {
    charAtVisibleOffset,
    charRecord,
    findTail,
    orderedCharIdsForBlock,
    visibleBlockOutline,
    visibleBlockChildren,
} from './traversal.js';
import {
    Block,
    BlockStylePatch,
    CachedState,
    Char,
    DefaultBlockMeta,
    HLC,
    JsonValue,
    Lamport,
    Op,
    TimestampedBlockMeta,
} from './types.js';

export type InsertBlockOpsOptions<M extends TimestampedBlockMeta> = {
    actor: string;
    id?: Lamport;
    parent: Lamport;
    before?: Lamport | null;
    after?: Lamport | null;
    meta: M;
    ts: HLC;
    options?: LseqOptions;
    virtualParents?: VirtualBlockParentConfig<M>;
};

export type DeleteBlockMode = 'block-only' | 'subtree';

export type DeleteBlockOpsOptions<M extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    block: Lamport;
    ts: () => HLC;
    mode?: DeleteBlockMode;
    virtualParents?: VirtualBlockParentConfig<M>;
};

export type MarkRangePoint = {
    block: Lamport;
    offset: number;
};

export type MarkRange = {
    start: MarkRangePoint;
    end: MarkRangePoint;
};

export const addChars = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    text: string,
    after: Lamport,
    ts: () => HLC,
    actor = 'self',
): CachedState<M> => applyMany(state, insertTextAfterOps(state, {actor, after, text, ts}));

const insertTextAfterOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {
        actor,
        after,
        text,
        ts,
    }: {
        actor: string;
        after: Lamport;
        text: string;
        ts: () => HLC;
    },
): Op<M>[] => {
    let next = state.state.maxSeenCount + 1;
    const ops: Op<M>[] = [];
    for (const char of new Intl.Segmenter().segment(text)) {
        const id: Lamport = [next++, actor];
        ops.push(charOp(char.segment, id, after, ts()));
        after = id;
    }
    return ops;
};

export const insertTextOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {
        actor,
        block,
        offset,
        text,
        ts,
    }: {
        actor: string;
        block: Lamport;
        offset: number;
        text: string;
        ts: () => HLC;
    },
): Op<M>[] =>
    insertTextAfterOps(state, {
        actor,
        after: insertionParentAtVisibleOffset(state, block, offset),
        text,
        ts,
    });

export const deleteRangeOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {block, startOffset, endOffset, ts}: {block: Lamport; startOffset: number; endOffset: number; ts: () => HLC},
): Op<M>[] => {
    if (startOffset > endOffset) {
        throw new Error(`delete range start must be <= end`);
    }
    const ops: Op<M>[] = [];
    for (let offset = startOffset; offset < endOffset; offset++) {
        const id = charAtVisibleOffset(state, block, offset);
        if (!id) {
            throw new Error(`delete range out of bounds`);
        }
        ops.push({type: 'char:delete', id, deleted: {value: true, ts: ts()}});
    }
    return ops;
};

export const splitBlockOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {
        actor,
        block,
        offset,
        ts,
        options,
        virtualParents = {},
    }: {
        actor: string;
        block: Lamport;
        offset: number;
        ts: HLC;
        options?: LseqOptions;
        virtualParents?: VirtualBlockParentConfig<M>;
    },
): Op<M>[] => {
    const blockId = lamportToString(block);
    const chars = orderedCharIdsForBlock(state, blockId, {visibleOnly: true});
    if (offset < 0 || offset > chars.length) {
        throw new Error(`split offset out of bounds`);
    }
    const char =
        offset === chars.length
            ? null
            : offset === 0
              ? block
              : state.state.chars[chars[offset]].id;
    const previous =
        char === null
            ? chars.length
                ? state.state.chars[chars[chars.length - 1]].id
                : null
            : offset > 0
              ? state.state.chars[chars[offset - 1]].id
              : null;
    return split(state, {block, char, previous}, ts, actor, options, virtualParents);
};

export const nextBlockIdForActor = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    actor: string,
): Lamport => [state.state.maxSeenCount + 1, actor];

export const insertBlockOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {
        actor,
        id,
        parent,
        before = null,
        after = null,
        meta,
        ts,
        options,
        virtualParents = {},
    }: InsertBlockOpsOptions<M>,
): Op<M>[] => {
    assertActorId(actor);
    const parentId = lamportToString(parent);
    const beforeId = before ? lamportToString(before) : null;
    const afterId = after ? lamportToString(after) : null;

    if (parentId !== ROOT_ID && !virtualParentExists(state, parentId, virtualParents)) {
        const parentBlock = state.state.blocks[parentId];
        if (!parentBlock || isDeleted(parentBlock) || state.cache.joinedBlocks[parentId]) {
            throw new Error(`insert parent block not found or hidden`);
        }
    }

    const siblings = visibleBlockChildren(state, parentId, virtualParents);
    const beforeIndex = beforeId === null ? -1 : siblings.indexOf(beforeId);
    const afterIndex = afterId === null ? siblings.length : siblings.indexOf(afterId);
    if (beforeId !== null && beforeIndex < 0) {
        throw new Error(`insert before block is not a visible child of the target parent`);
    }
    if (afterId !== null && afterIndex < 0) {
        throw new Error(`insert after block is not a visible child of the target parent`);
    }
    if (beforeId !== null && afterId !== null && beforeId === afterId) {
        throw new Error(`insert before/after anchors must be distinct`);
    }
    if (afterIndex !== beforeIndex + 1) {
        throw new Error(`insert before/after anchors must be adjacent siblings`);
    }

    const blockId = id ?? nextBlockIdForActor(state, actor);
    const parentPath = parentId === ROOT_ID ? [] : materializedPathForParent(state, parentId, virtualParents);
    return [
        {
            type: 'block',
            block: blockBetween(
                blockId,
                meta,
                parentPath,
                beforeId ? state.state.blocks[beforeId].order.index : null,
                afterId ? state.state.blocks[afterId].order.index : null,
                ts,
                actor,
                options,
            ),
        },
    ];
};

export const insertBlockOpsWithId = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    options: InsertBlockOpsOptions<M>,
): {ops: Op<M>[]; id: Lamport; blockId: string} => {
    const ops = insertBlockOps(state, options);
    const op = ops[0];
    if (!op || op.type !== 'block') {
        throw new Error(`insertBlockOps did not create a block op`);
    }
    return {ops, id: op.block.id, blockId: lamportToString(op.block.id)};
};

export const deleteBlockOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {block, ts, mode = 'block-only', virtualParents = {}}: DeleteBlockOpsOptions<M>,
): Op<M>[] => {
    const blockId = lamportToString(block);
    const current = state.state.blocks[blockId];
    if (!current) {
        throw new Error(`delete block not found`);
    }
    if (isDeleted(current) || state.cache.joinedBlocks[blockId]) {
        throw new Error(`delete block not found or hidden`);
    }
    if (mode !== 'block-only' && mode !== 'subtree') {
        throw new Error(`delete block mode must be block-only or subtree`);
    }
    if (mode === 'block-only') {
        return [{type: 'block:delete', id: block, deleted: {value: true, ts: ts()}}];
    }
    const visible = visibleBlockOutline(state, virtualParents);
    const target = visible.find((entry) => entry.id === blockId);
    if (!target) {
        throw new Error(`delete block not found or hidden`);
    }
    return [blockId, ...visibleDescendantIds(visible, blockId)].map((id) => ({
        type: 'block:delete',
        id: state.state.blocks[id].id,
        deleted: {value: true, ts: ts()},
    }));
};

export const joinBlocksOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {actor, left, right, ts}: {actor: string; left: Lamport; right: Lamport; ts: HLC},
): Op<M>[] => join(state, left, right, ts, actor);

export const setBlockMetaOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    _state: CachedState<M>,
    {block, meta}: {block: Lamport; meta: M},
): Op<M>[] => [{type: 'block:meta', id: block, meta}];

export const setBlockStyleOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    _state: CachedState<M>,
    {block, style}: {block: Lamport; style: BlockStylePatch},
): Op<M>[] => [{type: 'block:style', id: block, style}];

export const markRangesOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    ranges: MarkRange[],
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    options: {
        actor: string;
        ts?: HLC;
        nextId?: () => Lamport;
    },
): Op<M>[] => {
    assertActorId(options.actor);
    let next = state.state.maxSeenCount + 1;
    const nextId = options.nextId ?? (() => [next++, options.actor] as Lamport);
    const ops: Op<M>[] = [];
    for (const range of ranges) {
        if (lamportToString(range.start.block) !== lamportToString(range.end.block)) {
            throw new Error(`mark range must be within one block`);
        }
        if (range.start.offset < range.end.offset) {
            ops.push(markRange(state, range.start.block, range.start.offset, range.end.offset, type, data, remove, nextId()));
        }
    }
    return ops;
};

export const markSelectionOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    selection: {
        anchor: {blockId: string; offset: number};
        focus: {blockId: string; offset: number};
    },
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    options: {
        actor: string;
        ts?: HLC;
        nextId?: () => Lamport;
        virtualParents?: VirtualBlockParentConfig<M>;
    },
): Op<M>[] => {
    const blocks = visibleBlockOutline(state, options.virtualParents).map((entry) => entry.id);
    const anchorIndex = blocks.indexOf(selection.anchor.blockId);
    const focusIndex = blocks.indexOf(selection.focus.blockId);
    if (anchorIndex < 0 || focusIndex < 0) {
        throw new Error(`mark selection block not found or hidden`);
    }
    const forward =
        anchorIndex < focusIndex ||
        (anchorIndex === focusIndex && selection.anchor.offset <= selection.focus.offset);
    const start = forward ? selection.anchor : selection.focus;
    const end = forward ? selection.focus : selection.anchor;
    const startIndex = blocks.indexOf(start.blockId);
    const endIndex = blocks.indexOf(end.blockId);
    const ranges: MarkRange[] = [];
    for (let index = startIndex; index <= endIndex; index++) {
        const blockId = blocks[index];
        const block = state.state.blocks[blockId].id;
        const length = orderedCharIdsForBlock(state, blockId, {visibleOnly: true}).length;
        const startOffset = index === startIndex ? Math.max(0, Math.min(start.offset, length)) : 0;
        const endOffset = index === endIndex ? Math.max(0, Math.min(end.offset, length)) : length;
        if (startOffset < endOffset) {
            ranges.push({start: {block, offset: startOffset}, end: {block, offset: endOffset}});
        }
    }
    return markRangesOps(state, ranges, type, data, remove, options);
};

export const moveBlockOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    state: CachedState<M>,
    {
        actor,
        block,
        parent,
        before = null,
        after = null,
        ts,
        options,
        virtualParents = {},
    }: {
        actor: string;
        block: Lamport;
        parent: Lamport;
        before?: Lamport | null;
        after?: Lamport | null;
        ts: HLC;
        options?: LseqOptions;
        virtualParents?: VirtualBlockParentConfig<M>;
    },
): Op<M>[] => {
    const blockId = lamportToString(block);
    const parentId = lamportToString(parent);
    const beforeId = before ? lamportToString(before) : null;
    const afterId = after ? lamportToString(after) : null;
    const current = state.state.blocks[blockId];
    if (!current || isDeleted(current) || state.cache.joinedBlocks[blockId]) {
        throw new Error(`move block not found or hidden`);
    }
    if (
        parentId !== ROOT_ID &&
        !virtualParentExists(state, parentId, virtualParents) &&
        (!state.state.blocks[parentId] || state.cache.joinedBlocks[parentId])
    ) {
        throw new Error(`move parent block not found or hidden`);
    }
    if (
        parentId === blockId ||
        (state.state.blocks[parentId] &&
            parentId !== ROOT_ID &&
            isBlockDescendantOf(state, parentId, blockId, virtualParents))
    ) {
        throw new Error(`move block cannot be reparented into itself or a descendant`);
    }

    const siblings = visibleBlockChildren(state, parentId, virtualParents).filter((id) => id !== blockId);
    const beforeIndex = beforeId === null ? -1 : siblings.indexOf(beforeId);
    const afterIndex = afterId === null ? siblings.length : siblings.indexOf(afterId);
    if (beforeId !== null && beforeIndex < 0) {
        throw new Error(`move before block is not a visible child of the target parent`);
    }
    if (afterId !== null && afterIndex < 0) {
        throw new Error(`move after block is not a visible child of the target parent`);
    }
    if (afterIndex !== beforeIndex + 1) {
        throw new Error(`move before/after anchors must be adjacent siblings`);
    }

    const parentPath = parentId === ROOT_ID ? [] : materializedPathForParent(state, parentId, virtualParents);
    return [
        {
            type: 'block:move',
            id: current.id,
            order: {
                id: [state.state.maxSeenCount + 1, actor],
                path: [...parentPath, current.id],
                index: createLseqIdBetween(
                    beforeId ? state.state.blocks[beforeId].order.index : null,
                    afterId ? state.state.blocks[afterId].order.index : null,
                    {actorId: actor, counter: state.state.maxSeenCount + 1},
                    options,
                ),
                ts,
            },
        },
    ];
};

const virtualParentExists = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    parentId: string,
    config: VirtualBlockParentConfig<M>,
): boolean => Boolean(virtualParentOwner(state, parentId, config));

const materializedPathForParent = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    parentId: string,
    config: VirtualBlockParentConfig<M>,
): Lamport[] => {
    const block = state.state.blocks[parentId];
    if (block) return materializedBlockPath(state, parentId, config);

    const ownerId = virtualParentOwner(state, parentId, config);
    if (!ownerId) throw new Error(`virtual parent not found`);
    return [...materializedBlockPath(state, ownerId, config), parseLamportString(parentId)];
};

const insertionParentAtVisibleOffset = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    block: Lamport,
    offset: number,
): Lamport => {
    if (offset < 0) {
        throw new Error(`insert offset out of bounds`);
    }
    if (offset === 0) {
        return block;
    }
    const id = charAtVisibleOffset(state, block, offset - 1);
    if (!id) {
        throw new Error(`insert offset out of bounds`);
    }
    return id;
};

export const split = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    {state, cache}: CachedState<M>,
    at: {block: Lamport; char: Lamport | null; previous: Lamport | null},
    ts: string,
    actor: string,
    options?: LseqOptions,
    virtualParents: VirtualBlockParentConfig<M> = {},
): Op<M>[] => {
    const {chars, blocks, maxSeenCount} = state;
    const bid = lamportToString(at.block);
    const current = blocks[bid];
    const parent = materializedBlockParent({state, cache}, bid, virtualParents);
    const parentPath = materializedBlockPath({state, cache}, bid, virtualParents).slice(0, -1);
    const siblings = visibleBlockChildren({state, cache}, lamportToString(parent), virtualParents);
    const index = siblings.indexOf(bid);
    const previousId = siblings[index - 1];
    const nextId = siblings[index + 1];
    if (at.char === null) {
        const id: Lamport = [maxSeenCount + 1, actor];
        return [
            {
                type: 'block',
                block: blockBetween(
                    id,
                    current.meta,
                    parentPath,
                    current.order.index,
                    nextId ? blocks[nextId].order.index : null,
                    ts,
                    actor,
                    options,
                    current.style,
                ),
            },
        ];
    }
    if (bid === lamportToString(at.char)) {
        const id: Lamport = [maxSeenCount + 1, actor];
        return [
            {
                type: 'block',
                block: blockBetween(
                    id,
                    current.meta,
                    parentPath,
                    previousId ? blocks[previousId].order.index : null,
                    current.order.index,
                    ts,
                    actor,
                    options,
                    current.style,
                ),
            },
        ];
    }
    const after = nextId ? blocks[nextId].order.index : null;
    const block: Block<M> = {
        id: [maxSeenCount + 1, actor],
        meta: current.meta,
        style: current.style,
        order: {
            id: [maxSeenCount + 1, actor],
            ts,
            path: [...parentPath, [maxSeenCount + 1, actor]],
            index: createLseqIdBetween(
                current.order.index,
                after,
                {
                    actorId: actor,
                    counter: maxSeenCount + 1,
                },
                options,
            ),
        },
        deleted: undefined,
    };
    const ops: Op<M>[] = [{type: 'block', block}];

    if (at.previous && at.char) {
        ops.push({
            type: 'split-record',
            split: {
                id: block.id,
                left: at.previous,
                right: at.char,
            },
        });
    }

    ops.push({
        type: 'char:move',
        id: at.char,
        parent: {
            ts: ts,
            id: block.id,
        },
    });

    const ancestryPath: Lamport[] = [];
    const initialTail = charRecord({state, cache}, findTail(lamportToString(at.char), cache.charContents));
    if (!initialTail) {
        throw new Error(`split tail not found`);
    }
    let tail = initialTail.id;
    let cid = lamportToString(at.char);
    let stop = 1000;
    while (cid !== bid) {
        if (stop-- < 0) throw new Error(`Too deep`);
        ancestryPath.unshift(parseLamportString(cid));

        const currentChar = charRecord({state, cache}, cid);
        if (!currentChar) {
            throw new Error(`split char not found`);
        }
        const pid = lamportToString(currentChar.parent.id);
        const children = cache.charContents[pid] ?? [];
        for (let at = children.indexOf(cid) + 1; at < children.length; at++) {
            const id = children[at];
            const char = chars[id];
            const tailChar = charRecord({state, cache}, findTail(id, cache.charContents));
            if (!tailChar) {
                throw new Error(`split sibling tail not found`);
            }
            if (!char) {
                tail = tailChar.id;
                continue;
            }
            ops.push({
                type: 'char:move',
                id: char.id,
                parent: {
                    ts: [lastMoveTs(char.parent.ts), ancestryPath, ts],
                    id: tail,
                },
            });
            tail = tailChar.id;
        }
        cid = pid;
    }

    return ops;
};

export const join = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    {state, cache}: CachedState<M>,
    left: Lamport,
    right: Lamport,
    ts: string,
    actor: string,
): Op<M>[] => {
    const {blocks} = state;
    const leftId = lamportToString(left);
    const rightId = lamportToString(right);
    if (!blocks[leftId] || !blocks[rightId]) {
        throw new Error(`join block not found`);
    }
    if (isDeleted(blocks[leftId]) || isDeleted(blocks[rightId])) {
        throw new Error(`join block deleted`);
    }
    if (cache.joinedBlocks[leftId] || cache.joinedBlocks[rightId]) {
        throw new Error(`join block deleted`);
    }

    const leftRoots = cache.charContents[leftId] ?? [];
    const tail = leftRoots.length
        ? parseLamportString(findTail(leftRoots[leftRoots.length - 1], cache.charContents))
        : left;

    return [
        {
            type: 'join-record',
            join: {
                id: [state.maxSeenCount + 1, actor],
                left,
                right,
                tail,
                ts,
            },
        },
    ];
};

const blockBetween = <M extends TimestampedBlockMeta>(
    id: Lamport,
    meta: M,
    parentPath: Lamport[],
    before: Block['order']['index'] | null,
    after: Block['order']['index'] | null,
    ts: string,
    actor: string,
    options?: LseqOptions,
    style: Block['style'] = {},
): Block<M> => ({
    id,
    meta,
    style,
    order: {
        id,
        ts,
        path: [...parentPath, id],
        index: createLseqIdBetween(
            before,
            after,
            {
                actorId: actor,
                counter: id[0],
            },
            options,
        ),
    },
    deleted: undefined,
});

const isBlockDescendantOf = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
    ancestorId: string,
    virtualParents: VirtualBlockParentConfig<M> = {},
): boolean => materializedBlockPath(state, blockId, virtualParents).map(lamportToString).includes(ancestorId);

const visibleDescendantIds = (outline: {id: string; parentId: string}[], blockId: string): string[] => {
    const result: string[] = [];
    const visit = (parent: string) => {
        for (const entry of outline) {
            if (entry.parentId !== parent) continue;
            result.push(entry.id);
            visit(entry.id);
        }
    };
    visit(blockId);
    return result;
};

const lastMoveTs = (ts: Char['parent']['ts']) => (typeof ts === 'string' ? ts : ts[2]);
