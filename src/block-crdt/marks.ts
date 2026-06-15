import equal from 'fast-deep-equal';
import {compareLamports, lamportToString} from './ids.js';
import {
    charAtVisibleOffset,
    charRecord,
    hasJoinStyleParent,
    orderedCharIdsForBlock,
    visibleBlockOutline,
} from './traversal.js';
import {type VirtualBlockParentConfig} from './blocks.js';
import {Block, CachedState, JsonValue, Lamport, Mark, Op, SplitRecord, TimestampedBlockMeta} from './types.js';

export const splitRecordsByLeft = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
): Record<string, SplitRecord[]> => {
    const result: Record<string, SplitRecord[]> = {};
    for (const split of Object.values(state.state.splits)) {
        const left = lamportToString(split.left);
        result[left] = result[left] ?? [];
        result[left].push(split);
    }
    for (const splits of Object.values(result)) {
        splits.sort((a, b) => compareLamports(a.right, b.right) || compareLamports(a.id, b.id));
    }
    return result;
};

export type FormattedMarkValue = JsonValue | true;

export type FormattedRun = {
    text: string;
    marks: Record<string, FormattedMarkValue>;
    stackedMarks?: Record<string, FormattedMarkValue[]>;
};

export type FormattedBlock<M extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    block: Block<M>;
    runs: FormattedRun[];
    depth: number;
    parentId: string;
};

export const markOp = <M extends TimestampedBlockMeta = TimestampedBlockMeta>(
    id: Lamport,
    start: Lamport,
    end: Lamport,
    type: string,
    data?: JsonValue,
    remove = false,
    crossedSplits: Lamport[] = [],
): Op<M> => ({
    type: 'mark',
    mark: {
        id,
        start: {id: start, at: 'before'},
        end: {id: end, at: 'after'},
        remove,
        type,
        data,
        crossedSplits,
    },
});

export const markRange = <M extends TimestampedBlockMeta = TimestampedBlockMeta>(
    state: CachedState<M>,
    block: Lamport,
    startOffset: number,
    endOffset: number,
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    id: Lamport,
): Op<M> => {
    if (startOffset >= endOffset) {
        throw new Error(`mark range must not be empty`);
    }
    const start = charAtVisibleOffset(state, block, startOffset);
    const end = charAtVisibleOffset(state, block, endOffset - 1);
    if (!start || !end) {
        throw new Error(`mark range must anchor to characters`);
    }
    return markOp(id, start, end, type, data, remove, crossedSplitsBetween(state, start, end));
};

export const materializeFormattedBlocks = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
): FormattedBlock<M>[] => {
    const coveredByMark: Record<string, Mark[]> = {};
    const marks = Object.values(state.state.marks).sort((a, b) => compareLamports(a.id, b.id));
    for (const mark of marks) {
        for (const charId of coveredCharIdsForMark(state, mark, config)) {
            coveredByMark[charId] = coveredByMark[charId] ?? [];
            coveredByMark[charId].push(mark);
        }
    }

    return visibleBlockOutline(state, config).map(({id, depth, parentId}) => {
        const runs: FormattedRun[] = [];
        for (const charId of orderedCharIdsForBlock(state, id, {visibleOnly: true})) {
            const char = charRecord(state, charId);
            if (!char) continue;
            const {marks, stackedMarks} = resolveMarks(coveredByMark[charId] ?? [], config);
            const last = runs[runs.length - 1];
            const nextStackedMarks = hasEntries(stackedMarks) ? stackedMarks : undefined;
            if (last && equal(last.marks, marks) && equal(last.stackedMarks, nextStackedMarks)) {
                last.text += char.text;
            } else {
                runs.push({text: char.text, marks, ...(nextStackedMarks ? {stackedMarks: nextStackedMarks} : {})});
            }
        }
        return {id, block: state.state.blocks[id], runs, depth, parentId};
    });
};

const crossedSplitsBetween = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    start: Lamport,
    end: Lamport,
): Lamport[] => {
    const splitRecords = splitRecordsByLeft(state);
    const sequence = allCharIds(state);
    const nextById = nextIdMap(sequence);
    const crossed: Lamport[] = [];
    const seen = new Set<string>();
    let current: string | undefined = lamportToString(start);
    const endId = lamportToString(end);
    while (current) {
        if (seen.has(current)) {
            throw new Error(`split traversal cycle at ${current}`);
        }
        seen.add(current);
        const split = splitRecords[current]?.[0];
        if (split) {
            crossed.push(split.id);
        }
        if (current === endId) {
            break;
        }
        current = nextById[current];
    }
    return crossed;
};

export const coveredCharIdsForMark = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    mark: Mark,
    config: VirtualBlockParentConfig<M>,
): string[] => {
    const sequence = allCharIds(state, config);
    const nextById = nextIdMap(sequence);
    const splitRecords = splitRecordsByLeft(state);
    const crossed = new Set(mark.crossedSplits.map(lamportToString));
    const covered: string[] = [];
    const forcedNext: Record<string, string> = {};
    const seen = new Set<string>();
    let current =
        mark.start.at === 'before'
            ? lamportToString(mark.start.id)
            : nextById[lamportToString(mark.start.id)];
    const end = lamportToString(mark.end.id);

    while (current) {
        if (seen.has(current)) {
            throw new Error(`mark traversal cycle at ${current}`);
        }
        seen.add(current);
        if (mark.end.at === 'before' && current === end) {
            break;
        }
        covered.push(current);
        if (mark.end.at === 'after' && current === end) {
            break;
        }
        if (forcedNext[current]) {
            current = forcedNext[current];
            continue;
        }
        const split = splitRecords[current]?.find((split) => !crossed.has(lamportToString(split.id)));
        if (split) {
            const path = pathForFollowedSplit(state, split);
            for (let i = 0; i < path.length - 1; i++) {
                forcedNext[path[i]] = path[i + 1];
            }
            current = forcedNext[current] ?? lamportToString(split.right);
            continue;
        }
        current = nextById[current];
    }
    return covered;
};

const allCharIds = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
): string[] => visibleBlockOutline(state, config).flatMap(({id}) => orderedCharIdsForBlock(state, id));

const nextIdMap = (sequence: string[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (let i = 0; i < sequence.length - 1; i++) {
        result[sequence[i]] = sequence[i + 1];
    }
    return result;
};

const pathForFollowedSplit = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    split: SplitRecord,
): string[] => {
    const left = lamportToString(split.left);
    const right = lamportToString(split.right);
    const tail = tailAfterSplitLeft(state, left);
    if (tail[tail.length - 1] === right) {
        return [left, ...tail];
    }
    return [left, ...tail, right];
};

const tailAfterSplitLeft = <M extends TimestampedBlockMeta>(state: CachedState<M>, left: string): string[] => {
    const result: string[] = [];
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
        if (seen.has(id)) {
            throw new Error(`split tail traversal cycle at ${id}`);
        }
        seen.add(id);
        result.push(id);
        if (hasJoinStyleParent(state, id)) {
            return true;
        }
        for (const child of state.cache.charContents[id] ?? []) {
            if (visit(child)) {
                return true;
            }
        }
        return false;
    };
    for (const child of state.cache.charContents[left] ?? []) {
        if (visit(child)) {
            break;
        }
    }
    return result;
};

const resolveMarks = <M extends TimestampedBlockMeta>(
    marks: Mark[],
    config: VirtualBlockParentConfig<M>,
): {marks: Record<string, FormattedMarkValue>; stackedMarks: Record<string, FormattedMarkValue[]>} => {
    const stacking: Record<string, Mark[]> = {};
    const winning: Record<string, Mark> = {};
    for (const mark of marks) {
        if (config.markBehavior?.[mark.type] === 'stacking') {
            if (!mark.remove) {
                stacking[mark.type] = stacking[mark.type] ?? [];
                stacking[mark.type].push(mark);
            } else if (mark.data === undefined) {
                stacking[mark.type] = [];
            } else {
                stacking[mark.type] = (stacking[mark.type] ?? []).filter((stacked) => !equal(stacked.data, mark.data));
            }
            continue;
        }
        const current = winning[mark.type];
        if (!current || compareLamports(current.id, mark.id) < 0) {
            winning[mark.type] = mark;
        }
    }
    const stackedMarks: Record<string, FormattedMarkValue[]> = {};
    for (const [type, typeMarks] of Object.entries(stacking)) {
        if (!typeMarks.length) continue;
        stackedMarks[type] = typeMarks
            .sort((a, b) => compareLamports(a.id, b.id))
            .map((mark) => mark.data ?? true);
    }
    const result: Record<string, FormattedMarkValue> = {};
    for (const mark of Object.values(winning)) {
        if (!mark.remove) {
            result[mark.type] = mark.data ?? true;
        }
    }
    return {marks: result, stackedMarks};
};

const hasEntries = (value: Record<string, unknown>): boolean => Object.keys(value).length > 0;
