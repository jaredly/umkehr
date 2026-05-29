import {useValue} from 'umkehr/react';
import type {WhiteboardElement} from './model';
import type {WhiteboardEditorContext} from './types';

export function ArchiveTray({
    archivedElementIds,
    editor,
    recover,
    readOnly,
}: {
    archivedElementIds: string[];
    editor: WhiteboardEditorContext;
    recover(id: string): void;
    readOnly: boolean;
}) {
    return (
        <div className="whiteboardArchive" data-testid="whiteboard-archive-tray">
            {archivedElementIds.length ? (
                archivedElementIds.map((id) => (
                    <ArchivedElementButton
                        key={id}
                        id={id}
                        editor={editor}
                        recover={recover}
                        readOnly={readOnly}
                    />
                ))
            ) : (
                <span>No archived elements</span>
            )}
        </div>
    );
}

function ArchivedElementButton({
    id,
    editor,
    recover,
    readOnly,
}: {
    id: string;
    editor: WhiteboardEditorContext;
    recover(id: string): void;
    readOnly: boolean;
}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || !element.archived) return null;
    return (
        <button
            type="button"
            data-testid="whiteboard-archive-item"
            data-element-id={element.id}
            onClick={() => recover(element.id)}
            disabled={readOnly}
        >
            Recover {nameForElement(element)}
        </button>
    );
}

function nameForElement(element: WhiteboardElement) {
    if (element.type === 'note') return element.text.trim() || 'note';
    if (element.type === 'emoji') return `${element.emoji} stamp`;
    return 'stroke';
}
