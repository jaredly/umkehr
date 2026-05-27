import {
    hlc,
    type CrdtMeta,
    type HlcTimestamp,
} from 'umkehr/crdt';
import {parseSessionActor} from '../../lib/server/session';
import type {ServerPresenceUser} from '../../lib/server/types';

export type TodoTitleBlame = {
    actor: string;
    userId?: string;
    sessionId?: string;
    nickname?: string;
    timestamp: HlcTimestamp;
};

export function titleBlameForTodoMeta(
    meta: CrdtMeta | undefined,
    users: ServerPresenceUser[] = [],
): TodoTitleBlame | null {
    if (meta?.kind !== 'primitive') return null;
    const actor = hlc.unpack(meta.ts).node;
    const parsed = parseSessionActor(actor);
    return {
        actor,
        userId: parsed?.userId,
        sessionId: parsed?.sessionId,
        nickname: parsed ? nicknameForUser(users, parsed.userId) : undefined,
        timestamp: meta.ts,
    };
}

export function formatTodoTitleBlame(blame: TodoTitleBlame | null) {
    if (!blame) return undefined;
    const who = blame.nickname ?? blame.userId ?? blame.actor;
    return `Title last edited by ${who} at ${blame.timestamp}`;
}

function nicknameForUser(users: ServerPresenceUser[], userId: string) {
    return users.find((user) => user.userId === userId)?.nickname;
}
