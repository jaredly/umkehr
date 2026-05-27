export function actorForSession(userId: string, sessionId: string) {
    return `${userId}:${sessionId}`;
}

export function parseSessionActor(actor: string): {userId: string; sessionId: string} | null {
    const parts = actor.split(':');
    if (parts.length !== 2) return null;
    const [userId, sessionId] = parts;
    if (!userId || !sessionId) return null;
    return {userId, sessionId};
}

export function ensureServerSessionId() {
    const url = new URL(window.location.href);
    const existing = url.searchParams.get('session')?.trim();
    if (existing) return existing;

    const sessionId = `session-${crypto.randomUUID()}`;
    url.searchParams.set('session', sessionId);
    window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
    );
    return sessionId;
}
