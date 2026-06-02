import type {Path} from 'umkehr';
import {materializeRichTextValue} from 'umkehr/richtext';
import type {RichNote, RichNotesState} from './model';

export type NoteListItem = {
    id: string;
    title: string;
    updatedAt: string;
    archived: boolean;
};

export function notePath(id: string): Path {
    return [
        {type: 'key', key: 'notes'},
        {type: 'key', key: id},
    ];
}

export function noteFieldPath(id: string, field: keyof RichNote): Path {
    return [...notePath(id), {type: 'key', key: field}];
}

export function noteTitle(note: RichNote) {
    return titleFromPlainText(materializeRichTextValue(note.body).plainText);
}

export function titleFromPlainText(text: string) {
    const firstLine = text.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
    return firstLine || 'Untitled';
}

export function noteListItems(state: RichNotesState, archived: boolean): NoteListItem[] {
    return Object.values(state.notes)
        .filter((note) => note.archived === archived)
        .map((note) => ({
            id: note.id,
            title: noteTitle(note),
            updatedAt: note.updatedAt,
            archived: note.archived,
        }))
        .sort(byUpdatedDescThenTitle);
}

export function byUpdatedDescThenTitle(a: NoteListItem, b: NoteListItem) {
    return (
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    );
}
