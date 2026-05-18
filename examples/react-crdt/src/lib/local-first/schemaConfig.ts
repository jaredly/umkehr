export type LocalFirstMigration<TFrom, TTo> = {
    id: string;
    fromVersion: number;
    toVersion: number;
    fromFingerprint?: string;
    toDocId: string | ((sourceDocId: string) => string);
    migrateState(input: TFrom): TTo;
};

export type LocalFirstSchemaConfig<TState> = {
    version: number;
    migrations: LocalFirstMigration<unknown, TState>[];
};

export function defaultLocalFirstSchemaConfig<TState>(): LocalFirstSchemaConfig<TState> {
    return {
        version: 1,
        migrations: [],
    };
}
