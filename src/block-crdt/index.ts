import equal from 'fast-deep-equal';
import {
    State,
    Lamport,
    CachedState,
    Cache,
    Char,
    HLC,
    Block,
    Mark,
    SplitRecord,
    JsonValue,
} from './types';
import {lamportToString, parseLamportString} from './utils';
import {compareLseqIds, createLseqIdBetween, LseqOptions} from './lseq';

export type Op =
    | {type: 'char'; char: Char}
    | {type: 'block'; block: Block}
    | {type: 'char:move'; id: Lamport; parent: Char['parent']}
    | {type: 'char:delete'; id: Lamport}
    | {type: 'block:move'; id: Lamport; order: Block['order']}
    | {type: 'block:status'; id: Lamport; status: Block['status']}
    | {type: 'block:meta'; id: Lamport; meta: Block['meta']}
    | {type: 'mark'; mark: Mark}
    | {type: 'split-record'; split: SplitRecord};

export const charOp = (text: string, id: Lamport, after: Lamport, ts: string): Op => ({
    type: 'char',
    char: {text, id, deleted: false, parent: {id: after, ts: ''}},
});

export const apply = (state: CachedState, op: Op): CachedState | false => {
    switch (op.type) {
        case 'char':
            return applyChar(state, op);
        case 'block':
            return applyBlock(state, op);
        case 'block:status':
            return applyBlockStatus(state, op);
        case 'char:move':
            return applyCharMove(state, op);
        case 'char:delete':
            return applyCharDelete(state, op);
        case 'block:move':
            return applyBlockMove(state, op);
        case 'block:meta':
            return applyBlockMeta(state, op);
        case 'mark':
            return applyMark(state, op);
        case 'split-record':
            return applySplitRecord(state, op);
    }
};

const applyMark = ({state, cache}: CachedState, op: Op & {type: 'mark'}): CachedState | false => {
    const id = lamportToString(op.mark.id);
    const current = state.marks[id];
    if (current) {
        if (!equal(current, op.mark)) {
            throw new Error(`re-insert of mark ${id} and the payload is different`);
        }
        return {state, cache};
    }
    return {
        state: {
            ...state,
            marks: {...state.marks, [id]: op.mark},
            maxSeenCount: Math.max(
                state.maxSeenCount,
                op.mark.id[0],
                op.mark.start.id[0],
                op.mark.end.id[0],
                ...op.mark.crossedSplits.map((id) => id[0]),
            ),
        },
        cache,
    };
};

const applySplitRecord = (
    {state, cache}: CachedState,
    op: Op & {type: 'split-record'},
): CachedState | false => {
    const id = lamportToString(op.split.id);
    const current = state.splits[id];
    if (current) {
        if (!equal(current, op.split)) {
            throw new Error(`re-insert of split ${id} and the payload is different`);
        }
        return {state, cache};
    }
    return {
        state: {
            ...state,
            splits: {...state.splits, [id]: op.split},
            maxSeenCount: Math.max(
                state.maxSeenCount,
                op.split.id[0],
                op.split.left[0],
                op.split.right[0],
            ),
        },
        cache,
    };
};

const applyCharDelete = (
    {state, cache}: CachedState,
    op: Op & {type: 'char:delete'},
): CachedState | false => {
    const {chars, blocks, marks, splits, maxSeenCount} = state;
    const charId = lamportToString(op.id);
    let current = state.chars[charId];
    if (!current) {
        return false;
    }
    if (current.deleted) {
        return {state, cache};
    }
    current = {...current, deleted: true};
    return {
        state: {
            blocks,
            chars: {...chars, [charId]: current},
            marks,
            splits,
            maxSeenCount: Math.max(maxSeenCount, op.id[0]),
        },
        cache,
    };
};

const applyCharMove = (
    {state, cache}: CachedState,
    op: Op & {type: 'char:move'},
): CachedState | false => {
    const {chars, blocks, marks, splits, maxSeenCount} = state;
    const charId = lamportToString(op.id);
    let current = state.chars[charId];
    if (!current) {
        return false;
    }
    if (!laterTs(op.parent.ts, current.parent.ts)) {
        return {state, cache}; // ignore
    }
    const charContents = {...cache.charContents};
    const ppid = lamportToString(current.parent.id);
    removeFromCache(charContents, ppid, charId);
    current = {...current, parent: op.parent};
    const pid = lamportToString(op.parent.id);
    charContents[pid] = insertSortedRev((charContents[pid] ?? []).slice(), charId);
    return {
        state: {
            blocks,
            chars: {...chars, [charId]: current},
            marks,
            splits,
            maxSeenCount: Math.max(maxSeenCount, op.parent.id[0]),
        },
        cache: {
            ...cache,
            charContents,
        },
    };
};

const applyBlockStatus = (
    state: CachedState,
    op: Op & {type: 'block:status'},
): CachedState | false => {
    const id = lamportToString(op.id);
    let current = state.state.blocks[id];
    if (!current) {
        return false;
    }
    current = {...current};
    if (op.status.ts > current.status.ts) {
        current.status = op.status;
    }
    return {
        state: {
            ...state.state,
            blocks: {...state.state.blocks, [id]: current},
        },
        cache: state.cache,
    };
};

const applyBlockMove = (
    {state, cache}: CachedState,
    op: Op & {type: 'block:move'},
): CachedState | false => {
    const id = lamportToString(op.id);
    let current = state.blocks[id];
    if (!current) {
        return false;
    }
    if (!laterTs(op.order.ts, current.order.ts)) {
        return {state, cache};
    }

    const blockChildren = {...cache.blockChildren};
    const oldParentId = lamportToString(current.order.parent);
    removeFromCache(blockChildren, oldParentId, id);

    const newParentId = lamportToString(op.order.parent);
    const blocks = {...state.blocks, [id]: {...current, order: op.order}};
    blockChildren[newParentId] = insertSortedBy(
        (blockChildren[newParentId] ?? []).slice(),
        id,
        (id) => blocks[id].order.index,
        compareLseqIds,
    );

    current = {...current, order: op.order};
    return {
        state: {
            ...state,
            blocks: {...state.blocks, [id]: current},
            maxSeenCount: Math.max(state.maxSeenCount, op.id[0], op.order.parent[0]),
        },
        cache: {...cache, blockChildren},
    };
};

const applyBlockMeta = (
    {state, cache}: CachedState,
    op: Op & {type: 'block:meta'},
): CachedState | false => {
    const id = lamportToString(op.id);
    const current = state.blocks[id];
    if (!current) {
        return false;
    }
    if (!laterTs(op.meta.ts, current.meta.ts)) {
        return {state, cache};
    }
    return {
        state: {
            ...state,
            blocks: {...state.blocks, [id]: {...current, meta: op.meta}},
            maxSeenCount: Math.max(state.maxSeenCount, op.id[0]),
        },
        cache,
    };
};

const applyBlock = ({state, cache}: CachedState, {block}: Op & {type: 'block'}) => {
    const id = lamportToString(block.id);
    const current = state.blocks[id];
    if (current) {
        if (current.meta.ts > block.meta.ts) {
            block = {...block, meta: current.meta};
        }
        if (current.order.ts > block.order.ts) {
            block = {...block, order: current.order};
        }
        if (current.status.ts > block.status.ts) {
            block = {...block, status: current.status};
        }
    }

    const blocks = {...state.blocks, [id]: block};
    const parentId = lamportToString(block.order.parent);
    const blockChildren = {...cache.blockChildren};
    if (current) {
        const currentParentId = lamportToString(current.order.parent);
        removeFromCache(blockChildren, currentParentId, id);
    }
    blockChildren[parentId] = insertSortedBy(
        (blockChildren[parentId] ?? []).slice(),
        id,
        (id) => blocks[id].order.index,
        compareLseqIds,
    );
    return {
        state: {
            ...state,
            blocks,
            maxSeenCount: Math.max(state.maxSeenCount, block.id[0], block.order.parent[0]),
        },
        cache: {
            ...cache,
            blockChildren,
        },
    };
};

const laterTs = (one: Char['parent']['ts'], two: Char['parent']['ts']) => {
    if (typeof one === 'string') {
        if (typeof two === 'string') {
            return one > two;
        }
        return one === two[0] ? false : one > two[0];
    }
    if (typeof two === 'string') {
        return one[0] === two ? true : one[0] > two;
    }
    if (one[0] !== two[0]) return one[0] > two[0];
    for (let i = 0; i < one[1].length && i < two[1].length; i++) {
        if (one[1][i] !== two[1][i]) {
            return one[1][i] > two[1][i];
        }
    }
    return one[2] > two[2];
};

const applyChar = ({state, cache}: CachedState, {char}: Op & {type: 'char'}) => {
    const {chars, blocks, marks, splits, maxSeenCount} = state;
    const charId = lamportToString(char.id);
    const current = state.chars[charId];
    if (current) {
        if (current.text !== char.text) {
            throw new Error(`re-insert of ${charId} and the text is different`);
        }
        if (laterTs(current.parent.ts, char.parent.ts)) {
            char = {...char, parent: current.parent};
        }
        char = {...char, deleted: current.deleted};
    }
    const parentId = lamportToString(char.parent.id);
    const charContents = {...cache.charContents};
    if (current) {
        const currentParentId = lamportToString(current.parent.id);
        removeFromCache(charContents, currentParentId, charId);
    }
    charContents[parentId] = insertSortedRev(charContents[parentId]?.slice() ?? [], charId);
    return {
        state: {
            blocks,
            chars: {...chars, [charId]: char},
            marks,
            splits,
            maxSeenCount: Math.max(
                maxSeenCount,
                char.id[0],
                char.parent.id[0],
                ...(Array.isArray(char.parent.ts) ? char.parent.ts[1].map((id) => id[0]) : []),
            ),
        },
        cache: {
            ...cache,
            charContents,
        },
    };
};

const insertSortedBy = <T>(
    array: string[],
    item: string,
    order: (id: string) => T,
    compare: (a: T, b: T) => number,
) => {
    const self = order(item);
    for (let i = 0; i < array.length; i++) {
        if (compare(self, order(array[i])) < 0) {
            array.splice(i, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
};

const removeFromCache = (cache: Record<string, string[]>, parentId: string, id: string) => {
    const next = (cache[parentId] ?? []).filter((item) => item !== id);
    if (next.length) {
        cache[parentId] = next;
    } else {
        delete cache[parentId];
    }
};

const insertSortedRev = (array: string[], item: string) => {
    for (let i = 0; i < array.length; i++) {
        if (item > array[i]) {
            array.splice(i, 0, item);
            return array;
        }
    }
    array.push(item);
    return array;
};

export const applyMany = (state: CachedState, ops: Op[]) => {
    ops.forEach((op) => {
        const result = apply(state, op);
        if (result === false) {
            throw new Error(`op was pending`);
        }
        state = result;
    });
    return state;
};

export const addChars = (
    state: CachedState,
    text: string,
    after: Lamport,
    ts: () => HLC,
    actor = 'self',
): CachedState => {
    let i = state.state.maxSeenCount + 1;
    const ops: Op[] = [];
    for (let char of new Intl.Segmenter().segment(text)) {
        const id: Lamport = [i, actor];
        ops.push(charOp(char.segment, id, after, ts()));
        after = id;
        i++;
    }
    return applyMany(state, ops);
};

export const cachedState = (state: State): CachedState => ({
    state,
    cache: organizeState(state.blocks, state.chars),
});

// root blocks are those whose parent = 'root'

// Blocks ... are created with a single char. but if there happen to be multiple, idk we can handle it.

export const blockContents = (state: CachedState, id: string): string =>
    state.cache.charContents[id]?.map((id) => charToString(state, id)).join('') ?? '';

export const charToString = (state: CachedState, id: string): string => {
    const char = state.state.chars[id];
    return (
        (char.deleted ? '' : char.text) +
        (state.cache.charContents[id]?.map((id) => charToString(state, id)).join('') ?? '')
    );
};

export const stateToString = (state: CachedState) => {
    const {blocks} = state.state;
    const {blockChildren, charContents} = state.cache;
    const showBlock = (id: string): string[] => {
        const block = blocks[id];
        if (block.status.archived) {
            return [];
        }
        const symbol = {paragraph: ' ', bullets: '•', checkboxes: '☐', blockquote: '|'}[
            block.meta.type
        ];
        return [
            id + ': ' + (charContents[id]?.map((id) => charToString(state, id)).join('') ?? ''),
            ...(blockChildren[id]?.flatMap(showBlock).map((line) => symbol + ' ' + line) ?? []),
        ];
    };
    return blockChildren['0000-root']?.flatMap(showBlock).join('\n');
};

export function organizeState(blocks: Record<string, Block>, chars: Record<string, Char>): Cache {
    const blockChildren: Record<string, string[]> = {};
    for (const [id, block] of Object.entries(blocks)) {
        const pid = lamportToString(block.order.parent);
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
        items.sort((a, b) => b.localeCompare(a));
    });
    return {blockChildren, charContents};
}

export const findTail = (char: string, contents: Cache['charContents']) => {
    while (contents[char]?.length) {
        char = contents[char][contents[char].length - 1];
    }
    return char;
};

export const compareLamports = (one: Lamport, two: Lamport) =>
    one[0] === two[0] ? one[1].localeCompare(two[1]) : one[0] - two[0];

export const orderedCharIdsForBlock = (
    state: CachedState,
    blockId: string,
    options: {visibleOnly?: boolean} = {},
): string[] => {
    const result: string[] = [];
    const visit = (id: string) => {
        const char = state.state.chars[id];
        if (!options.visibleOnly || !char.deleted) {
            result.push(id);
        }
        for (const child of state.cache.charContents[id] ?? []) {
            visit(child);
        }
    };
    for (const id of state.cache.charContents[blockId] ?? []) {
        visit(id);
    }
    return result;
};

export const rootBlockIds = (state: CachedState, includeArchived = false): string[] =>
    (state.cache.blockChildren[lamportToString([0, 'root'])] ?? []).filter(
        (id) => includeArchived || !state.state.blocks[id]?.status.archived,
    );

export const hasJoinStyleParent = (state: CachedState, charId: string): boolean => {
    const char = state.state.chars[charId];
    const parentId = lamportToString(char.parent.id);
    return (
        parentId in state.state.chars &&
        typeof char.parent.ts === 'string' &&
        char.parent.ts !== ''
    );
};

export const splitRecordsByLeft = (state: CachedState): Record<string, SplitRecord[]> => {
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

export type FormattedRun = {
    text: string;
    marks: Record<string, JsonValue | true>;
};

export type FormattedBlock = {
    id: string;
    block: Block;
    runs: FormattedRun[];
};

export const markOp = (
    id: Lamport,
    start: Lamport,
    end: Lamport,
    type: string,
    data?: JsonValue,
    remove = false,
    crossedSplits: Lamport[] = [],
): Op => ({
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

export const markRange = (
    state: CachedState,
    block: Lamport,
    startOffset: number,
    endOffset: number,
    type: string,
    data: JsonValue | undefined,
    remove: boolean,
    id: Lamport,
): Op => {
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

export const materializeFormattedBlocks = (state: CachedState): FormattedBlock[] => {
    const coveredByMark: Record<string, Mark[]> = {};
    const marks = Object.values(state.state.marks).sort((a, b) => compareLamports(a.id, b.id));
    for (const mark of marks) {
        for (const charId of coveredCharIdsForMark(state, mark)) {
            coveredByMark[charId] = coveredByMark[charId] ?? [];
            coveredByMark[charId].push(mark);
        }
    }

    return rootBlockIds(state).map((id) => {
        const runs: FormattedRun[] = [];
        for (const charId of orderedCharIdsForBlock(state, id, {visibleOnly: true})) {
            const char = state.state.chars[charId];
            const marks = resolveMarks(coveredByMark[charId] ?? []);
            const last = runs[runs.length - 1];
            if (last && equal(last.marks, marks)) {
                last.text += char.text;
            } else {
                runs.push({text: char.text, marks});
            }
        }
        return {id, block: state.state.blocks[id], runs};
    });
};

const charAtVisibleOffset = (state: CachedState, block: Lamport, offset: number): Lamport | null => {
    const id = orderedCharIdsForBlock(state, lamportToString(block), {visibleOnly: true})[offset];
    return id ? state.state.chars[id].id : null;
};

const crossedSplitsBetween = (state: CachedState, start: Lamport, end: Lamport): Lamport[] => {
    const splitRecords = splitRecordsByLeft(state);
    const sequence = allCharIds(state);
    const nextById = nextIdMap(sequence);
    const crossed: Lamport[] = [];
    let current: string | undefined = lamportToString(start);
    const endId = lamportToString(end);
    let stop = sequence.length + Object.keys(state.state.splits).length + 1;
    while (current && stop-- > 0) {
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

const coveredCharIdsForMark = (state: CachedState, mark: Mark): string[] => {
    const sequence = allCharIds(state);
    const nextById = nextIdMap(sequence);
    const splitRecords = splitRecordsByLeft(state);
    const crossed = new Set(mark.crossedSplits.map(lamportToString));
    const covered: string[] = [];
    const forcedNext: Record<string, string> = {};
    let current =
        mark.start.at === 'before'
            ? lamportToString(mark.start.id)
            : nextById[lamportToString(mark.start.id)];
    const end = lamportToString(mark.end.id);
    let stop = sequence.length + Object.keys(state.state.splits).length * 20 + 20;

    while (current && stop-- > 0) {
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
    if (stop <= 0) {
        throw new Error(`mark traversal exceeded safety limit`);
    }
    return covered;
};

const allCharIds = (state: CachedState): string[] =>
    rootBlockIds(state, true).flatMap((id) => orderedCharIdsForBlock(state, id));

const nextIdMap = (sequence: string[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (let i = 0; i < sequence.length - 1; i++) {
        result[sequence[i]] = sequence[i + 1];
    }
    return result;
};

const pathForFollowedSplit = (state: CachedState, split: SplitRecord): string[] => {
    const left = lamportToString(split.left);
    const right = lamportToString(split.right);
    const tail = tailAfterSplitLeft(state, left);
    if (tail[tail.length - 1] === right) {
        return [left, ...tail];
    }
    return [left, ...tail, right];
};

const tailAfterSplitLeft = (state: CachedState, left: string): string[] => {
    const result: string[] = [];
    const visit = (id: string): boolean => {
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

const resolveMarks = (marks: Mark[]): Record<string, JsonValue | true> => {
    const winning: Record<string, Mark> = {};
    for (const mark of marks) {
        const current = winning[mark.type];
        if (!current || compareLamports(current.id, mark.id) < 0) {
            winning[mark.type] = mark;
        }
    }
    const result: Record<string, JsonValue | true> = {};
    for (const mark of Object.values(winning)) {
        if (!mark.remove) {
            result[mark.type] = mark.data ?? true;
        }
    }
    return result;
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
    const siblings = cache.blockChildren[lamportToString(current.order.parent)];
    const index = siblings.indexOf(bid);
    const previousId = siblings[index - 1];
    const nextId = siblings[index + 1];
    if (at.char === null) {
        return [
            {
                type: 'block',
                block: blockBetween(
                    [maxSeenCount + 1, actor],
                    current.meta,
                    current.order.parent,
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
        return [
            {
                type: 'block',
                block: blockBetween(
                    [maxSeenCount + 1, actor],
                    current.meta,
                    current.order.parent,
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
            ts,
            parent: current.order.parent,
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
        status: {archived: false, ts},
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
    let tail = chars[findTail(lamportToString(at.char), cache.charContents)].id;
    let cid = lamportToString(at.char);
    let stop = 1000;
    while (cid !== bid) {
        if (stop-- < 0) throw new Error(`Too deep`);
        ancestryPath.unshift(parseLamportString(cid));

        const pid = lamportToString(chars[cid].parent.id);
        const children = cache.charContents[pid];
        for (let at = children.indexOf(cid) + 1; at < children.length; at++) {
            const id = children[at];
            ops.push({
                type: 'char:move',
                id: chars[id].id,
                parent: {
                    ts: [lastMoveTs(chars[id].parent.ts), ancestryPath, ts],
                    id: tail,
                },
            });
            tail = chars[findTail(id, cache.charContents)].id;
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
    const {chars, blocks} = state;
    const leftId = lamportToString(left);
    const rightId = lamportToString(right);
    if (!blocks[leftId] || !blocks[rightId]) {
        throw new Error(`join block not found`);
    }

    const ops: Op[] = [];
    const rightRoots = cache.charContents[rightId] ?? [];
    const leftRoots = cache.charContents[leftId] ?? [];
    const firstRightRoot = rightRoots[0];
    let tail = leftRoots.length
        ? parseLamportString(findTail(leftRoots[leftRoots.length - 1], cache.charContents))
        : left;

    if (firstRightRoot) {
        ops.push({
            type: 'char:move',
            id: chars[firstRightRoot].id,
            parent: {
                id: tail,
                ts,
            },
        });
        tail = chars[findTail(firstRightRoot, cache.charContents)].id;

        for (let i = 1; i < rightRoots.length; i++) {
            const id = rightRoots[i];
            ops.push({
                type: 'char:move',
                id: chars[id].id,
                parent: {
                    id: tail,
                    ts: [lastMoveTs(chars[id].parent.ts), [chars[firstRightRoot].id], ts],
                },
            });
            tail = chars[findTail(id, cache.charContents)].id;
        }
    }

    ops.push({
        type: 'block:status',
        id: right,
        status: {archived: true, ts},
    });

    return ops;
};

const blockBetween = (
    id: Lamport,
    meta: Block['meta'],
    parent: Lamport,
    before: Block['order']['index'] | null,
    after: Block['order']['index'] | null,
    ts: string,
    actor: string,
    options?: LseqOptions,
): Block => ({
    id,
    meta,
    order: {
        ts,
        parent,
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
    status: {archived: false, ts},
});

const lastMoveTs = (ts: Char['parent']['ts']) => (typeof ts === 'string' ? ts : ts[2]);
