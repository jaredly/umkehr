import {lamportToString} from './ids.js';
import {
    CachedState,
    DefaultBlockMeta,
    HLC,
    Lamport,
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
                reject(op, 'char delete undo requires a resurrection operation, which does not exist');
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
                reject(op, 'block delete undo requires a resurrection operation, which does not exist');
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
                    reject(op, 'remove mark undo requires previous winning mark data');
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
                reject(op, 'split record undo requires higher-level split inverse planning');
                break;
            case 'join-record':
                reject(op, 'join record undo requires an unjoin operation, which does not exist');
                break;
        }
    }

    return {complete: unsupported.length === 0, ops, unsupported};
};
