import {useCallback} from 'react';
import {
    defaultEmojiSize,
    defaultNoteSize,
    penColor,
    strokeWidth,
    type EmojiChoice,
    type NoteColor,
    type Tool,
} from './constants';
import {
    elementFieldPath,
    elementPath,
    nextBottomZOrder,
    nextTopZOrder,
    orderedElements,
    simplifyStroke,
    zOrderBetween,
} from './helpers';
import type {
    StickyNoteElement,
    StrokePoint,
    WhiteboardElement,
} from './model';
import type {WhiteboardEditorContext} from './types';

export function useWhiteboardCommands({
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
}: {
    editor: WhiteboardEditorContext;
    actor: string;
    readOnly: boolean;
    selectedId: string | null;
    selectedEmoji: EmojiChoice;
    noteColor: NoteColor;
    setSelectedId(id: string | null): void;
    setTool(tool: Tool): void;
    setFocusNoteId(id: string | null): void;
    setShowArchive(value: boolean): void;
}) {
    const makeBase = useCallback(
        (
            type: WhiteboardElement['type'],
            x: number,
            y: number,
            id = `wb-${crypto.randomUUID()}`,
        ) => {
            return {
                type,
                id,
                position: {x, y},
                rotation: 0,
                zOrder: nextTopZOrder(orderedElements(editor.latest())),
                createdBy: actor,
                createdAt: new Date().toISOString(),
                archived: false,
            };
        },
        [actor, editor],
    );

    const addElement = useCallback(
        (element: WhiteboardElement) => {
            if (readOnly) return;
            editor.dispatch({op: 'add', path: elementPath(element.id), value: element});
            setSelectedId(element.id);
            setTool('select');
        },
        [editor, readOnly, setSelectedId, setTool],
    );

    const addNote = useCallback(
        (x: number, y: number) => {
            const note: StickyNoteElement = {
                ...makeBase('note', x, y),
                type: 'note',
                size: {...defaultNoteSize},
                color: noteColor,
                text: '',
            };
            addElement(note);
            setFocusNoteId(note.id);
        },
        [addElement, makeBase, noteColor, setFocusNoteId],
    );

    const addEmoji = useCallback(
        (x: number, y: number) => {
            addElement({
                ...makeBase('emoji', x, y),
                type: 'emoji',
                emoji: selectedEmoji,
                size: defaultEmojiSize,
            });
        },
        [addElement, makeBase, selectedEmoji],
    );

    const commitStroke = useCallback(
        (id: string, points: StrokePoint[]) => {
            const simplified = simplifyStroke(points);
            if (simplified.length < 2) return;
            const first = simplified[0];
            const localPoints = simplified.map((point) => ({
                ...point,
                x: point.x - first.x,
                y: point.y - first.y,
            }));
            addElement({
                ...makeBase('stroke', first.x, first.y, id),
                type: 'stroke',
                color: penColor,
                strokeWidth,
                points: localPoints,
            });
        },
        [addElement, makeBase],
    );

    const archiveSelected = useCallback(() => {
        if (readOnly || !selectedId) return;
        editor.dispatch([
            {op: 'replace', path: elementFieldPath(selectedId, 'archived'), value: true},
            {op: 'replace', path: elementFieldPath(selectedId, 'archivedBy'), value: actor},
            {
                op: 'replace',
                path: elementFieldPath(selectedId, 'archivedAt'),
                value: new Date().toISOString(),
            },
        ]);
        setSelectedId(null);
    }, [actor, editor, readOnly, selectedId, setSelectedId]);

    const recover = useCallback(
        (id: string) => {
            if (readOnly) return;
            editor.dispatch([
                {op: 'replace', path: elementFieldPath(id, 'archived'), value: false},
                {op: 'remove', path: elementFieldPath(id, 'archivedBy')},
                {op: 'remove', path: elementFieldPath(id, 'archivedAt')},
            ]);
            setSelectedId(id);
            setShowArchive(false);
        },
        [editor, readOnly, setSelectedId, setShowArchive],
    );

    const setLayer = useCallback(
        (placement: 'front' | 'back' | 'forward' | 'backward') => {
            if (readOnly || !selectedId) return;
            const current = orderedElements(editor.latest());
            const selected = current.find((element) => element.id === selectedId);
            if (!selected) return;
            const without = current.filter((element) => element.id !== selectedId);
            let next: string | null = null;
            if (placement === 'front') next = nextTopZOrder(without);
            if (placement === 'back') next = nextBottomZOrder(without);
            const index = current.findIndex((element) => element.id === selectedId);
            if (placement === 'forward' && index < current.length - 1) {
                next = zOrderBetween(current[index + 1], current[index + 2]);
            }
            if (placement === 'backward' && index > 0) {
                next = zOrderBetween(current[index - 2], current[index - 1]);
            }
            if (next && next !== selected.zOrder) {
                editor.dispatch({
                    op: 'replace',
                    path: elementFieldPath(selectedId, 'zOrder'),
                    value: next,
                });
            }
        },
        [editor, readOnly, selectedId],
    );

    return {
        addNote,
        addEmoji,
        commitStroke,
        archiveSelected,
        recover,
        setLayer,
    };
}
