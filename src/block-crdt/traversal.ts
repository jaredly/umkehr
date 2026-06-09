import {lamportToString} from './ids';
import {compareLseqIds} from './lseq';
import {Cache, CachedState, Char, Lamport, TimestampedBlockMeta} from './types';

export const blockContents = <M extends TimestampedBlockMeta>(state: CachedState<M>, id: string): string =>
    state.cache.charContents[id]?.map((id) => charToString(state, id)).join('') ?? '';

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
