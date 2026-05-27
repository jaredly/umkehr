import {useValue} from 'umkehr/react';
import {minimapHeight, minimapWidth} from './constants';
import {BOARD_HEIGHT, BOARD_WIDTH} from './helpers';
import type {WhiteboardEditorContext} from './types';

export function Minimap({
    visibleElementIds,
    editor,
    viewRect,
    dragging,
    setDragging,
    recenter,
}: {
    visibleElementIds: string[];
    editor: WhiteboardEditorContext;
    viewRect: {x: number; y: number; width: number; height: number};
    dragging: boolean;
    setDragging(value: boolean): void;
    recenter(clientX: number, clientY: number, rect: DOMRect): void;
}) {
    return (
        <button
            type="button"
            className="whiteboardMinimap"
            onPointerDown={(event) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
                recenter(event.clientX, event.clientY, rect);
            }}
            onPointerMove={(event) => {
                if (!dragging) return;
                event.preventDefault();
                recenter(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
            }}
            onPointerUp={(event) => {
                event.preventDefault();
                setDragging(false);
            }}
            onPointerCancel={(event) => {
                event.preventDefault();
                setDragging(false);
            }}
            onClick={(event) => {
                event.preventDefault();
            }}
            aria-label="Recenter board"
        >
            <svg
                width={minimapWidth}
                height={minimapHeight}
                viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
            >
                <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="#f8fafc" />
                {visibleElementIds.map((id) => (
                    <MinimapElement key={id} id={id} editor={editor} />
                ))}
                <rect
                    x={viewRect.x}
                    y={viewRect.y}
                    width={viewRect.width}
                    height={viewRect.height}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={20}
                />
            </svg>
        </button>
    );
}

function MinimapElement({id, editor}: {id: string; editor: WhiteboardEditorContext}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || element.archived) return null;
    return (
        <rect
            x={element.position.x}
            y={element.position.y}
            width={
                element.type === 'note'
                    ? element.size.width
                    : element.type === 'emoji'
                      ? element.size
                      : 40
            }
            height={
                element.type === 'note'
                    ? element.size.height
                    : element.type === 'emoji'
                      ? element.size
                      : 24
            }
            fill={element.type === 'note' ? element.color : '#94a3b8'}
        />
    );
}
