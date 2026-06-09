import {deriveBlockParentsForBlocks} from './blocks';
import {compareLamportStrings, lamportToString} from './ids';
import {activeJoinRecords} from './joins';
import {compareLseqIds} from './lseq';
import {Block, Cache, CachedState, Char, JoinRecord, State} from './types';

export const cachedState = (state: State): CachedState => ({
    state,
    cache: organizeState(state.blocks, state.chars, state.joins),
});

export function organizeState(
    blocks: Record<string, Block>,
    chars: Record<string, Char>,
    joins: Record<string, JoinRecord> = {},
): Cache {
    const blockChildren: Record<string, string[]> = {};
    const {parents} = deriveBlockParentsForBlocks(blocks);
    for (const [id] of Object.entries(blocks)) {
        const pid = parents[id];
        if (!blockChildren[pid]) {
            blockChildren[pid] = [];
        }
        blockChildren[pid].push(id);
    }
    const charContents: Record<string, string[]> = {};
    for (const [id, char] of Object.entries(chars)) {
        const pid = lamportToString(char.parent.id);
        if (!charContents[pid]) {
            charContents[pid] = [];
        }
        charContents[pid].push(id);
    }
    Object.values(blockChildren).forEach((items) => {
        items.sort((a, b) => compareLseqIds(blocks[a].order.index, blocks[b].order.index));
    });
    Object.values(charContents).forEach((items) => {
        items.sort((a, b) => compareLamportStrings(b, a));
    });

    const joinSentinels: Record<string, JoinRecord> = {};
    const joinedBlocks: Record<string, JoinRecord> = {};
    for (const join of activeJoinRecords(joins)) {
        const rightId = lamportToString(join.right);
        const tailId = lamportToString(join.tail);
        joinSentinels[rightId] = join;
        joinedBlocks[rightId] = join;
        charContents[tailId] = insertSortedRev(charContents[tailId]?.slice() ?? [], rightId);
    }

    return {blockChildren, charContents, joinSentinels, joinedBlocks};
}

const insertSortedRev = (array: string[], item: string) => {
    for (let i = 0; i < array.length; i++) {
        if (compareLamportStrings(item, array[i]) > 0) {
            array.splice(i, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
};
