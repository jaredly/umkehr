import {compareLamports, lamportToString} from './ids.js';
import {findTail, orderedCharIdsForBlock, charRecord} from './traversal.js';
import {
    Block,
    CachedState,
    Char,
    DefaultBlockMeta,
    HLC,
    Lamport,
    Mark,
    Op,
    TimestampedBlockMeta,
} from './types.js';

export type UndoUnsupported<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    op: Op<M>;
    reason: string;
};

export type UndoPlan<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    complete: boolean;
    ops: Op<M>[];
    unsupported: UndoUnsupported<M>[];
};

export const planUndoOps = <M extends TimestampedBlockMeta = DefaultBlockMeta>(
    before: CachedState<M>,
    current: CachedState<M>,
    batch: Op<M>[],
    {actor, ts}: {actor: string; ts: () => HLC},
): UndoPlan<M> => {
    let nextCounter = current.state.maxSeenCount + 1;
    const nextId = (): Lamport => [nextCounter++, actor];
    const nextTs = () => ts();
    const ops: Op<M>[] = [];
    const unsupported: UndoUnsupported<M>[] = [];
    const replacements = new Map<string, Lamport>();

    const reject = (op: Op<M>, reason: string) => {
        unsupported.push({op, reason});
    };

    for (const op of batch.slice().reverse()) {
        switch (op.type) {
            case 'char': {
                const id = lamportToString(op.char.id);
                const currentChar = current.state.chars[id];
                if (currentChar && !currentChar.deleted) {
                    ops.push({type: 'char:delete', id: op.char.id});
                    break;
                }
                const replacement = replacementCharForInsertedChar(before, current, op.char);
                if (replacement) {
                    ops.push({type: 'char:delete', id: replacement.id});
                }
                break;
            }
            case 'char:move': {
                const beforeChar = before.state.chars[lamportToString(op.id)];
                if (!beforeChar) {
                    reject(op, 'char move undo requires the previous char parent');
                    break;
                }
                ops.push({
                    type: 'char:move',
                    id: op.id,
                    parent: {id: beforeChar.parent.id, ts: nextTs()},
                });
                break;
            }
            case 'char:delete':
                restoreDeletedChar(before, op.id, nextId, replacements, ops) ||
                    reject(op, 'char delete undo requires the deleted char in the previous state');
                break;
            case 'block': {
                const id = lamportToString(op.block.id);
                if (before.state.blocks[id]) {
                    reject(op, 'block upsert undo requires previous block merge semantics');
                    break;
                }
                const currentBlock = current.state.blocks[id];
                if (currentBlock && !currentBlock.deleted) {
                    ops.push({type: 'block:delete', id: op.block.id});
                }
                break;
            }
            case 'block:move': {
                const beforeBlock = before.state.blocks[lamportToString(op.id)];
                if (!beforeBlock) {
                    reject(op, 'block move undo requires the previous block order');
                    break;
                }
                ops.push({
                    type: 'block:move',
                    id: op.id,
                    order: {...beforeBlock.order, id: nextId(), ts: nextTs()},
                });
                break;
            }
            case 'block:delete':
                restoreDeletedBlock(before, op.id, nextId, ops) ||
                    reject(op, 'block delete undo requires the deleted block in the previous state');
                break;
            case 'block:meta': {
                const beforeBlock = before.state.blocks[lamportToString(op.id)];
                if (!beforeBlock) {
                    reject(op, 'block metadata undo requires the previous block metadata');
                    break;
                }
                ops.push({
                    type: 'block:meta',
                    id: op.id,
                    meta: {...beforeBlock.meta, ts: nextTs()} as M,
                });
                break;
            }
            case 'mark':
                if (op.mark.remove) {
                    const previous = previousWinningMark(before, op.mark);
                    if (!previous) {
                        reject(op, 'remove mark undo requires previous winning mark data');
                        break;
                    }
                    ops.push({
                        type: 'mark',
                        mark: {
                            ...op.mark,
                            id: nextId(),
                            remove: false,
                            data: previous.data,
                        },
                    });
                    break;
                }
                ops.push({
                    type: 'mark',
                    mark: {
                        ...op.mark,
                        id: nextId(),
                        remove: true,
                        data: undefined,
                    },
                });
                break;
            case 'split-record':
                // Split records are immutable traversal facts. The surrounding block and char:move inverses
                // produce the visible split undo; the record itself does not need a compensating op.
                break;
            case 'join-record':
                restoreJoinedBlock(before, op.join.right, nextId, nextTs, ops) ||
                    reject(op, 'join record undo requires the joined right block in the previous state');
                break;
        }
    }

    return {complete: unsupported.length === 0, ops, unsupported};
};

const replacementCharForInsertedChar = <M extends TimestampedBlockMeta>(
    before: CachedState<M>,
    current: CachedState<M>,
    inserted: Char,
): Char | null => {
    for (const candidate of Object.values(current.state.chars)) {
        const candidateId = lamportToString(candidate.id);
        if (candidate.deleted || candidateId === lamportToString(inserted.id)) continue;
        if (before.state.chars[candidateId]) continue;
        if (candidate.text !== inserted.text) continue;
        if (!sameLamport(candidate.parent.id, inserted.parent.id)) continue;
        return candidate;
    }
    return null;
};

const restoreDeletedChar = <M extends TimestampedBlockMeta>(
    before: CachedState<M>,
    id: Lamport,
    nextId: () => Lamport,
    replacements: Map<string, Lamport>,
    ops: Op<M>[],
) => {
    const beforeChar = before.state.chars[lamportToString(id)];
    if (!beforeChar) return false;
    const parentId = lamportToString(beforeChar.parent.id);
    const parent = replacements.get(parentId) ?? beforeChar.parent.id;
    const replacement = nextId();
    replacements.set(lamportToString(id), replacement);
    ops.push(charInsertOp(beforeChar.text, replacement, parent));
    return true;
};

const restoreDeletedBlock = <M extends TimestampedBlockMeta>(
    before: CachedState<M>,
    id: Lamport,
    nextId: () => Lamport,
    ops: Op<M>[],
) => {
    const beforeBlock = before.state.blocks[lamportToString(id)];
    if (!beforeBlock) return false;
    restoreBlockWithVisibleText(before, beforeBlock, nextId, ops);
    return true;
};

const restoreJoinedBlock = <M extends TimestampedBlockMeta>(
    before: CachedState<M>,
    id: Lamport,
    nextId: () => Lamport,
    nextTs: () => HLC,
    ops: Op<M>[],
) => {
    const beforeBlock = before.state.blocks[lamportToString(id)];
    if (!beforeBlock) return false;

    const blockId = nextId();
    const rootCharIds = before.cache.charContents[lamportToString(beforeBlock.id)] ?? [];
    ops.push(freshBlockOp(beforeBlock, blockId, nextTs()));

    let parent = blockId;
    for (const charId of rootCharIds) {
        const char = before.state.chars[charId];
        if (!char) continue;
        ops.push({
            type: 'char:move',
            id: char.id,
            parent: {id: parent, ts: nextTs()},
        });
        parent = before.state.chars[findTail(charId, before.cache.charContents)]?.id ?? char.id;
    }
    return true;
};

const restoreBlockWithVisibleText = <M extends TimestampedBlockMeta>(
    before: CachedState<M>,
    beforeBlock: Block<M>,
    nextId: () => Lamport,
    ops: Op<M>[],
) => {
    const id = nextId();
    ops.push(freshBlockOp(beforeBlock, id));

    let parent = id;
    for (const charId of orderedCharIdsForBlock(before, lamportToString(beforeBlock.id), {visibleOnly: true})) {
        const char = charRecord(before, charId);
        if (!char || char.deleted) continue;
        const replacement = nextId();
        ops.push(charInsertOp(char.text, replacement, parent));
        parent = replacement;
    }
};

const freshBlockOp = <M extends TimestampedBlockMeta>(
    beforeBlock: Block<M>,
    id: Lamport,
    ts: HLC | undefined = undefined,
): Op<M> => ({
    type: 'block',
    block: {
        ...beforeBlock,
        id,
        order: {
            ...beforeBlock.order,
            id,
            path: [...beforeBlock.order.path.slice(0, -1), id],
            ...(ts ? {ts} : {}),
        },
        deleted: false,
    },
});

const charInsertOp = <M extends TimestampedBlockMeta>(
    text: string,
    id: Lamport,
    parent: Lamport,
): Op<M> => ({
    type: 'char',
    char: {
        id,
        text,
        deleted: false,
        parent: {id: parent, ts: ''},
    },
});

const previousWinningMark = <M extends TimestampedBlockMeta>(
    before: CachedState<M>,
    mark: Mark,
): Mark | null => {
    let winner: Mark | null = null;
    for (const candidate of Object.values(before.state.marks)) {
        if (candidate.type !== mark.type || candidate.remove) continue;
        if (!sameBoundary(candidate.start, mark.start) || !sameBoundary(candidate.end, mark.end)) continue;
        if (!winner || compareLamports(winner.id, candidate.id) < 0) {
            winner = candidate;
        }
    }
    return winner;
};

const sameBoundary = (one: Mark['start'], two: Mark['start']) =>
    one.at === two.at && lamportToString(one.id) === lamportToString(two.id);

const sameLamport = (one: Lamport, two: Lamport) => one[0] === two[0] && one[1] === two[1];
