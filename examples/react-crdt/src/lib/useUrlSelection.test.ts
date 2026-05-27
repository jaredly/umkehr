import {describe, expect, it} from 'vitest';
import {readUrlSelectionFromSearch, urlForSelection} from './useUrlSelection';

describe('url selection', () => {
    it('parses app, mode, and doc from search params', () => {
        expect(
            readUrlSelectionFromSearch(
                '?mode=solo&app=todos%401&doc=todos-migration-v1-main',
                'todos',
            ),
        ).toEqual({
            mode: 'solo',
            appId: 'todos@1',
            docId: 'todos-migration-v1-main',
        });
    });

    it('falls back to defaults', () => {
        expect(readUrlSelectionFromSearch('?x=1', 'todos')).toEqual({
            mode: 'local',
            appId: 'todos',
        });
    });

    it('omits default app and mode when serializing', () => {
        expect(
            urlForSelection(
                'http://localhost:5173/?x=1',
                {mode: 'local', appId: 'todos'},
                'todos',
            ),
        ).toBe('/?x=1');
        expect(
            urlForSelection(
                'http://localhost:5173/?x=1',
                {mode: 'server', appId: 'todos'},
                'todos',
            ),
        ).toBe('/?x=1&mode=server');
        expect(
            urlForSelection(
                'http://localhost:5173/?x=1',
                {mode: 'local', appId: 'whiteboard'},
                'todos',
            ),
        ).toBe('/?x=1&app=whiteboard');
    });

    it('preserves unrelated params and clears hashes', () => {
        expect(
            urlForSelection(
                'http://localhost:5173/?peer=abc#mode=server',
                {
                    mode: 'peerjs',
                    appId: 'whiteboard',
                    docId: 'whiteboard-many-events',
                },
                'todos',
            ),
        ).toBe('/?peer=abc&mode=peerjs&app=whiteboard&doc=whiteboard-many-events');
    });
});
