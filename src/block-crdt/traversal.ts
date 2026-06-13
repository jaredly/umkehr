import {lamportToString} from './ids.js';
import {compareLseqIds} from './lseq.js';
import {Cache, CachedState, Char, Lamport, TimestampedBlockMeta} from './types.js';

export type VisibleBlockPath = number[];

export type BlockPoint = {
    blockId: string;
    offset: number;
};

export type RetainedPoint = {
    blockId: string;
    affinity: 'before' | 'after';
    charId: string | null;
};

export type RetainedSelection =
    | {type: 'caret'; point: RetainedPoint}
    | {type: 'range'; anchor: RetainedPoint; focus: RetainedPoint};

export const blockContents = <M extends TimestampedBlockMeta>(state: CachedState<M>, id: string): string =>
    state.cache.charContents[id]?.map((id) => charToString(state, id)).join('') ?? '';

export const segmentGraphemes = (text: string): string[] =>
    [...new Intl.Segmenter().segment(text)].map((segment) => segment.segment);

export const graphemeLength = (text: string): number => segmentGraphemes(text).length;

export const utf16OffsetToGraphemeOffset = (text: string, utf16Offset: number): number => {
    const clamped = Math.max(0, Math.min(utf16Offset, text.length));
    let graphemes = 0;
    let utf16 = 0;
    for (const segment of segmentGraphemes(text)) {
        if (utf16 + segment.length > clamped) {
            return graphemes;
        }
        utf16 += segment.length;
        graphemes++;
    }
    return graphemes;
};

export const graphemeOffsetToUtf16Offset = (text: string, graphemeOffset: number): number => {
    const clamped = Math.max(0, Math.min(graphemeOffset, graphemeLength(text)));
    return segmentGraphemes(text)
        .slice(0, clamped)
        .reduce((offset, segment) => offset + segment.length, 0);
};

export const visibleTextForBlock = <M extends TimestampedBlockMeta>(state: CachedState<M>, blockId: string): string =>
    blockContents(state, blockId);

export const visibleGraphemeIdsForBlock = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
): string[] => orderedCharIdsForBlock(state, blockId, {visibleOnly: true});

export const visibleLengthForBlock = <M extends TimestampedBlockMeta>(state: CachedState<M>, blockId: string): number =>
    visibleGraphemeIdsForBlock(state, blockId).length;

export const charToString = <M extends TimestampedBlockMeta>(state: CachedState<M>, id: string): string => {
    const char = charRecord(state, id);
    if (!char) return '';
    return (
        (char.deleted ? '' : char.text) +
        (state.cache.charContents[id]?.map((id) => charToString(state, id)).join('') ?? '')
    );
};

export const stateToString = <M extends TimestampedBlockMeta>(state: CachedState<M>) => {
    const {blocks} = state.state;
    const {blockChildren, charContents} = state.cache;
    const showBlock = (id: string): string[] => {
        const block = blocks[id];
        if (block.deleted) {
            return [];
        }
        const symbol = {paragraph: ' ', bullets: '•', checkboxes: '☐', blockquote: '|'}[
            (block.meta as {type?: 'paragraph' | 'bullets' | 'checkboxes' | 'blockquote'}).type ?? 'paragraph'
        ];
        return [
            id + ': ' + (charContents[id]?.map((id) => charToString(state, id)).join('') ?? ''),
            ...(blockChildren[id]?.flatMap(showBlock).map((line) => symbol + ' ' + line) ?? []),
        ];
    };
    return visibleBlockChildren(state, '0000-root').flatMap(showBlock).join('\n');
};

export const findTail = (char: string, contents: Cache['charContents']) => {
    const seen = new Set<string>();
    while (contents[char]?.length) {
        if (seen.has(char)) {
            throw new Error(`char traversal cycle at ${char}`);
        }
        seen.add(char);
        char = contents[char][contents[char].length - 1];
    }
    return char;
};

export const charRecord = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    id: string,
): Pick<Char, 'id' | 'text' | 'deleted' | 'parent'> | undefined => {
    const char = state.state.chars[id];
    if (char) return char;
    const join = state.cache.joinSentinels[id];
    if (!join) return undefined;
    return {
        id: join.right,
        text: '',
        deleted: true,
        parent: {id: join.tail, ts: join.ts},
    };
};

const visibleBlock = <M extends TimestampedBlockMeta>(state: CachedState<M>, id: string): boolean => {
    const block = state.state.blocks[id];
    return Boolean(block && !block.deleted && !state.cache.joinedBlocks[id]);
};

export const visibleBlockChildren = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    parent: string,
): string[] => {
    return logicalVisibleBlockChildren(state, parent, new Set());
};

export type VisibleBlockOutlineEntry = {
    id: string;
    depth: number;
    parentId: string;
};

export const visibleBlockOutline = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
): VisibleBlockOutlineEntry[] => {
    const result: VisibleBlockOutlineEntry[] = [];
    const rootId = lamportToString([0, 'root']);

    const visitChildren = (pid: string, depth: number, visibleParentId: string, seen: Set<string>) => {
        for (const child of logicalVisibleBlockChildren(state, pid, seen)) {
            result.push({id: child, depth, parentId: visibleParentId});
            visitChildren(child, depth + 1, child, new Set(seen));
        }
    };

    visitChildren(rootId, 0, rootId, new Set());
    return result;
};

export const visibleBlockEntryAtPath = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    path: VisibleBlockPath,
): VisibleBlockOutlineEntry | null => {
    validateVisiblePath(path);
    let parentId = lamportToString([0, 'root']);
    let entry: VisibleBlockOutlineEntry | null = null;
    for (let depth = 0; depth < path.length; depth++) {
        const children = visibleBlockChildren(state, parentId);
        const childId = children[path[depth]];
        if (!childId) return null;
        entry = {id: childId, depth, parentId};
        parentId = childId;
    }
    return entry;
};

export const blockIdAtVisiblePath = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    path: VisibleBlockPath,
): string | null => visibleBlockEntryAtPath(state, path)?.id ?? null;

export const visiblePathForBlockId = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
): VisibleBlockPath | null => {
    const target = state.state.blocks[blockId];
    if (!target || target.deleted || state.cache.joinedBlocks[blockId]) {
        return null;
    }
    const visit = (parentId: string, path: number[]): VisibleBlockPath | null => {
        const children = visibleBlockChildren(state, parentId);
        for (let index = 0; index < children.length; index++) {
            const childId = children[index];
            const childPath = [...path, index];
            if (childId === blockId) return childPath;
            const nested = visit(childId, childPath);
            if (nested) return nested;
        }
        return null;
    };
    return visit(lamportToString([0, 'root']), []);
};

export const visibleSiblingAnchorsForPath = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    path: VisibleBlockPath,
): {parent: Lamport; before: Lamport | null; after: Lamport | null} | null => {
    validateVisiblePath(path);
    if (path.length === 0) return null;
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1];
    const parentId = parentPath.length ? blockIdAtVisiblePath(state, parentPath) : lamportToString([0, 'root']);
    if (!parentId) return null;
    const children = visibleBlockChildren(state, parentId);
    if (index > children.length) return null;
    const beforeId = index > 0 ? children[index - 1] : null;
    const afterId = index < children.length ? children[index] : null;
    return {
        parent: parentId === lamportToString([0, 'root']) ? [0, 'root'] : state.state.blocks[parentId].id,
        before: beforeId ? state.state.blocks[beforeId].id : null,
        after: afterId ? state.state.blocks[afterId].id : null,
    };
};

const logicalVisibleBlockChildren = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    parent: string,
    seen: Set<string>,
): string[] => {
    if (seen.has(parent)) {
        throw new Error(`block traversal cycle at ${parent}`);
    }
    seen.add(parent);
    const result: string[] = [];
    for (const child of state.cache.blockChildren[parent] ?? []) {
        if (visibleBlock(state, child)) {
            result.push(child);
        } else {
            result.push(...logicalVisibleBlockChildren(state, child, new Set(seen)));
        }
    }
    return result.sort((a, b) => compareLseqIds(state.state.blocks[a].order.index, state.state.blocks[b].order.index));
};

export const orderedCharIdsForBlock = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    blockId: string,
    options: {visibleOnly?: boolean} = {},
): string[] => {
    const result: string[] = [];
    const visit = (id: string) => {
        const char = charRecord(state, id);
        if (!char) return;
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

export const clampBlockPoint = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    point: BlockPoint,
): BlockPoint => {
    const visibleIds = visibleBlockOutline(state).map((entry) => entry.id);
    let blockId = visibleIds.includes(point.blockId) ? point.blockId : null;
    if (!blockId && state.state.blocks[point.blockId]) {
        blockId = visibleBlockChildren(state, point.blockId)[0] ?? null;
    }
    blockId = blockId ?? visibleIds[0] ?? point.blockId;
    return {
        blockId,
        offset: Math.max(0, Math.min(point.offset, visibleLengthForBlock(state, blockId))),
    };
};

export const retainPoint = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    point: BlockPoint,
    options: {affinity?: 'before' | 'after'} = {},
): RetainedPoint => {
    const clamped = clampBlockPoint(state, point);
    const affinity = options.affinity ?? 'after';
    const chars = visibleGraphemeIdsForBlock(state, clamped.blockId);
    if (affinity === 'before' && clamped.offset < chars.length) {
        return {blockId: clamped.blockId, affinity, charId: chars[clamped.offset]};
    }
    if (clamped.offset <= 0) {
        return {blockId: clamped.blockId, affinity: 'after', charId: null};
    }
    return {blockId: clamped.blockId, affinity: 'after', charId: chars[clamped.offset - 1] ?? null};
};

export const resolvePoint = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    point: RetainedPoint,
): BlockPoint => {
    if (point.charId) {
        const visibleResolved = resolveCharPointInBlocks(state, point, visibleBlockOutline(state).map((entry) => entry.id));
        if (visibleResolved) return visibleResolved;
        const hiddenResolved = resolveCharPointInBlocks(state, point, Object.keys(state.state.blocks).sort());
        if (hiddenResolved) return clampBlockPoint(state, hiddenResolved);
    }
    return clampBlockPoint(state, {blockId: point.blockId, offset: 0});
};

export const retainSelection = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    selection:
        | {type: 'caret'; point: BlockPoint}
        | {type: 'range'; anchor: BlockPoint; focus: BlockPoint},
): RetainedSelection => {
    if (selection.type === 'caret') {
        return {type: 'caret', point: retainPoint(state, selection.point)};
    }
    return {
        type: 'range',
        anchor: retainPoint(state, selection.anchor),
        focus: retainPoint(state, selection.focus),
    };
};

export const resolveSelection = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    selection: RetainedSelection,
):
    | {type: 'caret'; point: BlockPoint}
    | {type: 'range'; anchor: BlockPoint; focus: BlockPoint} => {
    if (selection.type === 'caret') {
        return {type: 'caret', point: resolvePoint(state, selection.point)};
    }
    const anchor = resolvePoint(state, selection.anchor);
    const focus = resolvePoint(state, selection.focus);
    if (anchor.blockId === focus.blockId && anchor.offset === focus.offset) {
        return {type: 'caret', point: focus};
    }
    return {type: 'range', anchor, focus};
};

export const charAtVisibleOffset = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    block: Lamport,
    offset: number,
): Lamport | null => {
    const id = orderedCharIdsForBlock(state, lamportToString(block), {visibleOnly: true})[offset];
    return id ? state.state.chars[id].id : null;
};

export const rootBlockIds = <M extends TimestampedBlockMeta>(state: CachedState<M>, includeDeleted = false): string[] =>
    includeDeleted
        ? state.cache.blockChildren[lamportToString([0, 'root'])] ?? []
        : visibleBlockChildren(state, lamportToString([0, 'root']));

export const hasJoinStyleParent = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    charId: string,
): boolean => {
    if (state.cache.joinSentinels[charId]) {
        return true;
    }
    const char = state.state.chars[charId];
    if (!char) return false;
    const parentId = lamportToString(char.parent.id);
    return (
        (parentId in state.state.chars || parentId in state.cache.joinSentinels) &&
        typeof char.parent.ts === 'string' &&
        char.parent.ts !== ''
    );
};

const resolveCharPointInBlocks = <M extends TimestampedBlockMeta>(
    state: CachedState<M>,
    point: RetainedPoint,
    blockIds: string[],
): BlockPoint | null => {
    for (const blockId of blockIds) {
        const logicalCharIds = orderedCharIdsForBlock(state, blockId);
        let visibleOffset = 0;
        for (const charId of logicalCharIds) {
            if (charId === point.charId) {
                return {
                    blockId,
                    offset: point.affinity === 'before' ? visibleOffset : visibleOffset + visibleCount(state, charId),
                };
            }
            const char = charRecord(state, charId);
            if (char && !char.deleted) visibleOffset++;
        }
    }
    return null;
};

const visibleCount = <M extends TimestampedBlockMeta>(state: CachedState<M>, charId: string) => {
    const char = charRecord(state, charId);
    return char && !char.deleted ? 1 : 0;
};

const validateVisiblePath = (path: VisibleBlockPath) => {
    for (const index of path) {
        if (!Number.isInteger(index) || index < 0) {
            throw new Error(`visible path indexes must be non-negative integers`);
        }
    }
};
