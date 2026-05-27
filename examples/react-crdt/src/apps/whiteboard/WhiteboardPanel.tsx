import {useEffect, useState} from 'react';
import {useValue} from 'umkehr/react';
import type {GridSlot} from '../../lib/crdtApp';
import {ArchiveTray} from './ArchiveTray';
import {
    defaultEmojiChoice,
    defaultNoteColor,
    penColor,
    strokeWidth,
    type EmojiChoice,
    type NoteColor,
    type Tool,
} from './constants';
import {ElementSlot, StrokeSlot} from './ElementViews';
import {ElementPreviewOverlay, RemoteEphemeralOverlays} from './EphemeralOverlays';
import {boundsForElement} from './geometry';
import {
    BOARD_HEIGHT,
    BOARD_WIDTH,
    byZOrderThenId,
    strokePath,
} from './helpers';
import {
    clearEphemeralMessage,
    selectionId,
    selectionMessage,
} from './model';
import type {WhiteboardState} from './model';
import {Minimap} from './Minimap';
import type {WhiteboardEditorContext} from './types';
import {Toolbar} from './Toolbar';
import {useWhiteboardCommands} from './useWhiteboardCommands';
import {UndoRedoButtons} from './UndoRedoButtons';
import {useWhiteboardEphemeral} from './useWhiteboardEphemeral';
import {useWhiteboardGestures} from './useWhiteboardGestures';

export function WhiteboardPanel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
    setPresenceSelection,
}: {
    editor: WhiteboardEditorContext;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
    setPresenceSelection?: (elementId: string | null) => void;
}) {
    const background = useValue(editor.$.background);
    const visibleElementIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => !element.archived)
            .sort(byZOrderThenId)
            .map((element) => element.id),
    );
    const visibleStrokeIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => !element.archived && element.type === 'stroke')
            .sort(byZOrderThenId)
            .map((element) => element.id),
    );
    const visibleSurfaceElementIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => !element.archived && element.type !== 'stroke')
            .sort(byZOrderThenId)
            .map((element) => element.id),
    );
    const archivedElementIds = useValue(editor.$.elements, (elements) =>
        Object.values(elements)
            .filter((element) => element.archived)
            .sort(
                (a, b) =>
                    (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') ||
                    a.id.localeCompare(b.id),
            )
            .map((element) => element.id),
    );
    const [tool, setTool] = useState<Tool>('select');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedEmoji, setSelectedEmoji] = useState<EmojiChoice>(defaultEmojiChoice);
    const [noteColor, setNoteColor] = useState<NoteColor>(defaultNoteColor);
    const [showArchive, setShowArchive] = useState(false);
    const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
    const {remoteEphemeralRecords, publishEphemeral} = useWhiteboardEphemeral(editor);
    const {addNote, addEmoji, commitStroke, archiveSelected, recover, setLayer} =
        useWhiteboardCommands({
            editor,
            actor,
            readOnly,
            selectedId,
            selectedEmoji,
            noteColor,
            setSelectedId,
            setTool,
            setFocusNoteId,
            setShowArchive,
        });
    const {
        viewportRef,
        viewport,
        activeStroke,
        localElementPreview,
        draggingMinimap,
        setDraggingMinimap,
        viewRect,
        zoomBy,
        onWheel,
        onBoardPointerDown,
        onBoardPointerMove,
        onBoardPointerUp,
        onBoardPointerCancel,
        startElementDrag,
        startNoteResize,
        recenterFromMinimap,
    } = useWhiteboardGestures({
        editor,
        actor,
        readOnly,
        tool,
        selectedId,
        setSelectedId,
        addNote,
        addEmoji,
        commitStroke,
        publishEphemeral,
    });

    useEffect(() => {
        if (!readOnly) return;
        publishEphemeral([clearEphemeralMessage(actor, selectionId(actor))]);
        if (tool !== 'pan') setTool('select');
    }, [actor, publishEphemeral, readOnly, tool]);

    useEffect(() => {
        setPresenceSelection?.(readOnly ? null : selectedId);
    }, [readOnly, selectedId, setPresenceSelection]);

    useEffect(() => {
        if (readOnly || !selectedId) {
            publishEphemeral([clearEphemeralMessage(actor, selectionId(actor))]);
            return;
        }
        const element = editor.latest().elements[selectedId];
        publishEphemeral([
            selectionMessage({
                actor,
                elementIds: [selectedId],
                bounds: element ? boundsForElement(element) : undefined,
            }),
        ]);
        return () => {
            publishEphemeral([clearEphemeralMessage(actor, selectionId(actor))]);
        };
    }, [actor, editor, publishEphemeral, readOnly, selectedId]);

    return (
        <section
            className={`whiteboardPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
        >
            <header className="whiteboardHeader">
                <div>
                    <h1>{title}</h1>
                    <p>{visibleElementIds.length} visible</p>
                </div>
                <div className="whiteboardActions">
                    <UndoRedoButtons editor={editor} readOnly={readOnly} />
                </div>
            </header>

            <Toolbar
                tool={tool}
                setTool={setTool}
                noteColor={noteColor}
                setNoteColor={setNoteColor}
                selectedEmoji={selectedEmoji}
                setSelectedEmoji={setSelectedEmoji}
                selectedId={selectedId}
                archivedCount={archivedElementIds.length}
                readOnly={readOnly}
                setLayer={setLayer}
                archiveSelected={archiveSelected}
                showArchive={showArchive}
                setShowArchive={setShowArchive}
                zoomBy={zoomBy}
            />

            {showArchive ? (
                <ArchiveTray
                    archivedElementIds={archivedElementIds}
                    editor={editor}
                    recover={recover}
                    readOnly={readOnly}
                />
            ) : null}

            <div
                ref={viewportRef}
                className={`whiteboardViewport tool-${tool}`}
                onPointerDown={onBoardPointerDown}
                onPointerMove={onBoardPointerMove}
                onPointerUp={onBoardPointerUp}
                onPointerCancel={onBoardPointerCancel}
                onWheel={onWheel}
            >
                <div
                    className="whiteboardCanvas"
                    style={{
                        width: BOARD_WIDTH,
                        height: BOARD_HEIGHT,
                        transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                    }}
                >
                    <svg
                        className="whiteboardSvg"
                        width={BOARD_WIDTH}
                        height={BOARD_HEIGHT}
                        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
                    >
                        <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill={background} />
                        {visibleStrokeIds.map((id) => (
                            <StrokeSlot
                                key={id}
                                id={id}
                                selected={selectedId === id}
                                suppressed={localElementPreview?.elementId === id}
                                onPointerDown={startElementDrag}
                                editor={editor}
                            />
                        ))}
                        {activeStroke ? (
                            <path
                                className="whiteboardActiveStroke"
                                d={strokePath(activeStroke.points)}
                                fill="none"
                                stroke={penColor}
                                strokeWidth={strokeWidth}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        ) : null}
                    </svg>

                    {visibleSurfaceElementIds.map((id) => (
                        <ElementSlot
                            key={id}
                            id={id}
                            selected={selectedId === id}
                            editor={editor}
                            readOnly={readOnly}
                            autoFocus={focusNoteId === id}
                            suppressed={localElementPreview?.elementId === id}
                            onAutoFocused={() => setFocusNoteId(null)}
                            onPointerDown={startElementDrag}
                            onResizePointerDown={startNoteResize}
                        />
                    ))}
                    {localElementPreview ? (
                        <ElementPreviewOverlay
                            key={`local-${localElementPreview.elementId}`}
                            preview={localElementPreview}
                            editor={editor}
                            local
                        />
                    ) : null}
                    <RemoteEphemeralOverlays
                        actor={actor}
                        editor={editor}
                        records={remoteEphemeralRecords}
                    />
                </div>

                <Minimap
                    visibleElementIds={visibleElementIds}
                    editor={editor}
                    viewRect={viewRect}
                    dragging={draggingMinimap}
                    setDragging={setDraggingMinimap}
                    recenter={recenterFromMinimap}
                />
            </div>
        </section>
    );
}
