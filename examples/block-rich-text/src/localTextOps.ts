import {applyMany, compareLamportStrings, orderedCharIdsForBlock, type Op} from 'umkehr/block-crdt';
import type {CachedState, Lamport} from 'umkehr/block-crdt/types';
import {lamportToString} from 'umkehr/block-crdt/utils';
import type {RichBlockMeta} from './blockMeta';
import {segmentText} from './selectionModel';
import {richTextVirtualParents} from './virtualParents';

export const localInsertTextOps = (
    state: CachedState<RichBlockMeta>,
    {
        actor,
        block,
        offset,
        text,
    }: {
        actor: string;
        block: Lamport;
        offset: number;
        text: string;
    },
): Array<Op<RichBlockMeta>> => {
    const blockId = lamportToString(block);
    const visibleChars = offset === 0 ? [] : orderedCharIdsForBlock(state, blockId, {visibleOnly: true});
    if (offset < 0 || (offset > 0 && offset > visibleChars.length)) {
        throw new Error(`insert offset out of bounds`);
    }

    let after = offset === 0 ? block : state.state.chars[visibleChars[offset - 1]].id;
    let next = state.state.maxSeenCount + 1;
    const ops: Array<Op<RichBlockMeta>> = [];

    for (const segment of segmentText(text)) {
        const id: Lamport = [next++, actor];
        ops.push({
            type: 'char',
            char: {text: segment, id, deleted: false, parent: {id: after, ts: ''}},
        });
        after = id;
    }

    return ops;
};

export const applyCharInsertOps = (
    state: CachedState<RichBlockMeta>,
    ops: Array<Op<RichBlockMeta>>,
): CachedState<RichBlockMeta> | null => {
    if (!ops.length || !ops.every((op) => op.type === 'char')) return null;

    const chars = {...state.state.chars};
    const charContents = {...state.cache.charContents};
    let maxSeenCount = state.state.maxSeenCount;

    for (const op of ops) {
        if (op.type !== 'char') return null;
        const charId = lamportToString(op.char.id);
        const parentId = lamportToString(op.char.parent.id);
        if (chars[charId]) return null;
        if (!state.state.blocks[parentId] && !chars[parentId] && !state.cache.joinSentinels[parentId]) {
            return null;
        }

        chars[charId] = op.char;
        charContents[parentId] = insertSortedRev(charContents[parentId]?.slice() ?? [], charId);
        maxSeenCount = Math.max(maxSeenCount, op.char.id[0]);
    }

    return {
        state: {
            ...state.state,
            chars,
            maxSeenCount,
        },
        cache: {
            ...state.cache,
            charContents,
        },
    };
};

export const applyCharInsertOpsOrApplyMany = (
    state: CachedState<RichBlockMeta>,
    ops: Array<Op<RichBlockMeta>>,
): CachedState<RichBlockMeta> =>
    applyCharInsertOps(state, ops) ?? applyMany(state, ops, richTextVirtualParents(state));

const insertSortedRev = (array: string[], item: string): string[] => {
    for (let index = 0; index < array.length; index++) {
        if (compareLamportStrings(item, array[index]) > 0) {
            array.splice(index, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
};
