import {describe, expect, it} from 'vitest';
import {createStatusStore} from 'umkehr/react-crdt';
import {whiteboardSelectionStatusKind} from '../server/presence';
import {__localDemoSyncTest} from './useLocalDemoSync';

const elementPath = (id: string) => [
    {type: 'key' as const, key: 'elements'},
    {type: 'key' as const, key: id},
];

describe('local demo selection presence', () => {
    it('broadcasts selected whiteboard element to the other replica', () => {
        const statusStores = {
            'replica-a': createStatusStore(),
            'replica-b': createStatusStore(),
        };

        __localDemoSyncTest.broadcastPresenceSelection(statusStores, 'replica-a', 'note-1');

        expect(
            statusStores['replica-b'].get(elementPath('note-1'), {
                kinds: [whiteboardSelectionStatusKind],
            }),
        ).toHaveLength(1);
        expect(statusStores['replica-a'].get(elementPath('note-1'))).toHaveLength(0);
    });

    it('clears previous selection when selection is cleared', () => {
        const statusStores = {
            'replica-a': createStatusStore(),
            'replica-b': createStatusStore(),
        };

        __localDemoSyncTest.broadcastPresenceSelection(statusStores, 'replica-a', 'note-1');
        __localDemoSyncTest.broadcastPresenceSelection(statusStores, 'replica-a', null);

        expect(statusStores['replica-b'].get(elementPath('note-1'))).toHaveLength(0);
    });
});
