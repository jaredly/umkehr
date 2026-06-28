import {describe, expect, it} from 'vitest';
import {chatRootPath, wordsearchChatKind, type WordsearchEphemeralData} from './model';
import {
    animalNameForActor,
    chatSystemMessagesForConnections,
    mergeChatMessages,
    type ChatMessageView,
} from './WordsearchChat';

function remoteRecord({
    id,
    actor,
    text,
    sentAt,
}: {
    id: string;
    actor: string;
    text: string;
    sentAt: string;
}) {
    return {
        message: {
            kind: wordsearchChatKind,
            id,
            actor,
            path: chatRootPath(),
            data: {type: 'chat', text, sentAt},
        },
    } as never;
}

describe('wordsearch chat helpers', () => {
    it('merges local and remote messages in timestamp order', () => {
        const localMessages: ChatMessageView[] = [
            {
                id: 'wordsearch:chat:host-1234:two',
                actor: 'host-1234',
                text: 'Second',
                sentAt: '2026-06-27T12:02:00.000Z',
                local: true,
            },
        ];

        const messages = mergeChatMessages({
            actor: 'host-1234',
            localMessages,
            remoteRecords: [
                remoteRecord({
                    id: 'wordsearch:chat:client-99:one',
                    actor: 'client-99',
                    text: 'First',
                    sentAt: '2026-06-27T12:01:00.000Z',
                }),
            ],
        });

        expect(messages.map((message) => message.text)).toEqual(['First', 'Second']);
    });

    it('filters remote messages from the local actor to avoid duplicate echo', () => {
        const messages = mergeChatMessages({
            actor: 'host-1234',
            localMessages: [],
            remoteRecords: [
                remoteRecord({
                    id: 'wordsearch:chat:host-1234:one',
                    actor: 'host-1234',
                    text: 'duplicate self echo',
                    sentAt: '2026-06-27T12:00:00.000Z',
                }),
            ],
        });

        expect(messages).toEqual([]);
    });

    it('ignores non-chat ephemeral records', () => {
        const messages = mergeChatMessages({
            actor: 'host-1234',
            localMessages: [],
            remoteRecords: [
                {
                    message: {
                        kind: wordsearchChatKind,
                        id: 'wordsearch:selection:client-99',
                        actor: 'client-99',
                        path: chatRootPath(),
                        data: {
                            type: 'selection',
                            start: {x: 0, y: 0},
                            end: {x: 0, y: 0},
                            cells: [],
                        } satisfies WordsearchEphemeralData,
                    },
                } as never,
            ],
        });

        expect(messages).toEqual([]);
    });

    it('derives deterministic animal names from actor ids', () => {
        expect(animalNameForActor('client-99')).toBe(animalNameForActor('client-99'));
        expect(animalNameForActor('client-99')).toMatch(/^[A-Za-z]+ [A-Z0-9]{2}$/);
    });

    it('creates joined and connected messages when an actor first appears', () => {
        const actor = 'client-99';
        const {messages, next} = chatSystemMessagesForConnections({
            previous: new Map(),
            connections: [{peerId: 'peer-one', actor, open: true}],
            sentAt: '2026-06-27T12:00:00.000Z',
        });

        expect(messages.map((message) => message.text)).toEqual([
            `${animalNameForActor(actor)} joined the chat`,
            `[connected] ${animalNameForActor(actor)}`,
        ]);
        expect(next.get('peer-one')).toEqual({actor, open: true, joined: true});
    });

    it('creates disconnected messages when an open peer closes or disappears', () => {
        const actor = 'client-99';
        const previous = new Map([
            ['peer-one', {actor, open: true, joined: true}],
        ]);

        const closed = chatSystemMessagesForConnections({
            previous,
            connections: [{peerId: 'peer-one', actor, open: false}],
            sentAt: '2026-06-27T12:01:00.000Z',
        });
        expect(closed.messages.map((message) => message.text)).toEqual([
            `[disconnected] ${animalNameForActor(actor)}`,
        ]);

        const disappeared = chatSystemMessagesForConnections({
            previous,
            connections: [],
            sentAt: '2026-06-27T12:02:00.000Z',
        });
        expect(disappeared.messages.map((message) => message.text)).toEqual([
            `[disconnected] ${animalNameForActor(actor)}`,
        ]);
    });
});
