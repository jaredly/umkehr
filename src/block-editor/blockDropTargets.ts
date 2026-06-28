import type {FormattedBlock} from '../block-crdt/index.js';
import type {CachedState} from '../block-crdt/types.js';

import type {MoveTarget} from './blockCommands';
import type {RichBlockMeta} from './blockMeta';
import {editableBlockIds} from './selectionModel';
import type {DropTarget} from './useBlockReorder';

type RichFormattedBlock = FormattedBlock<RichBlockMeta>;

export const orderDraggedBlockIds = (
    state: CachedState<RichBlockMeta>,
    blockIds: string[],
    target: MoveTarget,
): string[] => {
    const order = editableBlockIds(state);
    const sorted = [...new Set(blockIds)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (target.type === 'after' || (target.type === 'child' && target.at === 'start')) {
        return sorted.reverse();
    }
    return sorted;
};

export const orderDraggedBlockIdsForCellSlot = (
    state: CachedState<RichBlockMeta>,
    blockIds: string[],
): string[] => {
    const order = editableBlockIds(state);
    return [...new Set(blockIds)].sort((a, b) => order.indexOf(b) - order.indexOf(a));
};

export const blockDropTargetFromPoint = (
    clientX: number,
    clientY: number,
    sourceTableId: string,
    context: {blocks: RichFormattedBlock[]},
): DropTarget | null => {
    const blockElement =
        typeof document.elementsFromPoint === 'function'
            ? document
                  .elementsFromPoint(clientX, clientY)
                  .map((element) => blockElementFromHitTestElement(element))
                  .find(
                      (element): element is HTMLElement =>
                          !!element?.dataset.blockId &&
                          element.closest<HTMLElement>('[data-table-id]')?.dataset.tableId !== sourceTableId,
                  )
            : null;
    if (blockElement) return dropTargetForBlockElement(blockElement, clientY, context);

    const rows = context.blocks
        .map((block) => {
            const editable = document.querySelector<HTMLElement>(
                `[data-block-id="${CSS.escape(block.id)}"]`,
            );
            const row = editable?.closest<HTMLElement>('.blockRow');
            if (!row || row.closest<HTMLElement>('[data-table-id]')?.dataset.tableId === sourceTableId) {
                return null;
            }
            return {block, row, rect: row.getBoundingClientRect()};
        })
        .filter((row) => row !== null);
    if (!rows.length) return null;

    const containing = rows.find(({rect}) => clientY >= rect.top && clientY <= rect.bottom);
    if (containing) return dropTargetForBlockElement(containing.row, clientY, context, containing.block);

    const before = rows.find(({rect}) => clientY < rect.top);
    if (before) {
        return {
            command: {type: 'before', targetBlockId: before.block.id},
            indicatorBlockId: before.block.id,
            indicatorPlacement: 'before',
            indicatorDepth: before.block.depth,
        };
    }
    const last = rows[rows.length - 1];
    return {
        command: {type: 'after', targetBlockId: last.block.id},
        indicatorBlockId: last.block.id,
        indicatorPlacement: 'after',
        indicatorDepth: last.block.depth,
    };
};

const blockElementFromHitTestElement = (element: Element): HTMLElement | null => {
    const editable = element.closest<HTMLElement>('[data-block-id]');
    if (editable) return editable;
    const row = element.closest<HTMLElement>('.blockRow');
    return row?.querySelector<HTMLElement>('[data-block-id]') ?? null;
};

const dropTargetForBlockElement = (
    blockElement: HTMLElement,
    clientY: number,
    context: {blocks: RichFormattedBlock[]},
    knownBlock?: RichFormattedBlock,
): DropTarget | null => {
    const blockId = blockElement.dataset.blockId;
    const block = knownBlock ?? (blockId ? context.blocks.find((candidate) => candidate.id === blockId) : null);
    if (!block) return null;
    const row = blockElement.classList.contains('blockRow')
        ? blockElement
        : blockElement.closest<HTMLElement>('.blockRow') ?? blockElement;
    const rect = row.getBoundingClientRect();
    const placement = rect.height > 0 && clientY > rect.top + rect.height / 2 ? 'after' : 'before';
    const command: MoveTarget =
        placement === 'after'
            ? {type: 'after', targetBlockId: block.id}
            : {type: 'before', targetBlockId: block.id};
    return {
        command,
        indicatorBlockId: block.id,
        indicatorPlacement: placement,
        indicatorDepth: block.depth,
    };
};
