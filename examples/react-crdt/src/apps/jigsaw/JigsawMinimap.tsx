import type {PointerEvent} from 'react';
import type {Coord} from './model';

export type JigsawBoardSpace = {
    width: number;
    height: number;
};

export type JigsawViewport = {
    panX: number;
    panY: number;
    zoom: number;
};

const minimapWidth = 132;
const minimapHeight = 92;
const minimapPadding = 6;

export function JigsawMinimap({
    boardSpace,
    imageOffset,
    imageSize,
    pieceSize,
    authoritativePositions,
    viewport,
    viewportSize,
    dragging,
    setDragging,
    recenter,
}: {
    boardSpace: JigsawBoardSpace;
    imageOffset: Coord;
    imageSize: {width: number; height: number};
    pieceSize: {width: number; height: number};
    authoritativePositions: Map<number, Coord>;
    viewport: JigsawViewport;
    viewportSize: {width: number; height: number};
    dragging: boolean;
    setDragging(value: boolean): void;
    recenter(point: Coord): void;
}) {
    const innerWidth = minimapWidth - minimapPadding * 2;
    const innerHeight = minimapHeight - minimapPadding * 2;
    const scale = Math.min(innerWidth / boardSpace.width, innerHeight / boardSpace.height);
    const contentWidth = boardSpace.width * scale;
    const contentHeight = boardSpace.height * scale;
    const offset = {
        x: minimapPadding + (innerWidth - contentWidth) / 2,
        y: minimapPadding + (innerHeight - contentHeight) / 2,
    };
    const viewRect = {
        x: clamp(-viewport.panX / viewport.zoom, 0, boardSpace.width),
        y: clamp(-viewport.panY / viewport.zoom, 0, boardSpace.height),
        width: clamp(viewportSize.width / viewport.zoom, 1, boardSpace.width),
        height: clamp(viewportSize.height / viewport.zoom, 1, boardSpace.height),
    };

    const recenterFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const point = minimapToBoard(event.clientX, event.clientY, rect, offset, scale);
        recenter({
            x: clamp(point.x, 0, boardSpace.width),
            y: clamp(point.y, 0, boardSpace.height),
        });
    };

    return (
        <button
            type="button"
            className="jigsawMinimap"
            aria-label="Recenter puzzle"
            data-testid="jigsaw-minimap"
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
                recenterFromPointer(event);
            }}
            onPointerMove={(event) => {
                if (!dragging) return;
                event.preventDefault();
                event.stopPropagation();
                recenterFromPointer(event);
            }}
            onPointerUp={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragging(false);
            }}
            onPointerCancel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragging(false);
            }}
            onClick={(event) => event.preventDefault()}
        >
            <svg width={minimapWidth} height={minimapHeight} viewBox={`0 0 ${minimapWidth} ${minimapHeight}`}>
                <rect width={minimapWidth} height={minimapHeight} rx={6} fill="#ffffff" />
                <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
                    <rect width={boardSpace.width} height={boardSpace.height} fill="#eef2f6" />
                    <rect
                        x={imageOffset.x}
                        y={imageOffset.y}
                        width={imageSize.width}
                        height={imageSize.height}
                        fill="#dbeafe"
                        stroke="#94a3b8"
                        strokeWidth={6}
                    />
                    {Array.from(authoritativePositions.entries()).map(([piece, position]) => (
                        <rect
                            key={piece}
                            x={position.x + imageOffset.x - pieceSize.width / 2}
                            y={position.y + imageOffset.y - pieceSize.height / 2}
                            width={pieceSize.width}
                            height={pieceSize.height}
                            fill="#2563eb"
                            opacity={0.72}
                        />
                    ))}
                    <rect
                        x={viewRect.x}
                        y={viewRect.y}
                        width={viewRect.width}
                        height={viewRect.height}
                        fill="none"
                        stroke="#0f172a"
                        strokeWidth={10}
                    />
                </g>
            </svg>
        </button>
    );
}

function minimapToBoard(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    offset: Coord,
    scale: number,
) {
    return {
        x: (clientX - rect.left - offset.x) / scale,
        y: (clientY - rect.top - offset.y) / scale,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
