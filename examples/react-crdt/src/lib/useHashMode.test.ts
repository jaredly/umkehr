import {describe, expect, it} from 'vitest';
import {hashForSelection, readHashSelectionFromHash} from './useHashMode';

describe('hash app selection', () => {
    it('keeps old mode-only hashes working', () => {
        expect(readHashSelectionFromHash('#server', 'todos')).toEqual({
            mode: 'server',
            appId: 'todos',
        });
    });

    it('parses mode and app query hash values', () => {
        expect(readHashSelectionFromHash('#mode=solo&app=whiteboard', 'todos')).toEqual({
            mode: 'solo',
            appId: 'whiteboard',
        });
    });

    it('omits defaults when serializing', () => {
        expect(hashForSelection({mode: 'local', appId: 'todos'}, 'todos')).toBe('');
        expect(hashForSelection({mode: 'server', appId: 'todos'}, 'todos')).toBe('#mode=server');
        expect(hashForSelection({mode: 'local', appId: 'whiteboard'}, 'todos')).toBe(
            '#app=whiteboard',
        );
    });
});
