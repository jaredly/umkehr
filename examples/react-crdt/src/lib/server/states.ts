import type {ServerSyncState} from './types';

type ServerMessageMetadata = {version?: number; docId?: string};

export type ServerMigrationStateMessage =
    | {
          kind: 'serverMigrationRequired';
          sourceSchemaVersion: number;
          sourceSchemaFingerprintHash: string;
          targetSchemaVersion: number;
          targetSchemaFingerprintHash: string;
      } & ServerMessageMetadata
    | {
          kind: 'waitForMigration';
          ownerActor: string;
          targetSchemaVersion: number;
          targetSchemaFingerprintHash: string;
      } & ServerMessageMetadata
    | {
          kind: 'clientMigrationRequired';
          schemaVersion: number;
          schemaFingerprintHash: string;
      } & ServerMessageMetadata
    | {
          kind: 'schemaMismatch';
          schemaVersion: number;
          schemaFingerprintHash: string;
      } & ServerMessageMetadata
    | ({kind: 'migrationCancelled'; reason: string} & ServerMessageMetadata);

export function serverMigrationStateForMessage(message: ServerMigrationStateMessage): ServerSyncState {
    switch (message.kind) {
        case 'serverMigrationRequired':
            return {
                kind: 'migration-required',
                message: 'Document migration required. This client can migrate the server document to the current app schema.',
                sourceSchemaVersion: message.sourceSchemaVersion,
                sourceSchemaFingerprintHash: message.sourceSchemaFingerprintHash,
                targetSchemaVersion: message.targetSchemaVersion,
                targetSchemaFingerprintHash: message.targetSchemaFingerprintHash,
            };
        case 'waitForMigration':
            return {
                kind: 'migration-running',
                message: 'Document migration is in progress. Sync will resume after the migration finishes or is cancelled.',
                ownerActor: message.ownerActor,
                targetSchemaVersion: message.targetSchemaVersion,
                targetSchemaFingerprintHash: message.targetSchemaFingerprintHash,
            };
        case 'clientMigrationRequired':
            return {
                kind: 'client-migration-required',
                message: 'Update your app to sync with the server. Local edits will stay pending.',
                schemaVersion: message.schemaVersion,
                schemaFingerprintHash: message.schemaFingerprintHash,
            };
        case 'schemaMismatch':
            return {
                kind: 'schema-mismatch',
                message: 'Server document schema does not match this app version.',
                schemaVersion: message.schemaVersion,
                schemaFingerprintHash: message.schemaFingerprintHash,
            };
        case 'migrationCancelled':
            return {
                kind: 'migration-cancelled',
                message: message.reason || 'Document migration was cancelled. Reconnect to retry.',
            };
    }
}

export function canFlushPendingServerWrites(state: ServerSyncState) {
    return (
        state.kind === 'connected' ||
        state.kind === 'connecting' ||
        state.kind === 'offline' ||
        state.kind === 'migration-cancelled'
    );
}

export function serverStateNoticeTone(state: ServerSyncState): 'info' | 'error' | null {
    if (!('message' in state)) return null;
    if (
        state.kind === 'migration-required' ||
        state.kind === 'migration-running' ||
        state.kind === 'migration-cancelled' ||
        state.kind === 'client-migration-required'
    ) {
        return 'info';
    }
    return 'error';
}

export function shouldPauseServerSync(state: ServerSyncState) {
    return (
        state.kind === 'migration-required' ||
        state.kind === 'migration-running' ||
        state.kind === 'migration-cancelled' ||
        state.kind === 'client-migration-required' ||
        state.kind === 'schema-mismatch' ||
        state.kind === 'error'
    );
}
