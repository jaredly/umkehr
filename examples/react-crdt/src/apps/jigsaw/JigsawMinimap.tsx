import type {PointerEvent} from 'react';
import type {JigsawBoardArtifact} from './artifacts';
import type {Coord, PathSegment} from './model';

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
    board,
    boardSpace,
    imageOffset,
    imageSize,
    renderedPositions,
    placedPieces,
    viewport,
    viewportSize,
    torus,
    dragging,
    setDragging,
    recenter,
}: {
    board: JigsawBoardArtifact;
    boardSpace: JigsawBoardSpace;
    imageOffset: Coord;
    imageSize: {width: number; height: number};
    renderedPositions: Map<number, Coord>;
    placedPieces: Set<number>;
    viewport: JigsawViewport;
    viewportSize: {width: number; height: number};
    torus?: {
        imageSize: {width: number; height: number};
        panX: number;
        panY: number;
    };
    dragging: boolean;
    setDragging(value: boolean): void;
    recenter(point: Coord): void;
}) {
    const innerWidth = minimapWidth - minimapPadding * 2;
    const innerHeight = minimapHeight - minimapPadding * 2;
    const contentBounds = minimapContentBounds(board, imageOffset, imageSize, boardSpace, renderedPositions);
    const scale = Math.min(innerWidth / contentBounds.width, innerHeight / contentBounds.height);
    const contentWidth = contentBounds.width * scale;
    const contentHeight = contentBounds.height * scale;
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
    const torusCut = torus
        ? {
              x: imageOffset.x + positiveModulo(-torus.panX, torus.imageSize.width),
              y: imageOffset.y + positiveModulo(-torus.panY, torus.imageSize.height),
          }
        : null;

    const recenterFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const point = minimapToBoard(event.clientX, event.clientY, rect, offset, contentBounds, scale);
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
                <g
                    transform={`translate(${offset.x} ${offset.y}) scale(${scale}) translate(${-contentBounds.left} ${-contentBounds.top})`}
                >
                    <rect
                        x={contentBounds.left}
                        y={contentBounds.top}
                        width={contentBounds.width}
                        height={contentBounds.height}
                        fill="#eef2f6"
                    />
                    <rect
                        x={imageOffset.x}
                        y={imageOffset.y}
                        width={imageSize.width}
                        height={imageSize.height}
                        fill="#dbeafe"
                        stroke="#94a3b8"
                        strokeWidth={6}
                    />
                    {torusCut ? (
                        <g opacity={0.82}>
                            <line
                                x1={torusCut.x}
                                y1={imageOffset.y}
                                x2={torusCut.x}
                                y2={imageOffset.y + imageSize.height}
                                stroke="#0f766e"
                                strokeWidth={8}
                                strokeDasharray="18 14"
                            />
                            <line
                                x1={imageOffset.x}
                                y1={torusCut.y}
                                x2={imageOffset.x + imageSize.width}
                                y2={torusCut.y}
                                stroke="#0f766e"
                                strokeWidth={8}
                                strokeDasharray="18 14"
                            />
                        </g>
                    ) : null}
                    {Array.from(renderedPositions.entries()).map(([piece, position]) => {
                        const pieceData = board.pieces[piece];
                        if (!pieceData) return null;
                        const placed = placedPieces.has(piece);
                        return (
                            <path
                                key={piece}
                                d={svgPathForMask(pieceData.mask)}
                                transform={`translate(${position.x + imageOffset.x} ${position.y + imageOffset.y})`}
                                fill={pieceFill(board, piece)}
                                fillOpacity={placed ? 0.86 : 0.56}
                            />
                        );
                    })}
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
    contentBounds: {left: number; top: number},
    scale: number,
) {
    return {
        x: (clientX - rect.left - offset.x) / scale + contentBounds.left,
        y: (clientY - rect.top - offset.y) / scale + contentBounds.top,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function positiveModulo(value: number, size: number) {
    if (size <= 0) return value;
    return ((value % size) + size) % size;
}

function minimapContentBounds(
    board: JigsawBoardArtifact,
    imageOffset: Coord,
    imageSize: {width: number; height: number},
    boardSpace: JigsawBoardSpace,
    renderedPositions: Map<number, Coord>,
) {
    let left = 0;
    let top = 0;
    let right = boardSpace.width;
    let bottom = boardSpace.height;

    left = Math.min(left, imageOffset.x);
    top = Math.min(top, imageOffset.y);
    right = Math.max(right, imageOffset.x + imageSize.width);
    bottom = Math.max(bottom, imageOffset.y + imageSize.height);

    for (const [piece, position] of renderedPositions) {
        const bounds = board.pieces[piece]?.bounds;
        if (!bounds) continue;
        left = Math.min(left, imageOffset.x + position.x + bounds.left);
        top = Math.min(top, imageOffset.y + position.y + bounds.top);
        right = Math.max(right, imageOffset.x + position.x + bounds.left + bounds.width);
        bottom = Math.max(bottom, imageOffset.y + position.y + bounds.top + bounds.height);
    }

    return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}

function svgPathForMask(mask: PathSegment[]) {
    const [first, ...rest] = mask;
    if (!first) return 'M -1 -1 H 1 V 1 H -1 Z';
    const commands = [`M ${first.to.x} ${first.to.y}`];
    for (const segment of rest) {
        if (segment.type === 'Quadratic') {
            commands.push(`Q ${segment.control.x} ${segment.control.y} ${segment.to.x} ${segment.to.y}`);
        } else if (segment.type === 'Cubic') {
            commands.push(
                `C ${segment.control1.x} ${segment.control1.y} ${segment.control2.x} ${segment.control2.y} ${segment.to.x} ${segment.to.y}`,
            );
        } else {
            commands.push(`L ${segment.to.x} ${segment.to.y}`);
        }
    }
    commands.push('Z');
    return commands.join(' ');
}

function pieceFill(board: JigsawBoardArtifact, piece: number) {
    const center = board.pieces[piece]?.center ?? {x: 0, y: 0};
    const hue = (center.x / Math.max(1, board.imageSize.width)) * 360;
    const lightness = 30 + (center.y / Math.max(1, board.imageSize.height)) * 40;
    return `hsl(${hue} 78% ${lightness}%)`;
}
