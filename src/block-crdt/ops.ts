import {compareLamports, validateLamport} from './ids';
import {Char, Lamport, Op} from './types';

export type ValidationResult =
    | {valid: true}
    | {valid: false; errors: string[]};

export const validateOp = (op: Op): ValidationResult => {
    const errors: string[] = [];
    for (const lamport of lamportsForOp(op)) {
        try {
            validateLamport(lamport);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    if (op.type === 'block' || op.type === 'block:move') {
        const order = op.type === 'block' ? op.block.order : op.order;
        if (!order.path.length) {
            errors.push(`block order path must not be empty`);
        }
        if (
            order.path.length &&
            compareLamports(
                order.path[order.path.length - 1],
                op.type === 'block' ? op.block.id : op.id,
            ) !== 0
        ) {
            errors.push(`block order path must end with the block id`);
        }
    }
    return errors.length ? {valid: false, errors} : {valid: true};
};

export const maxLamportCounterForOp = (op: Op): number => {
    switch (op.type) {
        case 'char':
            return Math.max(
                op.char.id[0],
                op.char.parent.id[0],
                ...lamportsInCharParentTs(op.char.parent.ts).map((id) => id[0]),
            );
        case 'block':
            return Math.max(op.block.id[0], op.block.order.id[0], ...op.block.order.path.map((id) => id[0]));
        case 'char:move':
            return Math.max(
                op.id[0],
                op.parent.id[0],
                ...lamportsInCharParentTs(op.parent.ts).map((id) => id[0]),
            );
        case 'char:delete':
        case 'block:delete':
        case 'block:meta':
            return op.id[0];
        case 'block:move':
            return Math.max(op.id[0], op.order.id[0], ...op.order.path.map((id) => id[0]));
        case 'mark':
            return Math.max(
                op.mark.id[0],
                op.mark.start.id[0],
                op.mark.end.id[0],
                ...op.mark.crossedSplits.map((id) => id[0]),
            );
        case 'split-record':
            return Math.max(op.split.id[0], op.split.left[0], op.split.right[0]);
        case 'join-record':
            return Math.max(op.join.id[0], op.join.left[0], op.join.right[0], op.join.tail[0]);
    }
};

const lamportsInCharParentTs = (ts: Char['parent']['ts']): Lamport[] =>
    Array.isArray(ts) ? ts[1] : [];

const lamportsForOp = (op: Op): Lamport[] => {
    switch (op.type) {
        case 'char':
            return [op.char.id, op.char.parent.id, ...lamportsInCharParentTs(op.char.parent.ts)];
        case 'block':
            return [op.block.id, op.block.order.id, ...op.block.order.path];
        case 'char:move':
            return [op.id, op.parent.id, ...lamportsInCharParentTs(op.parent.ts)];
        case 'char:delete':
        case 'block:delete':
        case 'block:meta':
            return [op.id];
        case 'block:move':
            return [op.id, op.order.id, ...op.order.path];
        case 'mark':
            return [
                op.mark.id,
                op.mark.start.id,
                op.mark.end.id,
                ...op.mark.crossedSplits,
            ];
        case 'split-record':
            return [op.split.id, op.split.left, op.split.right];
        case 'join-record':
            return [op.join.id, op.join.left, op.join.right, op.join.tail];
    }
};
