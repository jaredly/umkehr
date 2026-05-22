import {describe, expect, it} from 'vitest';
import {generateSeedDatabasePayload} from './generate';

describe('seed database generator', () => {
    it('emits the expected seeded documents and users', () => {
        const payload = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});

        expect(payload.users.map((user) => user.userId)).toEqual([
            'seed-user-ada',
            'seed-user-ben',
            'seed-user-cy',
            'seed-user-dee',
        ]);
        expect(payload.documents.map((document) => document.docId)).toEqual([
            'todos-small',
            'todos-many-items',
            'todos-many-events',
            'todos-branches',
            'todos-merge-review',
            'whiteboard-many-elements',
            'whiteboard-branches',
        ]);
    });

    it('is deterministic when a date is provided', () => {
        const first = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const second = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});

        expect(second).toEqual(first);
    });

    it('scales stress fixtures by size', () => {
        const small = generateSeedDatabasePayload({date: '2026-01-02', size: 'small'});
        const large = generateSeedDatabasePayload({date: '2026-01-02', size: 'large'});
        const smallManyEvents = small.documents.find((document) => document.docId === 'todos-many-events');
        const largeManyEvents = large.documents.find((document) => document.docId === 'todos-many-events');

        expect(smallManyEvents?.events.length).toBe(200);
        expect(largeManyEvents?.events.length).toBe(5000);
    });
});
