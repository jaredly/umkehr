import type {Path} from 'umkehr';
import type {Status} from 'umkehr/react-crdt';
import type {
    ServerLastEditStatusData,
    ServerPresenceSession,
    ServerPresenceUser,
} from './types';

const presenceColors = [
    '#2563eb',
    '#16a34a',
    '#dc2626',
    '#9333ea',
    '#c2410c',
    '#0891b2',
    '#be123c',
    '#4f46e5',
] as const;

export const lastEditStatusKind = 'presence:last-edit';

export function colorForUserId(userId: string) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash * 31 + userId.charCodeAt(i)) | 0;
    }
    return presenceColors[Math.abs(hash) % presenceColors.length];
}

export function initialForNickname(nickname: string) {
    return nickname.trim().charAt(0).toLocaleUpperCase() || '?';
}

export function upsertPresenceUser(
    users: ServerPresenceUser[],
    next: ServerPresenceUser,
    localActor: string,
) {
    const sanitized = sanitizePresenceUser(next, localActor);
    const filtered = users.filter((user) => user.userId !== next.userId);
    return sanitized ? sortPresenceUsers([...filtered, sanitized]) : sortPresenceUsers(filtered);
}

export function removePresenceSession(
    users: ServerPresenceUser[],
    actor: string,
): ServerPresenceUser[] {
    return users
        .map((user) => ({
            ...user,
            sessions: user.sessions.filter((session) => session.actor !== actor),
        }))
        .filter((user) => user.sessions.length > 0);
}

export function sanitizePresenceUsers(users: ServerPresenceUser[], localActor: string) {
    return sortPresenceUsers(
        users
            .map((user) => sanitizePresenceUser(user, localActor))
            .filter((user): user is ServerPresenceUser => user !== null),
    );
}

export function presenceSessionForActor(users: ServerPresenceUser[], actor: string) {
    for (const user of users) {
        const session = user.sessions.find((candidate) => candidate.actor === actor);
        if (session) return session;
    }
    return null;
}

export function collapsePathToTodoRow(path: Path): Path | null {
    const [root, index] = path;
    if (!root || root.type !== 'key' || root.key !== 'todos') return null;
    if (!index || index.type !== 'key' || typeof index.key !== 'number') return null;
    return [root, index];
}

export function statusForLastEdit({
    path,
    session,
    timestamp,
    receivedAt,
}: {
    path: Path;
    session: ServerPresenceSession;
    timestamp: string;
    receivedAt: string;
}): Status {
    const data: ServerLastEditStatusData = {
        actor: session.actor,
        userId: session.userId,
        sessionId: session.sessionId,
        nickname: session.nickname,
        color: session.color,
        timestamp,
        receivedAt,
    };
    return {
        id: lastEditStatusId(session.actor),
        path,
        kind: lastEditStatusKind,
        data,
    };
}

export function lastEditStatusId(actor: string) {
    return `${lastEditStatusKind}:${actor}`;
}

function sanitizePresenceUser(user: ServerPresenceUser, localActor: string) {
    const sessions = user.sessions.filter((session) => session.actor !== localActor);
    if (!sessions.length) return null;
    return {...user, sessions};
}

function sortPresenceUsers(users: ServerPresenceUser[]) {
    return [...users].sort((a, b) =>
        a.nickname.localeCompare(b.nickname, undefined, {sensitivity: 'base'}),
    );
}
