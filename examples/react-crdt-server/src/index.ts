import {
    SERVER_PROTOCOL_VERSION,
    encodeServerMessage,
    parseClientMessage,
    parseSessionActor,
} from './protocol';
import {ServerStore} from './store';
import {databasePathFromArgs, migrationLockMsFromArgs, serverPortFromArgs} from './cli';
import type {
    ConnectedClient,
    ServerBranch,
    ServerBranchEvent,
    ServerMigrationLock,
    ServerPresenceSession,
    ServerPresenceUser,
} from './types';

const dbPath = databasePathFromArgs(Bun.argv);
const port = serverPortFromArgs(Bun.argv);
const migrationLockTtlMs = migrationLockMsFromArgs(Bun.argv);
const store = new ServerStore(dbPath, {migrationLockTtlMs});
const clients = new Set<ServerWebSocket>();

const server = Bun.serve<ClientData>({
    port,
    async fetch(request, server) {
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') return new Response(null, {headers: corsHeaders()});
        if (url.pathname === '/health') return json({ok: true, port: server.port});
        if (url.pathname === '/documents' && request.method === 'GET') {
            return json({documents: store.summarizeDocuments()});
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
                headers: {...corsHeaders(), 'content-type': 'text/html; charset=utf-8'},
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
                if (!actor) throw new Error('Invalid actor.');
                if (ws.data.sessionId === undefined && hasDuplicateSession(ws, actor.sessionId)) {
                    send(ws, {
                        kind: 'error',
                        version: SERVER_PROTOCOL_VERSION,
                        message: 'Session is already connected.',
                    });
                    ws.close();
                    return;
                }

                ws.data.actor = parsed.actor;
                ws.data.userId = parsed.userId;
                ws.data.sessionId = actor.sessionId;
                ws.data.docId = parsed.docId;
                const expiredLock = store.expireMigrationLock(parsed.docId);
                if (expiredLock)
                    broadcastMigrationCancelled(parsed.docId, 'Server migration lock expired.');

                switch (parsed.kind) {
                    case 'hello': {
                        ws.data.schemaVersion = parsed.schemaVersion;
                        ws.data.schemaFingerprint = parsed.schemaFingerprint;
                        ws.data.schemaFingerprintHash = parsed.schemaFingerprintHash;
                        const existing = store.getDocument(parsed.docId);
                        if (existing?.appId && existing.appId !== parsed.appId) {
                            send(ws, {
                                kind: 'error',
                                version: SERVER_PROTOCOL_VERSION,
                                message: 'Document belongs to another app.',
                            });
                            return;
                        }
                        if (
                            existing &&
                            existing.schemaFingerprintHash !== parsed.schemaFingerprintHash
                        ) {
                            const lock = store.activeMigrationLock(parsed.docId);
                            if (lock) {
                                send(ws, {
                                    kind: 'waitForMigration',
                                    version: SERVER_PROTOCOL_VERSION,
                                    docId: parsed.docId,
                                    ownerActor: lock.ownerActor,
                                    targetSchemaVersion: lock.targetSchemaVersion,
                                    targetSchemaFingerprintHash: lock.targetSchemaFingerprintHash,
                                });
                                return;
                            }
                            if (parsed.schemaVersion > existing.schemaVersion) {
                                send(ws, {
                                    kind: 'serverMigrationRequired',
                                    version: SERVER_PROTOCOL_VERSION,
                                    docId: parsed.docId,
                                    sourceSchemaVersion: existing.schemaVersion,
                                    sourceSchemaFingerprintHash: existing.schemaFingerprintHash,
                                    targetSchemaVersion: parsed.schemaVersion,
                                    targetSchemaFingerprintHash: parsed.schemaFingerprintHash,
                                });
                                return;
                            }
                            send(ws, {
                                kind:
                                    parsed.schemaVersion < existing.schemaVersion
                                        ? 'clientMigrationRequired'
                                        : 'schemaMismatch',
                                version: SERVER_PROTOCOL_VERSION,
                                docId: parsed.docId,
                                schemaVersion: existing.schemaVersion,
                                schemaFingerprintHash: existing.schemaFingerprintHash,
                            });
                            return;
                        }
                        if (!existing) {
                            send(ws, {
                                kind: 'unknownDocument',
                                version: SERVER_PROTOCOL_VERSION,
                                docId: parsed.docId,
                            });
                            return;
                        }
                        store.ensureDocument(
                            parsed.docId,
                            parsed.appId,
                            parsed.schemaVersion,
                            parsed.schemaFingerprint,
                            parsed.schemaFingerprintHash,
                        );
                        store.touchDocumentAccess(parsed.docId);
                        send(ws, {
                            kind: 'hello',
                            version: SERVER_PROTOCOL_VERSION,
                            docId: parsed.docId,
                            branches: store.listBranches(parsed.docId),
                            artifacts: store.getDocument(parsed.docId)?.artifacts,
                        });
                        return;
                    }
                    case 'serverMigrationRequest': {
                        const result = store.beginMigration({
                            docId: parsed.docId,
                            ownerActor: parsed.actor,
                            ownerUserId: parsed.userId,
                            ownerSessionId: actor.sessionId,
                            targetSchemaVersion: parsed.targetSchemaVersion,
                            targetSchemaFingerprint: parsed.targetSchemaFingerprint,
                            targetSchemaFingerprintHash: parsed.targetSchemaFingerprintHash,
                        });
                        if (result.kind === 'locked') {
                            sendWaitForMigration(ws, result.lock);
                            return;
                        }
                        send(ws, {
                            kind: 'serverMigrationDump',
                            version: SERVER_PROTOCOL_VERSION,
                            ...result.dump,
                        });
                        broadcastWaitForMigration(parsed.docId, result.lock, parsed.actor);
                        return;
                    }
                    case 'serverMigrationUpload': {
                        const completed = store.completeMigration({
                            ownerActor: parsed.actor,
                            upload: parsed,
                        });
                        send(ws, {
                            kind: 'serverMigrationComplete',
                            version: SERVER_PROTOCOL_VERSION,
                            docId: parsed.docId,
                            schemaVersion: completed.schemaVersion,
                            schemaFingerprintHash: completed.schemaFingerprintHash,
                        });
                        broadcastMigrationComplete(
                            parsed.docId,
                            completed.schemaVersion,
                            completed.schemaFingerprintHash,
                            parsed.actor,
                        );
                        return;
                    }
                    case 'serverDocumentImport': {
                        store.importDocument(parsed);
                        send(ws, {
                            kind: 'hello',
                            version: SERVER_PROTOCOL_VERSION,
                            docId: parsed.docId,
                            branches: store.listBranches(parsed.docId),
                            artifacts: store.getDocument(parsed.docId)?.artifacts,
                        });
                        broadcastBranchSnapshot(parsed.docId, parsed.actor);
                        return;
                    }
                    case 'presenceHello': {
                        const user = store.ensureUser({
                            userId: parsed.userId,
                            nickname: parsed.nickname,
                        });
                        ws.data.nickname = user.nickname;
                        ws.data.color = parsed.color;
                        ws.data.branchId = parsed.branchId;
                        ws.data.presenceReady = true;
                        send(ws, {
                            kind: 'presenceSnapshot',
                            version: SERVER_PROTOCOL_VERSION,
                            docId: parsed.docId,
                            users: presenceUsersForDoc(parsed.docId, parsed.actor),
                        });
                        broadcastPresenceUpdate(parsed.docId, parsed.actor, parsed.userId);
                        return;
                    }
                    case 'presenceSelection': {
                        ws.data.branchId = parsed.branchId;
                        ws.data.selectionElementId = parsed.elementId ?? undefined;
                        broadcastPresenceSelection(parsed);
                        broadcastPresenceUpdate(parsed.docId, parsed.actor, parsed.userId);
                        return;
                    }
                    case 'presenceEvent': {
                        if (!ws.data.presenceReady) throw new Error('Presence is not ready.');
                        if (ws.data.branchId !== parsed.branchId) {
                            throw new Error(
                                'Presence event branch does not match current session branch.',
                            );
                        }
                        broadcastPresenceEvent(parsed);
                        return;
                    }
                    case 'branchSubscribe': {
                        if (rejectLockedWrite(ws, parsed.docId, parsed.actor)) return;
                        ws.data.branchId = parsed.branchId;
                        sendEventsAfter(ws, parsed.branchId, parsed.lastSeenEventIndex);
                        broadcastPresenceUpdate(parsed.docId, parsed.actor, parsed.userId);
                        return;
                    }
                    case 'createBranch': {
                        if (rejectLockedWrite(ws, parsed.docId, parsed.actor)) return;
                        const branch = store.createBranch({
                            docId: parsed.docId,
                            branchId: parsed.branchId,
                            sourceBranchId: parsed.sourceBranchId,
                            forkEventIndex: parsed.forkEventIndex,
                            name: parsed.name,
                        });
                        send(ws, {
                            kind: 'ack',
                            version: SERVER_PROTOCOL_VERSION,
                            docId: parsed.docId,
                            branchId: branch.branchId,
                            branchIdCreated: branch.branchId,
                        });
                        broadcastBranchUpdate(parsed.docId, branch);
                        return;
                    }
                    case 'renameBranch': {
                        if (rejectLockedWrite(ws, parsed.docId, parsed.actor)) return;
                        const branch = store.renameBranch({
                            docId: parsed.docId,
                            branchId: parsed.branchId,
                            name: parsed.name,
                        });
                        broadcastBranchUpdate(parsed.docId, branch);
                        return;
                    }
                    case 'mergeBranch': {
                        if (rejectLockedWrite(ws, parsed.docId, parsed.actor)) return;
                        const event = store.appendMergeEvent({
                            docId: parsed.docId,
                            branchId: parsed.targetBranchId,
                            mergeId: parsed.mergeId,
                            actor: parsed.actor,
                            sourceBranchId: parsed.sourceBranchId,
                            sourceThroughEventIndex: parsed.sourceThroughEventIndex,
                        });
                        send(ws, {
                            kind: 'ack',
                            version: SERVER_PROTOCOL_VERSION,
                            docId: parsed.docId,
                            branchId: parsed.targetBranchId,
                            mergeId: parsed.mergeId,
                            eventIndex: event.eventIndex,
                        });
                        broadcastEvent(event, parsed.actor);
                        broadcastBranchUpdate(
                            parsed.docId,
                            branchFor(parsed.docId, parsed.targetBranchId),
                        );
                        return;
                    }
                    case 'clientUpdate': {
                        if (rejectLockedWrite(ws, parsed.docId, parsed.actor)) return;
                        store.ensureDocument(
                            parsed.docId,
                            parsed.appId,
                            parsed.schemaVersion,
                            parsed.schemaFingerprint,
                            parsed.schemaFingerprintHash,
                        );
                        const event = store.appendUpdateEvent({
                            docId: parsed.docId,
                            branchId: parsed.branchId,
                            origin: parsed.actor,
                            hlcTimestamp: parsed.hlcTimestamp,
                            update: parsed.update,
                        });
                        send(ws, {
                            kind: 'ack',
                            version: SERVER_PROTOCOL_VERSION,
                            docId: parsed.docId,
                            branchId: parsed.branchId,
                            hlcTimestamp: parsed.hlcTimestamp,
                            eventIndex: event.eventIndex,
                        });
                        broadcastEvent(event, parsed.actor);
                        broadcastBranchUpdate(
                            parsed.docId,
                            branchFor(parsed.docId, parsed.branchId),
                        );
                    }
                }
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
            if (
                ws.data.presenceReady &&
                ws.data.docId &&
                ws.data.actor &&
                ws.data.userId &&
                ws.data.sessionId
            ) {
                broadcastPresenceLeave(ws.data.docId, {
                    actor: ws.data.actor,
                    userId: ws.data.userId,
                    sessionId: ws.data.sessionId,
                });
            }
        },
    },
});

console.log(
    `react-crdt server sync listening on http://localhost:${server.port} using ${dbPath}`,
);
console.log(`react-crdt server sync database: ${dbPath}`);

type ClientData = {
    actor?: string;
    userId?: string;
    sessionId?: string;
    nickname?: string;
    color?: string;
    docId?: string;
    branchId?: string;
    selectionElementId?: string;
    schemaVersion?: number;
    schemaFingerprint?: string;
    schemaFingerprintHash?: string;
    presenceReady?: boolean;
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

function rejectLockedWrite(ws: ServerWebSocket, docId: string, actor: string) {
    const lock = store.activeMigrationLock(docId);
    if (!lock || lock.ownerActor === actor) return false;
    sendWaitForMigration(ws, lock);
    return true;
}

function sendWaitForMigration(ws: ServerWebSocket, lock: ServerMigrationLock) {
    send(ws, {
        kind: 'waitForMigration',
        version: SERVER_PROTOCOL_VERSION,
        docId: lock.docId,
        ownerActor: lock.ownerActor,
        targetSchemaVersion: lock.targetSchemaVersion,
        targetSchemaFingerprintHash: lock.targetSchemaFingerprintHash,
    });
}

function broadcastWaitForMigration(docId: string, lock: ServerMigrationLock, ownerActor: string) {
    for (const client of clients) {
        if (client.data.docId !== docId) continue;
        if (client.data.actor === ownerActor) continue;
        sendWaitForMigration(client, lock);
    }
}

function broadcastMigrationComplete(
    docId: string,
    schemaVersion: number,
    schemaFingerprintHash: string,
    ownerActor: string,
) {
    for (const client of clients) {
        if (client.data.docId !== docId) continue;
        if (client.data.actor === ownerActor) continue;
        send(client, {
            kind: 'clientMigrationRequired',
            version: SERVER_PROTOCOL_VERSION,
            docId,
            schemaVersion,
            schemaFingerprintHash,
        });
    }
}

function broadcastMigrationCancelled(docId: string, reason: string) {
    for (const client of clients) {
        if (client.data.docId !== docId) continue;
        send(client, {
            kind: 'migrationCancelled',
            version: SERVER_PROTOCOL_VERSION,
            docId,
            reason,
        });
    }
}

function sendEventsAfter(ws: ServerWebSocket, branchId: string, lastSeenEventIndex: number) {
    if (!ws.data.docId) return;
    send(ws, {
        kind: 'branchEvents',
        version: SERVER_PROTOCOL_VERSION,
        docId: ws.data.docId,
        branchId,
        events: store.listEventsAfter(ws.data.docId, branchId, lastSeenEventIndex),
    });
}

function broadcastEvent(event: ServerBranchEvent, origin: string) {
    for (const client of clients) {
        if (client.data.docId !== event.docId) continue;
        if (client.data.actor === origin) continue;
        if (client.data.branchId !== event.branchId) continue;
        send(client, {
            kind: 'branchEvents',
            version: SERVER_PROTOCOL_VERSION,
            docId: event.docId,
            branchId: event.branchId,
            events: [event],
        });
    }
}

function broadcastBranchUpdate(docId: string, branch: ServerBranch) {
    for (const client of clients) {
        if (client.data.docId !== docId) continue;
        send(client, {
            kind: 'branchUpdate',
            version: SERVER_PROTOCOL_VERSION,
            docId,
            branch,
        });
    }
}

function broadcastBranchSnapshot(docId: string, originActor: string) {
    const branches = store.listBranches(docId);
    const artifacts = store.getDocument(docId)?.artifacts;
    for (const client of clients) {
        if (client.data.docId !== docId) continue;
        if (client.data.actor === originActor) continue;
        send(client, {
            kind: 'branchSnapshot',
            version: SERVER_PROTOCOL_VERSION,
            docId,
            branches,
            artifacts,
        });
    }
}

function branchFor(docId: string, branchId: string) {
    const branch = store.listBranches(docId).find((candidate) => candidate.branchId === branchId);
    if (!branch) throw new Error('Branch does not exist.');
    return branch;
}

function presenceUsersForDoc(docId: string, excludeActor?: string): ServerPresenceUser[] {
    const byUser = new Map<string, ServerPresenceUser>();
    for (const client of clients) {
        const {actor, userId, sessionId, nickname, color, branchId, selectionElementId} =
            client.data;
        if (
            !client.data.presenceReady ||
            client.data.docId !== docId ||
            !actor ||
            !userId ||
            !sessionId ||
            !nickname ||
            !color ||
            actor === excludeActor
        ) {
            continue;
        }
        const session: ServerPresenceSession = {
            actor,
            userId,
            sessionId,
            nickname,
            color,
            online: true,
            lastSeenAt: new Date().toISOString(),
            branchId,
            selectionElementId,
        };
        const existing = byUser.get(userId);
        if (existing) existing.sessions.push(session);
        else byUser.set(userId, {userId, nickname, color, sessions: [session]});
    }
    return [...byUser.values()].sort((a, b) =>
        a.nickname.localeCompare(b.nickname, undefined, {sensitivity: 'base'}),
    );
}

function broadcastPresenceSelection(
    message: Extract<ReturnType<typeof parseClientMessage>, {kind: 'presenceSelection'}>,
) {
    if (!message) return;
    const actor = parseSessionActor(message.actor);
    if (!actor) return;
    const at = new Date().toISOString();
    for (const client of clients) {
        if (client.data.docId !== message.docId) continue;
        if (client.data.actor === message.actor) continue;
        if (!client.data.presenceReady) continue;
        if (client.data.branchId !== message.branchId) continue;
        send(client, {
            kind: 'presenceSelection',
            version: SERVER_PROTOCOL_VERSION,
            docId: message.docId,
            actor: message.actor,
            userId: message.userId,
            sessionId: actor.sessionId,
            branchId: message.branchId,
            elementId: message.elementId,
            at,
        });
    }
}

function broadcastPresenceEvent(
    message: Extract<ReturnType<typeof parseClientMessage>, {kind: 'presenceEvent'}>,
) {
    if (!message) return;
    for (const client of clients) {
        if (client.data.docId !== message.docId) continue;
        if (client.data.actor === message.actor) continue;
        if (!client.data.presenceReady) continue;
        if (client.data.branchId !== message.branchId) continue;
        send(client, {
            kind: 'presenceEvent',
            version: SERVER_PROTOCOL_VERSION,
            docId: message.docId,
            branchId: message.branchId,
            event: message.event,
        });
    }
}

function broadcastPresenceUpdate(docId: string, originActor: string, userId: string) {
    const [user] = presenceUsersForDoc(docId).filter((presence) => presence.userId === userId);
    if (!user) return;
    for (const client of clients) {
        if (client.data.docId !== docId) continue;
        if (client.data.actor === originActor) continue;
        if (!client.data.presenceReady) continue;
        send(client, {
            kind: 'presenceUpdate',
            version: SERVER_PROTOCOL_VERSION,
            docId,
            user,
        });
    }
}

function broadcastPresenceLeave(
    docId: string,
    leaving: {actor: string; userId: string; sessionId: string},
) {
    const at = new Date().toISOString();
    for (const client of clients) {
        if (client.data.docId !== docId) continue;
        if (!client.data.presenceReady) continue;
        send(client, {
            kind: 'presenceLeave',
            version: SERVER_PROTOCOL_VERSION,
            docId,
            actor: leaving.actor,
            userId: leaving.userId,
            sessionId: leaving.sessionId,
            at,
        });
    }
}

function debugHtml() {
    const documents = store.summarizeDocuments();
    const users = store.listUsers();
    const events = store.recentEvents(100);
    const connected: ConnectedClient[] = [...clients].map((client) => ({
        actor: client.data.actor,
        userId: client.data.userId,
        sessionId: client.data.sessionId,
        nickname: client.data.nickname,
        color: client.data.color,
        docId: client.data.docId,
        branchId: client.data.branchId,
        selectionElementId: client.data.selectionElementId,
        presenceReady: client.data.presenceReady,
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
        [
            'Doc',
            'Title',
            'Size',
            'Last accessed',
            'Active hash',
            'Archived hashes',
            'Migration lock',
            'Branches',
            'Events',
        ],
        documents.map((doc) => [
            doc.docId,
            doc.title,
            doc.sizeLabel,
            doc.lastAccessedAt,
            doc.schemaFingerprintHash,
            store.archivedSchemaHashes(doc.docId).join(', '),
            migrationLockText(doc.docId),
            String(doc.branchCount),
            String(doc.eventCount),
        ]),
    )}
  </section>
  <section>
    <h2>Connected clients</h2>
    ${table(
        ['User', 'Nickname', 'Session', 'Actor', 'Doc', 'Branch', 'Presence'],
        connected.map((client) => [
            client.userId ?? '',
            client.nickname ?? '',
            client.sessionId ?? '',
            client.actor ?? '',
            client.docId ?? '',
            client.branchId ?? '',
            client.presenceReady ? 'yes' : '',
        ]),
    )}
  </section>
  <section>
    <h2>Recent events</h2>
    ${table(
        ['Doc', 'Branch', 'Index', 'Kind', 'User', 'Session', 'Origin', 'Timestamp'],
        events.map((event) => {
            const origin = event.kind === 'update' ? event.origin : event.actor;
            const actor = parseSessionActor(origin);
            return [
                event.docId,
                event.branchId,
                String(event.eventIndex),
                event.kind,
                actor?.userId ?? '',
                actor?.sessionId ?? '',
                origin,
                event.kind === 'update' ? event.hlcTimestamp : '',
            ];
        }),
    )}
  </section>
</body>
</html>`;
}

function migrationLockText(docId: string) {
    const lock = store.activeMigrationLock(docId);
    return lock ? `${lock.ownerActor} -> ${lock.targetSchemaFingerprintHash}` : '';
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
        headers: {...corsHeaders(), 'content-type': 'application/json'},
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
