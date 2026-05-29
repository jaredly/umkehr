import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import {useValue} from 'umkehr/react';
import {useStatuses} from 'umkehr/react-crdt';
import {initialForNickname, whiteboardSelectionStatusKind} from '../../lib/server/presence';
import {elementClassName, elementStyle} from './elementStyles';
import {elementFieldPath, strokePath} from './helpers';
import type {
    EmojiStampElement,
    StickyNoteElement,
    StrokeElement,
    WhiteboardElement,
} from './model';
import type {WhiteboardEditorContext} from './types';

export function ElementSlot({
    id,
    selected,
    editor,
    readOnly,
    autoFocus,
    suppressed,
    onAutoFocused,
    onPointerDown,
    onResizePointerDown,
}: {
    id: string;
    selected: boolean;
    editor: WhiteboardEditorContext;
    readOnly: boolean;
    autoFocus: boolean;
    suppressed: boolean;
    onAutoFocused(): void;
    onPointerDown(
        element: WhiteboardElement,
        event: ReactPointerEvent<HTMLElement | SVGElement>,
    ): void;
    onResizePointerDown(
        element: StickyNoteElement,
        event: ReactPointerEvent<HTMLButtonElement>,
    ): void;
}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || element.archived || element.type === 'stroke') return null;
    if (element.type === 'note') {
        return (
            <NoteView
                element={element}
                selected={selected}
                editor={editor}
                readOnly={readOnly}
                autoFocus={autoFocus}
                suppressed={suppressed}
                onAutoFocused={onAutoFocused}
                onPointerDown={(event) => onPointerDown(element, event)}
                onResizePointerDown={(event) => onResizePointerDown(element, event)}
            />
        );
    }
    return (
        <EmojiView
            element={element}
            selected={selected}
            editor={editor}
            suppressed={suppressed}
            onPointerDown={(event) => onPointerDown(element, event)}
        />
    );
}

export function StrokeSlot({
    id,
    selected,
    suppressed,
    editor,
    onPointerDown,
}: {
    id: string;
    selected: boolean;
    suppressed: boolean;
    editor: WhiteboardEditorContext;
    onPointerDown(
        element: WhiteboardElement,
        event: ReactPointerEvent<HTMLElement | SVGElement>,
    ): void;
}) {
    const element = useValue(editor.$.elements[id]);
    if (!element || element.archived || element.type !== 'stroke') return null;
    return (
        <StrokeView
            element={element}
            selected={selected}
            suppressed={suppressed}
            onPointerDown={(event) => onPointerDown(element, event)}
            editor={editor}
        />
    );
}

function NoteView({
    element,
    selected,
    editor,
    readOnly,
    autoFocus,
    suppressed,
    onAutoFocused,
    onPointerDown,
    onResizePointerDown,
}: {
    element: StickyNoteElement;
    selected: boolean;
    editor: WhiteboardEditorContext;
    readOnly: boolean;
    autoFocus: boolean;
    suppressed: boolean;
    onAutoFocused(): void;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void;
}) {
    const [draft, setDraft] = useState(element.text);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const statuses = useSelectionStatuses(editor, element.id);
    useEffect(() => setDraft(element.text), [element.text]);
    useEffect(() => {
        if (!autoFocus || readOnly) return;
        textareaRef.current?.focus();
        onAutoFocused();
    }, [autoFocus, onAutoFocused, readOnly]);

    const commit = () => {
        if (!readOnly && draft !== element.text) {
            editor.dispatch({
                op: 'replace',
                path: elementFieldPath(element.id, 'text'),
                value: draft,
            });
        }
    };

    return (
        <article
            className={elementClassName('whiteboardNote', selected, suppressed)}
            data-testid="whiteboard-note"
            data-element-id={element.id}
            style={elementStyle(element, {
                width: element.size.width,
                height: element.size.height,
                backgroundColor: element.color,
            })}
        >
            <div className="whiteboardNoteHandle" onPointerDown={onPointerDown} />
            <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                    }
                    if (event.key === 'Escape') {
                        setDraft(element.text);
                        event.currentTarget.blur();
                    }
                }}
                placeholder="Note"
                readOnly={readOnly}
            />
            <RemoteSelections statuses={statuses} />
            <button
                type="button"
                className="whiteboardResize"
                onPointerDown={onResizePointerDown}
                aria-label="Resize note"
                disabled={readOnly}
            />
        </article>
    );
}

function EmojiView({
    element,
    selected,
    editor,
    suppressed,
    onPointerDown,
}: {
    element: EmojiStampElement;
    selected: boolean;
    editor: WhiteboardEditorContext;
    suppressed: boolean;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
}) {
    const statuses = useSelectionStatuses(editor, element.id);
    return (
        <div
            className={elementClassName('whiteboardEmoji', selected, suppressed)}
            data-testid="whiteboard-emoji"
            data-element-id={element.id}
            style={elementStyle(element, {
                width: element.size,
                height: element.size,
                fontSize: element.size,
            })}
            onPointerDown={onPointerDown}
        >
            {element.emoji}
            <RemoteSelections statuses={statuses} />
        </div>
    );
}

function StrokeView({
    element,
    selected,
    suppressed,
    editor,
    onPointerDown,
}: {
    element: StrokeElement;
    selected: boolean;
    suppressed: boolean;
    editor: WhiteboardEditorContext;
    onPointerDown(event: ReactPointerEvent<SVGPathElement>): void;
}) {
    const statuses = useSelectionStatuses(editor, element.id);
    return (
        <g transform={`translate(${element.position.x} ${element.position.y})`}>
            <path
                className={elementClassName('whiteboardStroke', selected, suppressed)}
                data-testid="whiteboard-stroke"
                data-element-id={element.id}
                d={strokePath(element.points)}
                fill="none"
                stroke={element.color}
                strokeWidth={element.strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                onPointerDown={onPointerDown}
            />
            {statuses.length ? (
                <foreignObject x={0} y={-30} width={120} height={28}>
                    <RemoteSelections statuses={statuses} />
                </foreignObject>
            ) : null}
        </g>
    );
}

function useSelectionStatuses(editor: WhiteboardEditorContext, id: string) {
    return useStatuses(editor.$.elements[id], {kinds: [whiteboardSelectionStatusKind]})
        .map((status) => status.data)
        .filter(isSelectionStatusData);
}

function RemoteSelections({statuses}: {statuses: SelectionStatusData[]}) {
    if (!statuses.length) return null;
    return (
        <div className="whiteboardRemoteSelections">
            {statuses.map((status) => (
                <span
                    key={status.actor}
                    style={{backgroundColor: status.color}}
                    title={`${status.nickname} selected this`}
                >
                    {initialForNickname(status.nickname)}
                </span>
            ))}
        </div>
    );
}

type SelectionStatusData = {
    actor: string;
    nickname: string;
    color: string;
    elementId: string;
};

function isSelectionStatusData(value: unknown): value is SelectionStatusData {
    return (
        typeof value === 'object' &&
        value !== null &&
        'actor' in value &&
        'nickname' in value &&
        'color' in value &&
        'elementId' in value
    );
}
