import {useCallback, useEffect, useMemo, useState} from 'react';
import {useValue} from 'umkehr/react';
import {RichTextEditor, type RichTextBinding} from 'umkehr/react-crdt';
import {materializeRichTextValue, richText} from 'umkehr/richtext';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {noteFieldPath, noteListItems, notePath, noteTitle} from './helpers';
import type {RichNote, RichNotesState} from './model';

const hashPrefix = 'rich-note=';

export function RichNotesPanel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<RichNotesState>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const activeNotes = useValue(editor.$, (state) => noteListItems(state, false));
    const archivedNotes = useValue(editor.$, (state) => noteListItems(state, true));
    const [selectedId, setSelectedId] = useState(() => readSelectedIdFromHash());
    const [showArchive, setShowArchive] = useState(false);

    useEffect(() => {
        const readHash = () => setSelectedId(readSelectedIdFromHash());
        window.addEventListener('hashchange', readHash);
        window.addEventListener('popstate', readHash);
        return () => {
            window.removeEventListener('hashchange', readHash);
            window.removeEventListener('popstate', readHash);
        };
    }, []);

    const selectedNote = selectedId ? editor.latest().notes[selectedId] : undefined;
    const visibleSelectedNote = selectedNote && !selectedNote.archived ? selectedNote : undefined;

    useEffect(() => {
        if (visibleSelectedNote) return;
        const nextId = activeNotes[0]?.id ?? null;
        if (nextId !== selectedId) {
            setSelectedId(nextId);
            writeSelectedIdToHash(nextId, 'replace');
        }
    }, [activeNotes, selectedId, visibleSelectedNote]);

    const selectNote = useCallback((id: string | null) => {
        setSelectedId(id);
        writeSelectedIdToHash(id, 'push');
    }, []);

    const createNote = useCallback(() => {
        if (readOnly) return;
        const now = new Date().toISOString();
        const id = `note-${actor}-${crypto.randomUUID()}`;
        const note: RichNote = {
            id,
            body: richText(),
            createdAt: now,
            updatedAt: now,
            archived: false,
        };
        editor.dispatch({op: 'add', path: notePath(id), value: note});
        selectNote(id);
    }, [actor, editor, readOnly, selectNote]);

    const archiveNote = useCallback(
        (id: string) => {
            if (readOnly) return;
            editor.dispatch([
                {op: 'replace', path: noteFieldPath(id, 'archived'), value: true},
                {
                    op: 'replace',
                    path: noteFieldPath(id, 'updatedAt'),
                    value: new Date().toISOString(),
                },
            ]);
            if (selectedId === id) {
                const nextId = activeNotes.find((note) => note.id !== id)?.id ?? null;
                selectNote(nextId);
            }
        },
        [activeNotes, editor, readOnly, selectNote, selectedId],
    );

    const recoverNote = useCallback(
        (id: string) => {
            if (readOnly) return;
            editor.dispatch([
                {op: 'replace', path: noteFieldPath(id, 'archived'), value: false},
                {
                    op: 'replace',
                    path: noteFieldPath(id, 'updatedAt'),
                    value: new Date().toISOString(),
                },
            ]);
            setShowArchive(false);
            selectNote(id);
        },
        [editor, readOnly, selectNote],
    );

    return (
        <section
            className={`richNotesPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
            data-testid="rich-notes-panel"
        >
            <aside className="richNotesSidebar" aria-label={`${title} notes`}>
                <header className="richNotesSidebarHeader">
                    <div>
                        <h1>{title}</h1>
                        <p>{activeNotes.length} active</p>
                    </div>
                    <button type="button" onClick={createNote} disabled={readOnly}>
                        New
                    </button>
                </header>

                <NoteList
                    notes={activeNotes}
                    selectedId={visibleSelectedNote?.id ?? null}
                    emptyLabel="No active notes"
                    onSelect={selectNote}
                    onArchive={archiveNote}
                    readOnly={readOnly}
                />

                <div className="richNotesArchiveHeader">
                    <button
                        type="button"
                        onClick={() => setShowArchive((value) => !value)}
                        disabled={archivedNotes.length === 0}
                    >
                        Archived ({archivedNotes.length})
                    </button>
                </div>
                {showArchive ? (
                    <NoteList
                        notes={archivedNotes}
                        selectedId={null}
                        emptyLabel="No archived notes"
                        onSelect={() => {}}
                        onRecover={recoverNote}
                        readOnly={readOnly}
                        archived
                    />
                ) : null}
            </aside>

            <main className="richNotesEditorPane">
                {visibleSelectedNote ? (
                    <SelectedNoteEditor
                        key={visibleSelectedNote.id}
                        editor={editor}
                        note={visibleSelectedNote}
                        readOnly={readOnly}
                    />
                ) : (
                    <div className="richNotesEmptyState">
                        <h2>No note selected</h2>
                        <button type="button" onClick={createNote} disabled={readOnly}>
                            New note
                        </button>
                    </div>
                )}
            </main>
        </section>
    );
}

function NoteList({
    notes,
    selectedId,
    emptyLabel,
    onSelect,
    onArchive,
    onRecover,
    readOnly,
    archived = false,
}: {
    notes: ReturnType<typeof noteListItems>;
    selectedId: string | null;
    emptyLabel: string;
    onSelect(id: string): void;
    onArchive?(id: string): void;
    onRecover?(id: string): void;
    readOnly: boolean;
    archived?: boolean;
}) {
    if (notes.length === 0) {
        return <p className="richNotesEmptyList">{emptyLabel}</p>;
    }
    return (
        <ul className="richNotesList">
            {notes.map((note) => (
                <li key={note.id}>
                    <button
                        type="button"
                        className={`richNoteRow ${selectedId === note.id ? 'richNoteRowActive' : ''}`}
                        onClick={() => onSelect(note.id)}
                        disabled={archived}
                    >
                        <span className="richNoteTitle">{note.title}</span>
                        <span className="richNoteDate">{formatModifiedDate(note.updatedAt)}</span>
                    </button>
                    {archived ? (
                        <button
                            type="button"
                            onClick={() => onRecover?.(note.id)}
                            disabled={readOnly}
                        >
                            Restore
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onArchive?.(note.id)}
                            disabled={readOnly}
                        >
                            Archive
                        </button>
                    )}
                </li>
            ))}
        </ul>
    );
}

function SelectedNoteEditor({
    editor,
    note,
    readOnly,
}: {
    editor: AppEditorContext<RichNotesState>;
    note: RichNote;
    readOnly: boolean;
}) {
    const body = useValue(editor.$.notes[note.id].body);
    const binding = useMemo((): RichTextBinding => {
        const touch = () => {
            editor.dispatch({
                op: 'replace',
                path: noteFieldPath(note.id, 'updatedAt'),
                value: new Date().toISOString(),
            });
        };
        return {
            view: materializeRichTextValue(body),
            commands: {
                insert(index, text) {
                    if (readOnly || !text) return;
                    touch();
                    editor.dispatch({
                        op: 'richText',
                        path: noteFieldPath(note.id, 'body'),
                        change: {kind: 'insert', at: {index}, text},
                    });
                },
                delete(start, end) {
                    if (readOnly || start === end) return;
                    touch();
                    editor.dispatch({
                        op: 'richText',
                        path: noteFieldPath(note.id, 'body'),
                        change: {kind: 'delete', range: {start, end}},
                    });
                },
                mark(start, end, markType, value, preset) {
                    if (readOnly || start === end) return;
                    touch();
                    editor.dispatch({
                        op: 'richText',
                        path: noteFieldPath(note.id, 'body'),
                        change: {kind: 'mark', range: {start, end}, markType, value, preset},
                    });
                },
                unmark(start, end, markType, preset) {
                    if (readOnly || start === end) return;
                    touch();
                    editor.dispatch({
                        op: 'richText',
                        path: noteFieldPath(note.id, 'body'),
                        change: {kind: 'unmark', range: {start, end}, markType, preset},
                    });
                },
                replace(snapshot) {
                    if (readOnly) return;
                    touch();
                    editor.dispatch({
                        op: 'richText',
                        path: noteFieldPath(note.id, 'body'),
                        change: {kind: 'replace', snapshot},
                    });
                },
            },
        };
    }, [body, editor, note.id, readOnly]);

    return (
        <>
            <header className="richNotesEditorHeader">
                <h2>{noteTitle({...note, body})}</h2>
                <p>{formatModifiedDate(note.updatedAt)}</p>
            </header>
            <div className="richNotesEditor" aria-disabled={readOnly}>
                <RichTextEditor {...binding} ariaLabel={`Body for ${noteTitle({...note, body})}`} />
            </div>
        </>
    );
}

function formatModifiedDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

function readSelectedIdFromHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash.startsWith(hashPrefix)) return null;
    return decodeURIComponent(hash.slice(hashPrefix.length)) || null;
}

function writeSelectedIdToHash(id: string | null, mode: 'push' | 'replace') {
    const nextHash = id ? `#${hashPrefix}${encodeURIComponent(id)}` : '';
    if (window.location.hash === nextHash) return;
    const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
    if (mode === 'push') window.history.pushState(window.history.state, '', nextUrl);
    else window.history.replaceState(window.history.state, '', nextUrl);
}
