import {describe, expect, it} from 'vitest';
import {createStatusStore, type EphemeralMessage} from 'umkehr/react-crdt';
import {whiteboardSelectionStatusKind} from '../server/presence';
import {__localDemoSyncTest} from './useLocalDemoSync';
import {createDemoTransport, type ReplicaId} from './model';

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

describe('local demo ephemeral transport', () => {
    type Data = {value: string};

    const message = (id: string): EphemeralMessage<Data> => ({
        id,
        actor: 'replica-a',
        kind: 'preview',
        path: [{type: 'key', key: 'elements'}],
        data: {value: id},
    });

    it('publishes and receives ephemeral messages between replicas', () => {
        const published: Array<{from: ReplicaId; messages: EphemeralMessage<unknown>[]}> = [];
        const replicaA = createDemoTransport(
            'replica-a',
            () => {},
            (from, messages) => published.push({from, messages}),
        );
        const replicaB = createDemoTransport(
            'replica-b',
            () => {},
            () => {},
        );
        const received: EphemeralMessage<Data>[] = [];

        replicaB.subscribeEphemeral<Data>((next) => received.push(next));
        replicaA.publishEphemeral([message('one')]);
        __localDemoSyncTest.deliverTransportEphemeral(
            {'replica-a': replicaA, 'replica-b': replicaB},
            published[0].from,
            published[0].messages,
        );

        expect(published).toEqual([{from: 'replica-a', messages: [message('one')]}]);
        expect(received).toEqual([message('one')]);
    });

    it('drops ephemeral messages while sync is disabled', () => {
        const delivered: Array<{from: ReplicaId; messages: EphemeralMessage<unknown>[]}> = [];

        __localDemoSyncTest.broadcastTransportEphemeral(
            {syncEnabled: false, outbox: {'replica-a': [], 'replica-b': []}},
            (from, messages) => delivered.push({from, messages}),
            'replica-a',
            [message('offline')],
        );

        expect(delivered).toEqual([]);
    });

    it('does not replay ephemeral messages when sync is re-enabled', () => {
        const delivered: Array<{from: ReplicaId; messages: EphemeralMessage<unknown>[]}> = [];
        const deliver = (from: ReplicaId, messages: EphemeralMessage<unknown>[]) => {
            delivered.push({from, messages});
        };

        __localDemoSyncTest.broadcastTransportEphemeral(
            {syncEnabled: false, outbox: {'replica-a': [], 'replica-b': []}},
            deliver,
            'replica-a',
            [message('offline')],
        );
        __localDemoSyncTest.broadcastTransportEphemeral(
            {syncEnabled: true, outbox: {'replica-a': [], 'replica-b': []}},
            deliver,
            'replica-a',
            [message('online')],
        );

        expect(delivered).toEqual([{from: 'replica-a', messages: [message('online')]}]);
    });
});
