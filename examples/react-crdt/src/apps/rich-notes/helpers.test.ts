import {describe, expect, it} from 'vitest';
import {richText} from 'umkehr/richtext';
import {
    byUpdatedDescThenTitle,
    noteListItems,
    titleFromPlainText,
    type NoteListItem,
} from './helpers';
import type {RichNotesState} from './model';

describe('rich notes helpers', () => {
    it('derives a title from the first non-empty rich text line', () => {
        expect(titleFromPlainText('  Project plan\nsecond line')).toBe('Project plan');
        expect(titleFromPlainText('\n\n')).toBe('Untitled');
    });

    it('sorts note list items by updated time, title, and id', () => {
        const items: NoteListItem[] = [
            {id: 'b', title: 'Beta', updatedAt: '2026-01-01T00:00:00.000Z', archived: false},
            {id: 'a', title: 'Alpha', updatedAt: '2026-01-02T00:00:00.000Z', archived: false},
            {id: 'c', title: 'Alpha', updatedAt: '2026-01-02T00:00:00.000Z', archived: false},
        ];

        expect([...items].sort(byUpdatedDescThenTitle).map((item) => item.id)).toEqual([
            'a',
            'c',
            'b',
        ]);
    });

    it('filters archived notes', () => {
        const state: RichNotesState = {
            notes: {
                active: {
                    id: 'active',
                    body: richText(),
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-02T00:00:00.000Z',
                    archived: false,
                },
                archived: {
                    id: 'archived',
                    body: richText(),
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-03T00:00:00.000Z',
                    archived: true,
                },
            },
        };

        expect(noteListItems(state, false).map((item) => item.id)).toEqual(['active']);
        expect(noteListItems(state, true).map((item) => item.id)).toEqual(['archived']);
    });
});
