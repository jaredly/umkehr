import type {SchemaMigration, VersionedSchema} from 'umkehr/migration';

export type LocalFirstMigration<TFrom, TTo> = {
    id: string;
    fromVersion: number;
    toVersion: number;
    fromFingerprint?: string;
    fromFingerprintHash?: string;
    toFingerprint?: string;
    toFingerprintHash?: string;
    toDocId: string | ((sourceDocId: string) => string);
} & Pick<SchemaMigration<TFrom, TTo>, 'migrateState' | 'migratePatch' | 'migrateCrdtUpdate'>;

export type LocalFirstSchemaConfig<TState> = {
    version: number;
    previous?: VersionedSchema<unknown>[];
    migrations: LocalFirstMigration<unknown, unknown>[];
};

export function defaultLocalFirstSchemaConfig<TState>(): LocalFirstSchemaConfig<TState> {
    return {
        version: 1,
        migrations: [],
    };
}
