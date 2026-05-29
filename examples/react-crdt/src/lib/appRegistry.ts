import type {AppDefinition, CrdtRuntime, HistoryRuntime} from './crdtApp';
import {todoApp, todoCrdtRuntime, todoHistoryRuntime} from '../apps/todos/TodoApp';
import type {TodoState} from '../apps/todos/model';
import {
    todoV1App,
    todoV1CrdtRuntime,
    todoV1HistoryRuntime,
    todoV3App,
    todoV3CrdtRuntime,
    todoV3HistoryRuntime,
} from '../apps/todos/TodoVersionApps';
import {
    whiteboardApp,
    whiteboardCrdtRuntime,
    whiteboardHistoryRuntime,
} from '../apps/whiteboard/WhiteboardApp';
import type {WhiteboardEphemeralData, WhiteboardState} from '../apps/whiteboard/model';
import {
    todoFixtureMigration,
    todoFixtureMigrationConfig,
    todoFixtureV3MigrationConfig,
    type TodoFixtureStateV1,
    type TodoFixtureStateV3,
} from '../../../migration-fixtures/todos';
import type {ServerSchemaConfig} from './server/schemaConfig';
import type {ServerOldPendingChangesPolicy} from './server/types';
import type {LocalFirstSchemaConfig} from './local-first/schemaConfig';

type RegisteredApp<TState = unknown> = {
    routeId?: string;
    app: AppDefinition<TState>;
    crdt: CrdtRuntime<TState>;
    history: HistoryRuntime<TState>;
    serverSchemaConfig?: ServerSchemaConfig<TState>;
    localFirstSchemaConfig?: LocalFirstSchemaConfig<TState>;
    serverOldPendingChangesPolicy?: ServerOldPendingChangesPolicy;
};

type RegisteredEphemeralApp<TState, EphemeralData> = Omit<RegisteredApp<TState>, 'app' | 'crdt'> & {
    app: AppDefinition<TState, EphemeralData>;
    crdt: CrdtRuntime<TState, EphemeralData>;
};

const todoMigrationServerSchemaConfig: ServerSchemaConfig<TodoState> = {
    version: todoFixtureMigrationConfig.current.version,
    previous: todoFixtureMigrationConfig.previous,
    migrations: [todoFixtureMigration],
};

const todoMigrationLocalFirstSchemaConfig: LocalFirstSchemaConfig<TodoState> = {
    version: todoFixtureMigrationConfig.current.version,
    previous: todoFixtureMigrationConfig.previous,
    migrations: [
        {
            ...todoFixtureMigration,
            toDocId: (sourceDocId) => `${sourceDocId}-local-first-v2`,
        },
    ],
};

const todoV1ServerSchemaConfig: ServerSchemaConfig<TodoFixtureStateV1> = {
    version: 1,
    migrations: [],
};

const todoV3ServerSchemaConfig: ServerSchemaConfig<TodoFixtureStateV3> = {
    version: todoFixtureV3MigrationConfig.current.version,
    previous: todoFixtureV3MigrationConfig.previous,
    migrations: todoFixtureV3MigrationConfig.migrations,
};

export const registeredApps = [
    {
        app: todoApp,
        crdt: todoCrdtRuntime,
        history: todoHistoryRuntime,
        serverSchemaConfig: todoMigrationServerSchemaConfig,
        localFirstSchemaConfig: todoMigrationLocalFirstSchemaConfig,
        serverOldPendingChangesPolicy: {kind: 'manual-review', thresholdMs: 300_000},
    },
    {
        routeId: 'todos@1',
        app: todoV1App,
        crdt: todoV1CrdtRuntime,
        history: todoV1HistoryRuntime,
        serverSchemaConfig: todoV1ServerSchemaConfig,
    },
    {
        routeId: 'todos@3',
        app: todoV3App,
        crdt: todoV3CrdtRuntime,
        history: todoV3HistoryRuntime,
        serverSchemaConfig: todoV3ServerSchemaConfig,
    },
    {
        app: whiteboardApp,
        crdt: whiteboardCrdtRuntime,
        history: whiteboardHistoryRuntime,
        serverSchemaConfig: undefined,
    },
] satisfies [
    RegisteredApp<TodoState>,
    RegisteredApp<TodoFixtureStateV1>,
    RegisteredApp<TodoFixtureStateV3>,
    RegisteredEphemeralApp<WhiteboardState, WhiteboardEphemeralData>,
];
export type AppOption = {
    id: string;
    title: string;
};
export const apps: AppOption[] = registeredApps.map((entry) => ({
    id: routeIdForRegisteredApp(entry),
    title: entry.app.title,
}));
export const defaultApp = todoApp;
export const defaultCrdtRuntime = todoCrdtRuntime;
export const defaultHistoryRuntime = todoHistoryRuntime;
export const defaultAppRouteId = routeIdForRegisteredApp(registeredApps[0]);

export function registeredAppForId(id: string) {
    const exact = registeredApps.find((entry) => routeIdForRegisteredApp(entry) === id);
    if (exact) return exact;
    const appId = id.split('@', 1)[0] || id;
    return registeredApps.find((entry) => entry.app.id === appId) ?? registeredApps[0];
}

export function routeIdForRegisteredApp(entry: {routeId?: string; app: {id: string}}) {
    return entry.routeId ?? entry.app.id;
}
