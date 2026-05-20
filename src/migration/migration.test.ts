import {describe, expect, it} from 'vitest';
import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    MigrationError,
    migrateValue,
    resolveMigrationPath,
    type SchemaMigrationConfig,
    type VersionedSchema,
} from './index.js';

type V1 = {title: string};
type V2 = {title: string; done: boolean};
type V3 = {label: string; done: boolean};

const schemaCollection = {version: '3.1', schemas: [{}], components: {schemas: {}}} as IJsonSchemaCollection<
    '3.1',
    [unknown]
>;

const v1 = versionedSchema<V1>(1, 'v1-hash', isV1);
const v2 = versionedSchema<V2>(2, 'v2-hash', isV2);
const v3 = versionedSchema<V3>(3, 'v3-hash', isV3);

const config: SchemaMigrationConfig<V3> = {
    current: v3,
    previous: [v1, v2],
    migrations: [
        {
            id: 'v1-to-v2',
            fromVersion: 1,
            toVersion: 2,
            fromFingerprintHash: 'v1-hash',
            toFingerprintHash: 'v2-hash',
            migrateState(input) {
                const state = input as V1;
                return {title: state.title, done: false} satisfies V2;
            },
        },
        {
            id: 'v2-to-v3',
            fromVersion: 2,
            toVersion: 3,
            fromFingerprintHash: 'v2-hash',
            toFingerprintHash: 'v3-hash',
            migrateState(input) {
                const state = input as V2;
                return {label: state.title, done: state.done} satisfies V3;
            },
        },
    ],
};

describe('schema migration core', () => {
    it('finds multi-step migration paths', () => {
        const path = resolveMigrationPath(config, {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expect(path.map((migration) => migration.id)).toEqual(['v1-to-v2', 'v2-to-v3']);
    });

    it('migrates a value through all steps and validates the result', () => {
        const result = migrateValue(config, {title: 'Ship'}, {
            schemaVersion: 1,
            schemaFingerprintHash: 'v1-hash',
        });

        expect(result).toMatchObject({
            value: {label: 'Ship', done: false},
            migrationIds: ['v1-to-v2', 'v2-to-v3'],
            fromVersion: 1,
            toVersion: 3,
            fromFingerprintHash: 'v1-hash',
            toFingerprintHash: 'v3-hash',
        });
    });

    it('returns the current value when metadata already matches the current schema', () => {
        const result = migrateValue(config, {label: 'Current', done: true}, {
            schemaVersion: 3,
            schemaFingerprintHash: 'v3-hash',
        });

        expect(result.value).toEqual({label: 'Current', done: true});
        expect(result.migrationIds).toEqual([]);
    });

    it('refuses missing previous schemas', () => {
        expect(() =>
            resolveMigrationPath(
                {...config, previous: [v2]},
                {schemaVersion: 1, schemaFingerprintHash: 'v1-hash'},
            ),
        ).toThrowMigrationError('missing-source-schema');
    });

    it('refuses downgrades', () => {
        const future = versionedSchema(4, 'v4-hash', (input): input is {next: true} => {
            return isRecord(input) && input.next === true;
        });

        expect(() =>
            resolveMigrationPath(
                {...config, previous: [v1, v2, future]},
                {schemaVersion: 4, schemaFingerprintHash: 'v4-hash'},
            ),
        ).toThrowMigrationError('unsupported-downgrade');
    });

    it('refuses full fingerprint mismatches even when the hash matches', () => {
        expect(() =>
            resolveMigrationPath(config, {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
                schemaFingerprint: 'unexpected-full-fingerprint',
            }),
        ).toThrowMigrationError('fingerprint-mismatch');
    });

    it('refuses missing migration paths', () => {
        expect(() =>
            resolveMigrationPath(
                {...config, migrations: [config.migrations[0]]},
                {schemaVersion: 1, schemaFingerprintHash: 'v1-hash'},
            ),
        ).toThrowMigrationError('missing-migration-path');
    });

    it('propagates source validation failures', () => {
        expect(() =>
            migrateValue(config, {title: 123}, {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('validation-failed');
    });

    it('propagates target validation failures', () => {
        const badConfig: SchemaMigrationConfig<V3> = {
            ...config,
            migrations: [
                {
                    ...config.migrations[0],
                    migrateState() {
                        return {title: 'Missing done'};
                    },
                },
                config.migrations[1],
            ],
        };

        expect(() =>
            migrateValue(badConfig, {title: 'Ship'}, {
                schemaVersion: 1,
                schemaFingerprintHash: 'v1-hash',
            }),
        ).toThrowMigrationError('validation-failed');
    });
});

expect.extend({
    toThrowMigrationError(received: () => unknown, code: string) {
        try {
            received();
        } catch (error) {
            const pass = error instanceof MigrationError && error.code === code;
            return {
                pass,
                message: () =>
                    pass
                        ? `expected function not to throw MigrationError ${code}`
                        : `expected MigrationError ${code}, got ${String(error)}`,
            };
        }
        return {
            pass: false,
            message: () => `expected function to throw MigrationError ${code}`,
        };
    },
});

declare module 'vitest' {
    interface Assertion<T = unknown> {
        toThrowMigrationError(code: string): T;
    }
}

function versionedSchema<T>(
    version: number,
    fingerprintHash: string,
    guard: (input: unknown) => input is T,
): VersionedSchema<T> {
    return {
        version,
        schema: schemaCollection as IJsonSchemaCollection<'3.1', [T]>,
        fingerprint: `${fingerprintHash}-full`,
        fingerprintHash,
        tagKey: 'type',
        validateState(input): IValidation<T> {
            return guard(input)
                ? {success: true, data: input}
                : {success: false, data: input, errors: [{path: '$input', expected: 'test schema'}]};
        },
    };
}

function isV1(input: unknown): input is V1 {
    return isRecord(input) && typeof input.title === 'string';
}

function isV2(input: unknown): input is V2 {
    return isRecord(input) && typeof input.title === 'string' && typeof input.done === 'boolean';
}

function isV3(input: unknown): input is V3 {
    return isRecord(input) && typeof input.label === 'string' && typeof input.done === 'boolean';
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}
