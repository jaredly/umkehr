import {
    emojiChoices,
    labelForTool,
    noteColors,
    type EmojiChoice,
    type NoteColor,
    type Tool,
} from './constants';

export function Toolbar({
    tool,
    setTool,
    noteColor,
    setNoteColor,
    selectedEmoji,
    setSelectedEmoji,
    selectedId,
    archivedCount,
    readOnly,
    setLayer,
    archiveSelected,
    showArchive,
    setShowArchive,
    zoomBy,
}: {
    tool: Tool;
    setTool(tool: Tool): void;
    noteColor: NoteColor;
    setNoteColor(color: NoteColor): void;
    selectedEmoji: EmojiChoice;
    setSelectedEmoji(emoji: EmojiChoice): void;
    selectedId: string | null;
    archivedCount: number;
    readOnly: boolean;
    setLayer(placement: 'front' | 'back' | 'forward' | 'backward'): void;
    archiveSelected(): void;
    showArchive: boolean;
    setShowArchive(updater: (value: boolean) => boolean): void;
    zoomBy(factor: number): void;
}) {
    return (
        <div className="whiteboardToolbar" aria-label="Whiteboard tools">
            {(['select', 'note', 'pen', 'emoji', 'erase', 'pan'] as const).map((item) => (
                <button
                    key={item}
                    type="button"
                    className={tool === item ? 'active' : ''}
                    onClick={() => setTool(item)}
                    disabled={readOnly && item !== 'select' && item !== 'pan'}
                >
                    {labelForTool(item)}
                </button>
            ))}
            <div className="whiteboardSwatches" aria-label="Note color">
                {noteColors.map((color) => (
                    <button
                        key={color}
                        type="button"
                        className={noteColor === color ? 'whiteboardSwatch active' : 'whiteboardSwatch'}
                        style={{backgroundColor: color}}
                        onClick={() => setNoteColor(color)}
                        aria-label={`Note color ${color}`}
                        disabled={readOnly}
                    />
                ))}
            </div>
            <select
                value={selectedEmoji}
                onChange={(event) => setSelectedEmoji(event.target.value as EmojiChoice)}
                aria-label="Emoji stamp"
                disabled={readOnly}
            >
                {emojiChoices.map((emoji) => (
                    <option key={emoji} value={emoji}>
                        {emoji}
                    </option>
                ))}
            </select>
            <button type="button" onClick={() => setLayer('back')} disabled={readOnly || !selectedId}>
                Send Back
            </button>
            <button
                type="button"
                onClick={() => setLayer('backward')}
                disabled={readOnly || !selectedId}
            >
                Backward
            </button>
            <button
                type="button"
                onClick={() => setLayer('forward')}
                disabled={readOnly || !selectedId}
            >
                Forward
            </button>
            <button type="button" onClick={() => setLayer('front')} disabled={readOnly || !selectedId}>
                Bring Front
            </button>
            <button type="button" onClick={archiveSelected} disabled={readOnly || !selectedId}>
                Archive
            </button>
            <button type="button" onClick={() => setShowArchive((value) => !value)}>
                {showArchive ? 'Hide Archive' : 'Recover'} ({archivedCount})
            </button>
            <button type="button" onClick={() => zoomBy(0.9)} aria-label="Zoom out">
                -
            </button>
            <button type="button" onClick={() => zoomBy(1.1)} aria-label="Zoom in">
                +
            </button>
        </div>
    );
}
