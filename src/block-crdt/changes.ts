import {applyMany, charOp} from './apply';
import {materializedBlockParent, materializedBlockPath} from './blocks';
import {lamportToString, parseLamportString} from './ids';
import {createLseqIdBetween, LseqOptions} from './lseq';
import {
    charAtVisibleOffset,
    charRecord,
    findTail,
    orderedCharIdsForBlock,
} from './traversal';
import {Block, CachedState, Char, HLC, Lamport, Op} from './types';

export const addChars = (
    state: CachedState,
    text: string,
    after: Lamport,
    ts: () => HLC,
    actor = 'self',
): CachedState => applyMany(state, insertTextAfterOps(state, {actor, after, text, ts}));

const insertTextAfterOps = (
    state: CachedState,
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
): Op[] => {
    let next = state.state.maxSeenCount + 1;
    const ops: Op[] = [];
    for (const char of new Intl.Segmenter().segment(text)) {
        const id: Lamport = [next++, actor];
        ops.push(charOp(char.segment, id, after, ts()));
        after = id;
    }
    return ops;
};

export const insertTextOps = (
    state: CachedState,
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
): Op[] =>
    insertTextAfterOps(state, {
        actor,
        after: insertionParentAtVisibleOffset(state, block, offset),
        text,
        ts,
    });

export const deleteRangeOps = (
    state: CachedState,
    {block, startOffset, endOffset}: {block: Lamport; startOffset: number; endOffset: number},
): Op[] => {
    if (startOffset > endOffset) {
        throw new Error(`delete range start must be <= end`);
    }
    const ops: Op[] = [];
    for (let offset = startOffset; offset < endOffset; offset++) {
        const id = charAtVisibleOffset(state, block, offset);
        if (!id) {
            throw new Error(`delete range out of bounds`);
        }
        ops.push({type: 'char:delete', id});
    }
    return ops;
};

export const splitBlockOps = (
    state: CachedState,
    {
        actor,
        block,
        offset,
        ts,
        options,
    }: {
        actor: string;
        block: Lamport;
        offset: number;
        ts: HLC;
        options?: LseqOptions;
    },
): Op[] => {
    const blockId = lamportToString(block);
    const chars = orderedCharIdsForBlock(state, blockId, {visibleOnly: true});
    if (offset < 0 || offset > chars.length) {
        throw new Error(`split offset out of bounds`);
    }
    const char =
        offset === 0
            ? block
            : offset === chars.length
              ? null
              : state.state.chars[chars[offset]].id;
    const previous =
        char === null
            ? chars.length
                ? state.state.chars[chars[chars.length - 1]].id
                : null
            : offset > 0
              ? state.state.chars[chars[offset - 1]].id
              : null;
    return split(state, {block, char, previous}, ts, actor, options);
};

export const joinBlocksOps = (
    state: CachedState,
    {actor, left, right, ts}: {actor: string; left: Lamport; right: Lamport; ts: HLC},
): Op[] => join(state, left, right, ts, actor);

export const setBlockMetaOps = (
    _state: CachedState,
    {block, meta}: {block: Lamport; meta: Block['meta']},
): Op[] => [{type: 'block:meta', id: block, meta}];

const insertionParentAtVisibleOffset = (
    state: CachedState,
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

export const split = (
    {state, cache}: CachedState,
    at: {block: Lamport; char: Lamport | null; previous: Lamport | null},
    ts: string,
    actor: string,
    options?: LseqOptions,
): Op[] => {
    const {chars, blocks, maxSeenCount} = state;
    const bid = lamportToString(at.block);
    const current = blocks[bid];
    const parent = materializedBlockParent({state, cache}, bid);
    const parentPath = materializedBlockPath({state, cache}, bid).slice(0, -1);
    const siblings = cache.blockChildren[lamportToString(parent)] ?? [];
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
                ),
            },
        ];
    }
    const after = nextId ? blocks[nextId].order.index : null;
    const block: Block = {
        id: [maxSeenCount + 1, actor],
        meta: current.meta,
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
        deleted: false,
    };
    const ops: Op[] = [{type: 'block', block}];

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

export const join = (
    {state, cache}: CachedState,
    left: Lamport,
    right: Lamport,
    ts: string,
    actor: string,
): Op[] => {
    const {blocks} = state;
    const leftId = lamportToString(left);
    const rightId = lamportToString(right);
    if (!blocks[leftId] || !blocks[rightId]) {
        throw new Error(`join block not found`);
    }
    if (blocks[leftId].deleted || blocks[rightId].deleted) {
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

const blockBetween = (
    id: Lamport,
    meta: Block['meta'],
    parentPath: Lamport[],
    before: Block['order']['index'] | null,
    after: Block['order']['index'] | null,
    ts: string,
    actor: string,
    options?: LseqOptions,
): Block => ({
    id,
    meta,
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
    deleted: false,
});

const lastMoveTs = (ts: Char['parent']['ts']) => (typeof ts === 'string' ? ts : ts[2]);
