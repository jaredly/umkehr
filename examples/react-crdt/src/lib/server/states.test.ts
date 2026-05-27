import {describe, expect, it} from 'vitest';
import {
    canFlushPendingServerWrites,
    serverMigrationStateForMessage,
    serverStateNoticeTone,
} from './states';

describe('server migration user-facing states', () => {
    it('shows document migration required for a newer client', () => {
        expect(
            serverMigrationStateForMessage({
                kind: 'serverMigrationRequired',
                version: 3,
                docId: 'doc',
                sourceSchemaVersion: 1,
                sourceSchemaFingerprintHash: 'old-hash',
                targetSchemaVersion: 2,
                targetSchemaFingerprintHash: 'new-hash',
            }),
        ).toEqual({
            kind: 'migration-required',
            message:
                "The server's version of this document must be migrated to the latest schema to continue syncing. You will not receive or send updates until this has been completed. You can continue to make local changes, and they will be synced after server migration has occurred.",
            sourceSchemaVersion: 1,
            sourceSchemaFingerprintHash: 'old-hash',
            targetSchemaVersion: 2,
            targetSchemaFingerprintHash: 'new-hash',
        });
    });

    it('shows migration in progress while another client owns the lock', () => {
        expect(
            serverMigrationStateForMessage({
                kind: 'waitForMigration',
                version: 3,
                docId: 'doc',
                ownerActor: 'other:session',
                targetSchemaVersion: 2,
                targetSchemaFingerprintHash: 'new-hash',
            }),
        ).toMatchObject({
            kind: 'migration-running',
            ownerActor: 'other:session',
            message:
                'Document migration is in progress. Sync will resume after the migration finishes or is cancelled.',
        });
    });

    it('shows update-your-app for old clients connecting to newer data', () => {
        expect(
            serverMigrationStateForMessage({
                kind: 'clientMigrationRequired',
                version: 3,
                docId: 'doc',
                schemaVersion: 2,
                schemaFingerprintHash: 'new-hash',
            }),
        ).toEqual({
            kind: 'client-migration-required',
            message:
                "Your version of the app is behind the server's schema version for this document. You must update your app in order to be able to send or receive updates. However, you may still make local changes, which will be synchronized once you upgrade your app.",
            schemaVersion: 2,
            schemaFingerprintHash: 'new-hash',
        });
    });

    it('shows migration cancelled after server lock expiry', () => {
        expect(
            serverMigrationStateForMessage({
                kind: 'migrationCancelled',
                version: 3,
                docId: 'doc',
                reason: 'Migration lock expired.',
            }),
        ).toEqual({
            kind: 'migration-cancelled',
            message: 'Migration lock expired.',
        });
    });

    it('pauses server writes during migration without blocking local pending edits', () => {
        expect(canFlushPendingServerWrites({kind: 'connected'})).toBe(true);
        expect(
            canFlushPendingServerWrites({
                kind: 'migration-running',
                message: 'Document migration is in progress.',
                ownerActor: 'other:session',
                targetSchemaVersion: 2,
                targetSchemaFingerprintHash: 'new-hash',
            }),
        ).toBe(false);
        expect(
            canFlushPendingServerWrites({
                kind: 'client-migration-required',
                message:
                    "Your version of the app is behind the server's schema version for this document. You must update your app in order to be able to send or receive updates. However, you may still make local changes, which will be synchronized once you upgrade your app.",
                schemaVersion: 2,
                schemaFingerprintHash: 'new-hash',
            }),
        ).toBe(false);
    });

    it('treats update-your-app as an informational notice', () => {
        expect(
            serverStateNoticeTone({
                kind: 'client-migration-required',
                message:
                    "Your version of the app is behind the server's schema version for this document. You must update your app in order to be able to send or receive updates. However, you may still make local changes, which will be synchronized once you upgrade your app.",
                schemaVersion: 2,
                schemaFingerprintHash: 'new-hash',
            }),
        ).toBe('info');
        expect(
            serverStateNoticeTone({
                kind: 'error',
                message: 'WebSocket connection failed.',
            }),
        ).toBe('error');
    });
});
