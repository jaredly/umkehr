import type {SchemaMigration, VersionedSchema} from 'umkehr/migration';

export type ServerMigration<TFrom, TTo> = {
    id: string;
    fromVersion: number;
    toVersion: number;
    fromFingerprint?: string;
    fromFingerprintHash?: string;
    toFingerprint?: string;
    toFingerprintHash?: string;
} & Pick<SchemaMigration<TFrom, TTo>, 'migrateState' | 'migratePatch' | 'migrateCrdtUpdate'>;

export type ServerSchemaConfig<TState> = {
    version: number;
    previous?: VersionedSchema<unknown>[];
    migrations: ServerMigration<unknown, unknown>[];
};

export function defaultServerSchemaConfig<TState>(): ServerSchemaConfig<TState> {
    return {
        version: 1,
        migrations: [],
    };
}
