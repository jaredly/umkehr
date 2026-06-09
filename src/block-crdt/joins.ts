import {compareLamports, lamportToString} from './ids';
import {CachedState, JoinRecord, State} from './types';

export const activeJoinRecords = (joins: Record<string, JoinRecord>): JoinRecord[] => {
    const active: JoinRecord[] = [];
    const edges: Record<string, string> = {};
    const byId = Object.values(joins).sort((a, b) => compareLamports(a.id, b.id));

    for (const join of byId) {
        const right = lamportToString(join.right);
        const left = lamportToString(join.left);
        if (edges[right]) {
            continue;
        }
        if (joinPathExists(edges, left, right)) {
            continue;
        }
        edges[right] = left;
        active.push(join);
    }

    return active;
};

const joinPathExists = (edges: Record<string, string>, from: string, to: string): boolean => {
    const seen = new Set<string>();
    let current: string | undefined = from;
    while (current) {
        if (current === to) return true;
        if (seen.has(current)) return false;
        seen.add(current);
        current = edges[current];
    }
    return false;
};

export const activeJoinByRightBlock = (
    state: State | CachedState,
): Record<string, JoinRecord> => {
    const joins = 'cache' in state ? state.cache.joinedBlocks : state.joins;
    if ('cache' in state) return joins;
    const result: Record<string, JoinRecord> = {};
    for (const join of activeJoinRecords(joins)) {
        result[lamportToString(join.right)] = join;
    }
    return result;
};

export const joinedBlockIds = (state: State | CachedState): Set<string> =>
    new Set(Object.keys(activeJoinByRightBlock(state)));
