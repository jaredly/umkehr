import type {EphemeralRecord} from 'umkehr';
import {useValue} from 'umkehr/react';
import {previewElementStyle} from './elementStyles';
import {boundsForElements} from './geometry';
import {BOARD_HEIGHT, BOARD_WIDTH, strokePath} from './helpers';
import type {
    WhiteboardElementPreviewData,
    WhiteboardEphemeralData,
    WhiteboardSelectionData,
    WhiteboardStrokePreviewData,
} from './model';
import type {WhiteboardEditorContext} from './types';

export function RemoteEphemeralOverlays({
    actor,
    editor,
    records,
}: {
    actor: string;
    editor: WhiteboardEditorContext;
    records: EphemeralRecord<WhiteboardEphemeralData>[];
}) {
    return (
        <>
            {records.map((record) => {
                if (record.message.actor === actor) return null;
                const data = record.message.data;
                if (data.type === 'element-preview') {
                    return (
                        <ElementPreviewOverlay
                            key={record.message.id}
                            preview={data}
                            editor={editor}
                            state={record.state}
                        />
                    );
                }
                if (data.type === 'stroke-preview') {
                    return (
                        <StrokePreviewOverlay
                            key={record.message.id}
                            preview={data}
                            state={record.state}
                        />
                    );
                }
                return (
                    <SelectionPreviewOverlay
                        key={record.message.id}
                        editor={editor}
                        preview={data}
                        state={record.state}
                    />
                );
            })}
        </>
    );
}

export function ElementPreviewOverlay({
    preview,
    editor,
    state = 'active',
    local = false,
}: {
    preview: WhiteboardElementPreviewData;
    editor: WhiteboardEditorContext;
    state?: EphemeralRecord<WhiteboardEphemeralData>['state'];
    local?: boolean;
}) {
    const element = useValue(editor.$.elements[preview.elementId]);
    if (!element || element.archived) return null;
    const className = `whiteboardPreviewOverlay ${local ? 'local' : 'remote'} ${
        state === 'stale' ? 'stale' : ''
    }`;
    if (element.type === 'stroke') {
        return (
            <svg
                className={`whiteboardPreviewSvg ${local ? 'local' : 'remote'} ${
                    state === 'stale' ? 'stale' : ''
                }`}
                width={BOARD_WIDTH}
                height={BOARD_HEIGHT}
                viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
            >
                <g transform={`translate(${preview.x} ${preview.y})`}>
                    <path
                        d={strokePath(element.points)}
                        fill="none"
                        stroke={element.color}
                        strokeWidth={element.strokeWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </g>
            </svg>
        );
    }
    if (element.type === 'note') {
        return (
            <article
                className={`${className} whiteboardNote`}
                style={previewElementStyle(element, preview, {
                    width: preview.width ?? element.size.width,
                    height: preview.height ?? element.size.height,
                    backgroundColor: element.color,
                })}
            >
                <div className="whiteboardNoteHandle" />
                <div className="whiteboardPreviewNoteText">{element.text || 'Note'}</div>
            </article>
        );
    }
    return (
        <div
            className={`${className} whiteboardEmoji`}
            style={previewElementStyle(element, preview, {
                width: preview.width ?? element.size,
                height: preview.height ?? element.size,
                fontSize: preview.width ?? element.size,
            })}
        >
            {element.emoji}
        </div>
    );
}

function StrokePreviewOverlay({
    preview,
    state,
}: {
    preview: WhiteboardStrokePreviewData;
    state: EphemeralRecord<WhiteboardEphemeralData>['state'];
}) {
    const points = preview.points.map(([x, y, pressure]) => ({x, y, pressure}));
    if (points.length < 1) return null;
    return (
        <svg
            className={`whiteboardPreviewSvg ${state === 'stale' ? 'stale' : ''}`}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        >
            <path
                d={strokePath(points)}
                fill="none"
                stroke={preview.color}
                strokeWidth={preview.width}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function SelectionPreviewOverlay({
    editor,
    preview,
    state,
}: {
    editor: WhiteboardEditorContext;
    preview: WhiteboardSelectionData;
    state: EphemeralRecord<WhiteboardEphemeralData>['state'];
}) {
    const bounds = preview.bounds ?? boundsForElements(editor.latest(), preview.elementIds);
    if (!bounds) return null;
    return (
        <div
            className={`whiteboardSelectionPreview ${state === 'stale' ? 'stale' : ''}`}
            style={{
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
            }}
        />
    );
}
