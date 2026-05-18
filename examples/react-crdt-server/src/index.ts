import {
    SERVER_PROTOCOL_VERSION,
    encodeServerMessage,
    parseClientMessage,
    parseSessionActor,
} from './protocol';
import {ServerStore} from './store';
import type {ConnectedClient, ServerLogEntry} from './types';

export const PORT = 8787;

const store = new ServerStore();
const clients = new Set<ServerWebSocket>();

const server = Bun.serve<ClientData>({
    port: PORT,
    async fetch(request, server) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') {
            return new Response(null, {headers: corsHeaders()});
        }
        if (url.pathname === '/health') {
            return json({ok: true, port: PORT});
        }
        if (url.pathname === '/users' && request.method === 'GET') {
            return json({users: store.listUsers()});
        }
        if (url.pathname === '/users/login' && request.method === 'POST') {
            try {
                const body = await safeJsonRequest(request);
                if (!isRecord(body) || typeof body.nickname !== 'string') {
                    return json({error: 'Nickname is required.'}, 400);
                }
                return json({user: store.loginUser(body.nickname)});
            } catch (error) {
                return json({error: error instanceof Error ? error.message : String(error)}, 400);
            }
        }
        if (url.pathname === '/debug') {
            return new Response(debugHtml(), {
                headers: {
                    ...corsHeaders(),
                    'content-type': 'text/html; charset=utf-8',
                },
            });
        }
        if (url.pathname === '/sync') {
            if (server.upgrade(request, {data: {}})) return undefined;
            return new Response('WebSocket upgrade failed', {status: 400});
        }
        return new Response('Not found', {status: 404});
    },
    websocket: {
        open(ws) {
            clients.add(ws);
        },
        message(ws, raw) {
            const parsed = parseClientMessage(safeJsonParse(raw));
            if (!parsed) {
                send(ws, {
                    kind: 'error',
                    version: SERVER_PROTOCOL_VERSION,
                    message: 'Invalid message.',
                });
                return;
            }

            try {
                const actor = parseSessionActor(parsed.actor);
                if (!actor) {
                    send(ws, {
                        kind: 'error',
                        version: SERVER_PROTOCOL_VERSION,
                        message: 'Invalid actor.',
                    });
                    return;
                }
                if (ws.data.sessionId === undefined && hasDuplicateSession(ws, actor.sessionId)) {
                    send(ws, {
                        kind: 'error',
                        version: SERVER_PROTOCOL_VERSION,
                        message: 'Session is already connected.',
                    });
                    ws.close();
                    return;
                }
                store.ensureDocument(parsed.docId, parsed.schemaFingerprint);
                ws.data.actor = parsed.actor;
                ws.data.userId = parsed.userId;
                ws.data.sessionId = actor.sessionId;
                ws.data.docId = parsed.docId;
                ws.data.schemaFingerprint = parsed.schemaFingerprint;

                if (parsed.kind === 'hello') {
                    send(ws, {
                        kind: 'hello',
                        version: SERVER_PROTOCOL_VERSION,
                        docId: parsed.docId,
                        lastSeenMessageIndex: parsed.lastSeenMessageIndex,
                    });
                    sendUpdatesAfter(ws, parsed.lastSeenMessageIndex);
                    return;
                }

                if (parsed.kind === 'syncRequest') {
                    sendUpdatesAfter(ws, parsed.lastSeenMessageIndex);
                    return;
                }

                const entry = store.appendUpdate({
                    docId: parsed.docId,
                    schemaFingerprint: parsed.schemaFingerprint,
                    origin: parsed.actor,
                    hlcTimestamp: parsed.hlcTimestamp,
                    update: parsed.update,
                });
                send(ws, {
                    kind: 'ack',
                    version: SERVER_PROTOCOL_VERSION,
                    docId: parsed.docId,
                    hlcTimestamp: parsed.hlcTimestamp,
                });
                broadcast(entry, parsed.actor);
            } catch (error) {
                send(ws, {
                    kind: 'error',
                    version: SERVER_PROTOCOL_VERSION,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        },
        close(ws) {
            clients.delete(ws);
        },
    },
});

console.log(`react-crdt server sync listening on http://localhost:${server.port}`);

type ClientData = {
    actor?: string;
    userId?: string;
    sessionId?: string;
    docId?: string;
    schemaFingerprint?: string;
};

type ServerWebSocket = Bun.ServerWebSocket<ClientData>;

function send(ws: ServerWebSocket, message: Parameters<typeof encodeServerMessage>[0]) {
    ws.send(encodeServerMessage(message));
}

function hasDuplicateSession(ws: ServerWebSocket, sessionId: string) {
    for (const client of clients) {
        if (client === ws) continue;
        if (client.data.sessionId === sessionId) return true;
    }
    return false;
}

function sendUpdatesAfter(ws: ServerWebSocket, lastSeenMessageIndex: number) {
    if (!ws.data.docId) return;
    const entries = store.listAfter(ws.data.docId, lastSeenMessageIndex, ws.data.actor);
    send(ws, {
        kind: 'serverUpdates',
        version: SERVER_PROTOCOL_VERSION,
        docId: ws.data.docId,
        entries,
    });
}

function broadcast(entry: ServerLogEntry, origin: string) {
    for (const client of clients) {
        if (client.data.docId !== entry.docId) continue;
        if (client.data.actor === origin) continue;
        send(client, {
            kind: 'serverUpdates',
            version: SERVER_PROTOCOL_VERSION,
            docId: entry.docId,
            entries: [entry],
        });
    }
}

function debugHtml() {
    const documents = store.summarizeDocuments();
    const users = store.listUsers();
    const messages = store.recentMessages(100);
    const connected: ConnectedClient[] = [...clients].map((client) => ({
        actor: client.data.actor,
        userId: client.data.userId,
        sessionId: client.data.sessionId,
        docId: client.data.docId,
    }));
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>React CRDT Server Debug</title>
  <style>
    body { margin: 24px; color: #17202a; font-family: system-ui, sans-serif; background: #eef2f6; }
    section { margin-bottom: 24px; border: 1px solid #d4dde7; border-radius: 8px; padding: 16px; background: #fff; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e1e8f0; padding: 8px; text-align: left; vertical-align: top; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>React CRDT Server Debug</h1>
  <section>
    <h2>Users</h2>
    ${table(
        ['User', 'Nickname'],
        users.map((user) => [user.userId, user.nickname]),
    )}
  </section>
  <section>
    <h2>Documents</h2>
    ${table(
        ['Doc', 'Fingerprint', 'Next index', 'Messages'],
        documents.map((doc) => [
            doc.docId,
            doc.schemaFingerprint,
            String(doc.nextMessageIndex),
            String(doc.messageCount),
        ]),
    )}
  </section>
  <section>
    <h2>Connected clients</h2>
    ${table(
        ['User', 'Session', 'Actor', 'Doc'],
        connected.map((client) => [
            client.userId ?? '',
            client.sessionId ?? '',
            client.actor ?? '',
            client.docId ?? '',
        ]),
    )}
  </section>
  <section>
    <h2>Recent messages</h2>
    ${table(
        ['Doc', 'Index', 'User', 'Session', 'Origin', 'Timestamp', 'Received'],
        messages.map((message) => {
            const actor = parseSessionActor(message.origin);
            return [
                message.docId,
                String(message.messageIndex),
                actor?.userId ?? '',
                actor?.sessionId ?? '',
                message.origin,
                message.hlcTimestamp,
                message.receivedAt,
            ];
        }),
    )}
  </section>
</body>
</html>`;
}

function table(headers: string[], rows: string[][]) {
    if (!rows.length) return '<p>None.</p>';
    return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows
        .map(
            (row) =>
                `<tr>${row.map((cell) => `<td><code>${escapeHtml(cell)}</code></td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table>`;
}

function json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: {
            ...corsHeaders(),
            'content-type': 'application/json',
        },
    });
}

function corsHeaders() {
    return {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
    };
}

async function safeJsonRequest(request: Request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function safeJsonParse(input: string | Buffer) {
    try {
        return JSON.parse(typeof input === 'string' ? input : input.toString());
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeHtml(input: string) {
    return input
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
