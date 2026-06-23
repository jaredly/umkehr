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
import {Block, Boundary, CachedState, JsonValue, Lamport, Mark, Op, SplitRecord, TimestampedBlockMeta} from './types.js';

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

export type VisibleMarkRange = {
    blockId: string;
    startOffset: number;
    endOffset: number;
};

export type FormattedBlock<M extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    block: Block<M>;
    runs: FormattedRun[];
    depth: number;
    parentId: string;
};

type VisibleOutlineEntry = {
    id: string;
    depth: number;
    parentId: string;
};

type MarkTraversalContext = {
    outline: VisibleOutlineEntry[];
    blockCharIds: Map<string, string[]>;
    blockVisibleCharIds: Map<string, string[]>;
    allCharIds: string[];
    nextById: Record<string, string>;
    splitRecords: Record<string, SplitRecord[]>;
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

export const markBoundaryOp = <M extends TimestampedBlockMeta = TimestampedBlockMeta>(
    id: Lamport,
    start: Boundary,
    end: Boundary | undefined,
    type: string,
    data?: JsonValue,
    remove = false,
    crossedSplits: Lamport[] = [],
): Op<M> => ({
    type: 'mark',
    mark: {
        id,
        start,
        ...(end ? {end} : {}),
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
    const context = createMarkTraversalContext(state, config);
    const coveredByMark: Record<string, Mark[]> = {};
    const marks = Object.values(state.state.marks).sort((a, b) => compareLamports(a.id, b.id));
    for (const mark of marks) {
        for (const charId of coveredCharIdsForMarkWithContext(state, mark, context)) {
            coveredByMark[charId] = coveredByMark[charId] ?? [];
            coveredByMark[charId].push(mark);
        }
    }

    return context.outline.map(({id, depth, parentId}) => {
        const runs: FormattedRun[] = [];
        for (const charId of context.blockVisibleCharIds.get(id) ?? []) {
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

export const formattedMarkValues = (run: FormattedRun, type: string): FormattedMarkValue[] => [
    ...(run.stackedMarks?.[type] ?? []),
    ...(run.marks[type] === undefined ? [] : [run.marks[type]]),
];

export const visibleRangesForMark = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    mark: Mark,
    config: VirtualBlockParentConfig<M> = {},
): VisibleMarkRange[] => {
    const covered = new Set(coveredCharIdsForMark(state, mark, config));
    const ranges: VisibleMarkRange[] = [];
    for (const {id: blockId} of visibleBlockOutline(state, config)) {
        let startOffset: number | null = null;
        const chars = orderedCharIdsForBlock(state, blockId, {visibleOnly: true});
        for (let offset = 0; offset <= chars.length; offset++) {
            const charId = chars[offset];
            if (charId && covered.has(charId)) {
                startOffset ??= offset;
                continue;
            }
            if (startOffset !== null) {
                ranges.push({blockId, startOffset, endOffset: offset});
                startOffset = null;
            }
        }
    }
    return ranges;
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
    const context = createMarkTraversalContext(state, config);
    return coveredCharIdsForMarkWithContext(state, mark, context);
};

const coveredCharIdsForMarkWithContext = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    mark: Mark,
    context: MarkTraversalContext,
): string[] => {
    const sequence = mark.end ? context.allCharIds : charIdsForOpenEndedMarkWithContext(mark, context);
    const nextById = mark.end ? context.nextById : nextIdMap(sequence);
    const crossed = new Set(mark.crossedSplits.map(lamportToString));
    const covered: string[] = [];
    const forcedNext: Record<string, string> = {};
    const seen = new Set<string>();
    let current =
        mark.start.at === 'before'
            ? lamportToString(mark.start.id)
            : nextById[lamportToString(mark.start.id)];
    const end = mark.end ? lamportToString(mark.end.id) : null;

    while (current) {
        if (seen.has(current)) {
            throw new Error(`mark traversal cycle at ${current}`);
        }
        seen.add(current);
        if (mark.end?.at === 'before' && current === end) {
            break;
        }
        covered.push(current);
        if (mark.end?.at === 'after' && current === end) {
            break;
        }
        if (forcedNext[current]) {
            current = forcedNext[current];
            continue;
        }
        const split = mark.end
            ? context.splitRecords[current]?.find((split) => !crossed.has(lamportToString(split.id)))
            : undefined;
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

const createMarkTraversalContext = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
): MarkTraversalContext => {
    const outline = visibleBlockOutline(state, config);
    const blockCharIds = new Map<string, string[]>();
    const blockVisibleCharIds = new Map<string, string[]>();
    const allIds: string[] = [];

    for (const {id} of outline) {
        const ids = orderedCharIdsForBlock(state, id);
        blockCharIds.set(id, ids);
        blockVisibleCharIds.set(
            id,
            ids.filter((charId) => {
                const char = charRecord(state, charId);
                return Boolean(char && !char.deleted);
            }),
        );
        allIds.push(...ids);
    }

    return {
        outline,
        blockCharIds,
        blockVisibleCharIds,
        allCharIds: allIds,
        nextById: nextIdMap(allIds),
        splitRecords: splitRecordsByLeft(state),
    };
};

const allCharIds = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    config: VirtualBlockParentConfig<M> = {},
): string[] => visibleBlockOutline(state, config).flatMap(({id}) => orderedCharIdsForBlock(state, id));

const charIdsForOpenEndedMark = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    mark: Mark,
    config: VirtualBlockParentConfig<M> = {},
): string[] => {
    const startId = lamportToString(mark.start.id);
    const block = visibleBlockOutline(state, config).find(({id}) =>
        orderedCharIdsForBlock(state, id).includes(startId),
    );
    return block ? orderedCharIdsForBlock(state, block.id) : allCharIds(state, config);
};

const charIdsForOpenEndedMarkWithContext = (
    mark: Mark,
    context: MarkTraversalContext,
): string[] => {
    const startId = lamportToString(mark.start.id);
    for (const {id} of context.outline) {
        const ids = context.blockCharIds.get(id) ?? [];
        if (ids.includes(startId)) return ids;
    }
    return context.allCharIds;
};

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
