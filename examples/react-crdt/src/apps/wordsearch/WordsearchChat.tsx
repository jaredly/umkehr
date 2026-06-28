import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type CSSProperties,
} from 'react';
import type {EphemeralRecord} from 'umkehr/react-crdt';
import type {AppEditorContext} from '../../lib/crdtApp';
import type {PeerConnectionInfo} from '../../lib/peerjs/types';
import {colorForUserId} from '../../lib/server/presence';
import {
    chatMessage,
    chatRootPath,
    WORDSEARCH_CHAT_MAX_LENGTH,
    wordsearchChatKind,
    type WordsearchEphemeralData,
    type WordsearchChatEvent,
    type WordsearchState,
} from './model';

const MAX_VISIBLE_CHAT_MESSAGES = 50;
const animalNames = [
    'Badger',
    'Bison',
    'Dolphin',
    'Falcon',
    'Finch',
    'Fox',
    'Heron',
    'Lynx',
    'Marten',
    'Otter',
    'Panda',
    'Puma',
    'Raven',
    'Seal',
    'Swan',
    'Turtle',
];

export type ChatMessageView = {
    id: string;
    actor: string;
    text: string;
    sentAt: string;
    local: boolean;
    system?: boolean;
};

export type ChatConnectionState = {
    actor?: string;
    open: boolean;
    joined: boolean;
};

export function WordsearchChat({
    editor,
    actor,
    disabled,
    connections,
}: {
    editor: AppEditorContext<WordsearchState, 'type', WordsearchEphemeralData>;
    actor: string;
    disabled: boolean;
    connections: PeerConnectionInfo[];
}) {
    const [draft, setDraft] = useState('');
    const [localMessages, setLocalMessages] = useState<ChatMessageView[]>([]);
    const connectionStatesRef = useRef(new Map<string, ChatConnectionState>());
    const remoteRecords = editor.useEphemeral({
        path: chatRootPath(),
        kinds: [wordsearchChatKind],
    });
    const messages = useMemo(
        () => mergeChatMessages({actor, localMessages, remoteRecords}),
        [actor, localMessages, remoteRecords],
    );

    const trimmed = draft.trim();
    const canSend = !disabled && trimmed.length > 0;

    useEffect(() => {
        const {messages: systemMessages, next} = chatSystemMessagesForConnections({
            previous: connectionStatesRef.current,
            connections,
            sentAt: new Date().toISOString(),
        });
        connectionStatesRef.current = next;
        if (!systemMessages.length) return;
        setLocalMessages((current) =>
            [...current, ...systemMessages].slice(-MAX_VISIBLE_CHAT_MESSAGES),
        );
    }, [connections]);

    const sendMessage = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!canSend) return;
        const text = trimmed.slice(0, WORDSEARCH_CHAT_MAX_LENGTH);
        const sentAt = new Date().toISOString();
        const id = `${wordsearchChatKind}:${actor}:${crypto.randomUUID()}`;
        const next: ChatMessageView = {id, actor, text, sentAt, local: true};
        setLocalMessages((current) => [...current, next].slice(-MAX_VISIBLE_CHAT_MESSAGES));
        editor.publishEphemeral([chatMessage({actor, id, text, sentAt})]);
        setDraft('');
    };

    return (
        <section className={`wordsearchChat ${disabled ? 'disabled' : ''}`} aria-label="Chat">
            <div className="wordsearchChatLog" aria-live="polite">
                {messages.length ? (
                    messages.map((message) => (
                        <ChatMessage key={message.id} message={message} />
                    ))
                ) : (
                    <p className="wordsearchChatEmpty">No messages yet</p>
                )}
            </div>
            <form className="wordsearchChatComposer" onSubmit={sendMessage}>
                <span className="wordsearchChatSelf" title={`You are ${animalNameForActor(actor)}`}>
                    {animalNameForActor(actor)}
                </span>
                <input
                    value={draft}
                    maxLength={WORDSEARCH_CHAT_MAX_LENGTH}
                    placeholder={disabled ? 'Connect to chat' : 'Message'}
                    aria-label="Chat message"
                    disabled={disabled}
                    onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" disabled={!canSend}>
                    Send
                </button>
            </form>
        </section>
    );
}

function ChatMessage({message}: {message: ChatMessageView}) {
    if (message.system) {
        return (
            <div className="wordsearchChatSystem">
                <p>{message.text}</p>
            </div>
        );
    }

    return (
        <div className={`wordsearchChatMessage ${message.local ? 'local' : ''}`}>
            <span
                className="wordsearchChatAvatar"
                style={{'--wordsearch-chat-color': colorForUserId(message.actor)} as CSSProperties}
                aria-hidden="true"
            />
            <div>
                <strong>{animalNameForActor(message.actor)}</strong>
                <p>{message.text}</p>
            </div>
        </div>
    );
}

export function animalNameForActor(actor: string) {
    const index = hashString(actor) % animalNames.length;
    const suffix = actor.replace(/[^a-zA-Z0-9]/g, '').slice(-2).toUpperCase() || '00';
    return `${animalNames[index]} ${suffix}`;
}

export function mergeChatMessages({
    actor,
    localMessages,
    remoteRecords,
}: {
    actor: string;
    localMessages: ChatMessageView[];
    remoteRecords: EphemeralRecord<WordsearchEphemeralData>[];
}) {
    const byId = new Map<string, ChatMessageView>();
    for (const message of localMessages) byId.set(message.id, message);
    for (const record of remoteRecords) {
        if (record.message.actor === actor) continue;
        const data = record.message.data;
        if (!isChatData(data)) continue;
        byId.set(record.message.id, {
            id: record.message.id,
            actor: record.message.actor,
            text: data.text,
            sentAt: data.sentAt,
            local: false,
        });
    }
    return [...byId.values()]
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id))
        .slice(-MAX_VISIBLE_CHAT_MESSAGES);
}

export function chatSystemMessagesForConnections({
    previous,
    connections,
    sentAt,
}: {
    previous: Map<string, ChatConnectionState>;
    connections: Array<Pick<PeerConnectionInfo, 'peerId' | 'actor' | 'open'>>;
    sentAt: string;
}) {
    const next = new Map(previous);
    const messages: ChatMessageView[] = [];
    const activePeerIds = new Set(connections.map((connection) => connection.peerId));

    for (const connection of connections) {
        if (!connection.actor) continue;
        const before = next.get(connection.peerId);
        const displayName = animalNameForActor(connection.actor);
        if (!before?.joined) {
            messages.push(
                systemMessage(
                    connection.peerId,
                    connection.actor,
                    'joined',
                    sentAt,
                    `${displayName} joined the chat`,
                ),
            );
        }
        if (!before || before.open !== connection.open) {
            const status = connection.open ? 'connected' : 'disconnected';
            messages.push(
                systemMessage(
                    connection.peerId,
                    connection.actor,
                    status,
                    sentAt,
                    `[${status}] ${displayName}`,
                ),
            );
        }
        next.set(connection.peerId, {
            actor: connection.actor,
            open: connection.open,
            joined: true,
        });
    }

    for (const [peerId, before] of next) {
        if (activePeerIds.has(peerId) || !before.actor || !before.open) continue;
        const displayName = animalNameForActor(before.actor);
        messages.push(
            systemMessage(
                peerId,
                before.actor,
                'disconnected',
                sentAt,
                `[disconnected] ${displayName}`,
            ),
        );
        next.set(peerId, {...before, open: false});
    }

    return {messages, next};
}

function systemMessage(
    peerId: string,
    actor: string,
    event: 'joined' | 'connected' | 'disconnected',
    sentAt: string,
    text: string,
): ChatMessageView {
    return {
        id: `wordsearch:chat-system:${peerId}:${event}:${sentAt}`,
        actor,
        text,
        sentAt,
        local: false,
        system: true,
    };
}

function isChatData(data: WordsearchEphemeralData): data is WordsearchChatEvent {
    return data.type === 'chat';
}

function hashString(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
}
