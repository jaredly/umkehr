import type {CrdtDocument} from 'umkehr/crdt';
import {
    LOCAL_FIRST_PROTOCOL_VERSION,
    parseLocalFirstMessage,
    type LocalFirstMessage,
    type LocalFirstProtocolConfig,
} from './protocol';
import type {LocalFirstMember, LocalFirstRole, PersistedBatch, VersionVector} from './types';

export type LocalFirstSessionPeer = {
    peerId: string;
    actor?: string;
    role?: LocalFirstRole;
    vector?: VersionVector;
    docId?: string;
    schemaVersion?: number;
    schemaFingerprint?: string;
    schemaFingerprintHash?: string;
    open: boolean;
};

export type LocalFirstSessionState<TState> = {
    docId: string;
    schemaVersion: number;
    schemaFingerprint: string;
    schemaFingerprintHash: string;
    replicaId: string;
    role: LocalFirstRole;
    selfPeerId?: string;
    vector: VersionVector;
    document: CrdtDocument<TState>;
    connections: LocalFirstSessionPeer[];
};

export type LocalFirstSessionEffect<TState> =
    | {
          kind: 'markConnection';
          peerId: string;
          actor: string;
          role?: LocalFirstRole;
          vector?: VersionVector;
          docId?: string;
          schemaVersion?: number;
          schemaFingerprint?: string;
          schemaFingerprintHash?: string;
      }
    | {kind: 'connectionError'; peerId: string; message: string}
    | {kind: 'recordMembers'; peerId: string; members: LocalFirstMember[]}
    | {kind: 'send'; peerId: string; message: LocalFirstMessage<TState>}
    | {kind: 'broadcastMembers'; exceptPeerId?: string}
    | {kind: 'sendMissingBatches'; peerId: string; since: VersionVector}
    | {kind: 'acceptBatch'; batch: PersistedBatch; fromPeerId: string}
    | {
          kind: 'acceptSnapshot';
          actor: string;
          document: CrdtDocument<TState>;
          compactedThrough: VersionVector;
      }
    | {kind: 'connect'; peerId: string};

export function createHelloMessage<TState>(
    state: LocalFirstSessionState<TState>,
): LocalFirstMessage<TState> {
    return {
        kind: 'hello',
        version: LOCAL_FIRST_PROTOCOL_VERSION,
        actor: state.replicaId,
        peerId: state.selfPeerId,
        docId: state.docId,
        schemaVersion: state.schemaVersion,
        schemaFingerprint: state.schemaFingerprint,
        schemaFingerprintHash: state.schemaFingerprintHash,
        role: state.role,
        vector: state.vector,
    };
}

export function createSyncRequestMessage<TState>(
    state: LocalFirstSessionState<TState>,
): LocalFirstMessage<TState> {
    return {
        kind: 'syncRequest',
        version: LOCAL_FIRST_PROTOCOL_VERSION,
        actor: state.replicaId,
        docId: state.docId,
        schemaVersion: state.schemaVersion,
        schemaFingerprint: state.schemaFingerprint,
        schemaFingerprintHash: state.schemaFingerprintHash,
        vector: state.vector,
    };
}

export function createSnapshotMessage<TState>(
    state: LocalFirstSessionState<TState>,
): LocalFirstMessage<TState> {
    return {
        kind: 'snapshot',
        version: LOCAL_FIRST_PROTOCOL_VERSION,
        actor: state.replicaId,
        docId: state.docId,
        schemaVersion: state.schemaVersion,
        schemaFingerprint: state.schemaFingerprint,
        schemaFingerprintHash: state.schemaFingerprintHash,
        document: state.document,
        compactedThrough: state.vector,
    };
}

export function createMembersMessage<TState>(
    state: LocalFirstSessionState<TState>,
): LocalFirstMessage<TState> {
    return {
        kind: 'members',
        version: LOCAL_FIRST_PROTOCOL_VERSION,
        actor: state.replicaId,
        docId: state.docId,
        schemaVersion: state.schemaVersion,
        schemaFingerprint: state.schemaFingerprint,
        schemaFingerprintHash: state.schemaFingerprintHash,
        members: currentMembers(state),
    };
}

export function createUpdatesMessage<TState>(
    state: LocalFirstSessionState<TState>,
    batch: PersistedBatch,
): LocalFirstMessage<TState> {
    return {
        kind: 'updates',
        version: LOCAL_FIRST_PROTOCOL_VERSION,
        actor: state.replicaId,
        docId: state.docId,
        schemaVersion: state.schemaVersion,
        schemaFingerprint: state.schemaFingerprint,
        schemaFingerprintHash: state.schemaFingerprintHash,
        batch,
    };
}

export function createSyncResponseMessage<TState>({
    state,
    since,
    batches,
    requiresSnapshot,
}: {
    state: LocalFirstSessionState<TState>;
    since: VersionVector;
    batches: PersistedBatch[];
    requiresSnapshot: boolean;
}): LocalFirstMessage<TState> {
    return {
        kind: 'syncResponse',
        version: LOCAL_FIRST_PROTOCOL_VERSION,
        actor: state.replicaId,
        docId: state.docId,
        schemaVersion: state.schemaVersion,
        schemaFingerprint: state.schemaFingerprint,
        schemaFingerprintHash: state.schemaFingerprintHash,
        since,
        batches,
        requiresSnapshot,
    };
}

export function planConnectionOpened<TState>(
    state: LocalFirstSessionState<TState>,
    peerId: string,
): LocalFirstSessionEffect<TState>[] {
    return [
        {kind: 'send', peerId, message: createHelloMessage(state)},
        {kind: 'send', peerId, message: createSyncRequestMessage(state)},
        {kind: 'send', peerId, message: createMembersMessage(state)},
    ];
}

export function planIncomingMessage<TState>({
    state,
    peerId,
    input,
    config,
}: {
    state: LocalFirstSessionState<TState>;
    peerId: string;
    input: unknown;
    config: LocalFirstProtocolConfig<TState>;
}): LocalFirstSessionEffect<TState>[] {
    const message = parseLocalFirstMessage(input, config);
    if (!message) {
        return [{kind: 'connectionError', peerId, message: `Rejected invalid message from ${peerId}.`}];
    }

    const effects: LocalFirstSessionEffect<TState>[] = [
        {
            kind: 'markConnection',
            peerId,
            actor: message.actor,
            role: message.kind === 'hello' ? message.role : undefined,
            vector: vectorForMessage(message),
            docId: message.docId,
            schemaVersion: message.schemaVersion,
            schemaFingerprint: message.schemaFingerprint,
            schemaFingerprintHash: message.schemaFingerprintHash,
        },
    ];

    if (message.kind === 'hello') {
        effects.push(
            {kind: 'send', peerId, message: createSnapshotMessage(state)},
            {kind: 'send', peerId, message: createSyncRequestMessage(state)},
            {kind: 'send', peerId, message: createMembersMessage(state)},
            {kind: 'broadcastMembers', exceptPeerId: peerId},
        );
        return effects;
    }

    if (message.kind === 'updates') {
        effects.push({kind: 'acceptBatch', batch: message.batch, fromPeerId: peerId});
        return effects;
    }

    if (message.kind === 'syncRequest') {
        effects.push({kind: 'sendMissingBatches', peerId, since: message.vector});
        return effects;
    }

    if (message.kind === 'syncResponse') {
        for (const batch of message.batches) {
            effects.push({kind: 'acceptBatch', batch, fromPeerId: peerId});
        }
        return effects;
    }

    if (message.kind === 'snapshot') {
        effects.push({
            kind: 'acceptSnapshot',
            actor: message.actor,
            document: message.document,
            compactedThrough: message.compactedThrough,
        });
        return effects;
    }

    effects.push({kind: 'recordMembers', peerId, members: message.members});
    for (const member of message.members) {
        if (member.peerId === state.selfPeerId || member.actor === state.replicaId) continue;
        if (
            member.docId !== state.docId ||
            member.schemaVersion !== state.schemaVersion ||
            member.schemaFingerprintHash !== state.schemaFingerprintHash
        ) {
            continue;
        }
        const existing = state.connections.find((connection) => connection.peerId === member.peerId);
        if (existing?.open) continue;
        effects.push({kind: 'connect', peerId: member.peerId});
    }
    return effects;
}

export function currentMembers<TState>(
    state: LocalFirstSessionState<TState>,
): LocalFirstMember[] {
    const members: LocalFirstMember[] = state.selfPeerId
        ? [
              {
                  peerId: state.selfPeerId,
                  actor: state.replicaId,
                  role: state.role,
                  vector: state.vector,
                  docId: state.docId,
                  schemaVersion: state.schemaVersion,
                  schemaFingerprint: state.schemaFingerprint,
                  schemaFingerprintHash: state.schemaFingerprintHash,
              },
          ]
        : [];
    for (const connection of state.connections) {
        if (!connection.actor) continue;
        members.push({
            peerId: connection.peerId,
            actor: connection.actor,
            role: connection.role ?? 'host',
            vector: connection.vector ?? {},
            docId: connection.docId ?? state.docId,
            schemaVersion: connection.schemaVersion ?? state.schemaVersion,
            schemaFingerprint: connection.schemaFingerprint ?? state.schemaFingerprint,
            schemaFingerprintHash:
                connection.schemaFingerprintHash ?? state.schemaFingerprintHash,
        });
    }
    return members;
}

function vectorForMessage<TState>(message: LocalFirstMessage<TState>): VersionVector | undefined {
    if (message.kind === 'hello' || message.kind === 'syncRequest') return message.vector;
    if (message.kind === 'snapshot') return message.compactedThrough;
    return undefined;
}
