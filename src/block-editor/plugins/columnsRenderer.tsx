import type {CSSProperties} from 'react';

import type {RichBlockMeta} from '../blockMeta.js';
import type {BlockEditorBlockRenderer, BlockEditorRenderedBlockNode} from './types.js';

type ColumnsNode = BlockEditorRenderedBlockNode<RichBlockMeta>;
type ColumnsContext = Parameters<BlockEditorBlockRenderer<RichBlockMeta>['render']>[1];

export const columnsBlockRenderer: BlockEditorBlockRenderer<RichBlockMeta> = {
    id: 'render:columns',
    blockType: 'columns',
    children: 'renderer',
    render(node, context) {
        const meta = node.block.block.meta;
        if (meta.type !== 'columns') return null;
        const display = meta.display;
        return (
            <section
                className={['columnsBlock', display === 'cards' ? 'columnsBlockCards' : 'columnsBlockBlocks'].join(' ')}
                data-columns-board-id={node.id}
                data-columns-display={display}
                style={{'--block-depth': node.block.depth} as CSSProperties}
            >
                <div className="columnsTitle">
                    {context.blocks.renderEditableBlock(node, {surfaceClassName: 'columnsTitleText'})}
                </div>
                <div className="columnsColumns" data-columns-board-id={node.id} data-columns-display={display}>
                    {display === 'cards'
                        ? node.children.map((column) => <ColumnsCardModeColumn key={column.id} node={column} context={context} />)
                        : node.children.map((column) => (
                              <ColumnsBlockModeColumn
                                  key={column.id}
                                  node={column}
                                  context={context}
                                  baseDepth={node.block.depth + 1}
                              />
                          ))}
                </div>
            </section>
        );
    },
};

function ColumnsBlockModeColumn({
    node,
    context,
    baseDepth,
}: {
    node: ColumnsNode;
    context: ColumnsContext;
    baseDepth: number;
}) {
    const dropTarget = context.dragDrop.dropTargetForBlock(node.id);
    return (
        <div
            ref={(element) => context.dragDrop.registerRow(node.id, element)}
            className={[
                'columnsColumn',
                'columnsColumnBlocks',
                context.dragDrop.isDragging(node.id) ? 'dragging' : '',
                context.dragDrop.isDraggingRoot(node.id) ? 'draggingRoot' : '',
                dropTarget ? `drop${capitalize(dropTarget.indicatorPlacement)}` : '',
            ].filter(Boolean).join(' ')}
            data-columns-column-id={node.id}
            data-columns-column-display="blocks"
        >
            {context.blocks.renderNodeAtRelativeDepth(node, baseDepth)}
        </div>
    );
}

function ColumnsCardModeColumn({node, context}: {node: ColumnsNode; context: ColumnsContext}) {
    const dropTarget = context.dragDrop.dropTargetForBlock(node.id);
    return (
        <section
            ref={(element) => context.dragDrop.registerRow(node.id, element)}
            className={[
                'columnsColumn',
                'columnsColumnCards',
                context.dragDrop.isDragging(node.id) ? 'dragging' : '',
                context.dragDrop.isDraggingRoot(node.id) ? 'draggingRoot' : '',
                dropTarget ? `drop${capitalize(dropTarget.indicatorPlacement)}` : '',
            ].filter(Boolean).join(' ')}
            data-columns-column-id={node.id}
            data-columns-column-display="cards"
        >
            <div className="columnsColumnHeader">
                <button
                    type="button"
                    className="columnsColumnHandle"
                    aria-label="Move column"
                    onPointerDown={(event) => context.dragDrop.startBlockDragFromHandle(node.id, event)}
                >
                    ::
                </button>
                {context.blocks.renderEditableBlock({...node.block, depth: 0}, {
                    surfaceClassName: 'columnsColumnTitle',
                    hideBlockAffordance: true,
                    registerBlockRow: false,
                })}
            </div>
            <div className="columnsCards" data-columns-column-cards={node.id}>
                {node.children.map((card) => (
                    <ColumnsCard key={card.id} node={card} context={context} baseDepth={node.block.depth + 1} />
                ))}
            </div>
        </section>
    );
}

function ColumnsCard({
    node,
    context,
    baseDepth,
}: {
    node: ColumnsNode;
    context: ColumnsContext;
    baseDepth: number;
}) {
    const decoration = context.decorations.blockLevel(node.id);
    return (
        <article
            ref={(element) => context.dragDrop.registerRow(node.id, element)}
            className={[
                'columnsCard',
                decoration?.selected ? 'blockSelected' : '',
                decoration?.focus ? 'blockSelectionFocus' : '',
                context.dragDrop.isDragging(node.id) ? 'dragging' : '',
                context.dragDrop.isDraggingRoot(node.id) ? 'draggingRoot' : '',
            ].filter(Boolean).join(' ')}
            data-columns-card-id={node.id}
        >
            <button
                type="button"
                className="columnsCardHandle"
                aria-label="Move card"
                onPointerDown={(event) => context.dragDrop.startBlockDragFromHandle(node.id, event)}
            >
                ::
            </button>
            <div className="columnsCardBody">
                {context.blocks.renderEditableBlock({...node.block, depth: 0}, {
                    surfaceClassName: 'columnsCardTitle',
                    hideBlockAffordance: true,
                    registerBlockRow: false,
                })}
                {node.children.length > 0 ? (
                    <div className="columnsCardChildren">
                        {node.children.map((child) => context.blocks.renderNodeAtRelativeDepth(child, baseDepth + 1))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

const capitalize = (value: string): string => (value ? value[0].toUpperCase() + value.slice(1) : value);

