import type {AppDefinition, CrdtRuntime, HistoryRuntime} from './crdtApp';
import {todoApp, todoCrdtRuntime, todoHistoryRuntime} from '../apps/todos/TodoApp';
import type {TodoState} from '../apps/todos/model';
import {
    whiteboardApp,
    whiteboardCrdtRuntime,
    whiteboardHistoryRuntime,
} from '../apps/whiteboard/WhiteboardApp';
import type {WhiteboardEphemeralData, WhiteboardState} from '../apps/whiteboard/model';
import {
    todoFixtureMigration,
    todoFixtureMigrationConfig,
} from '../../../migration-fixtures/todos';
import type {ServerSchemaConfig} from './server/schemaConfig';

type RegisteredApp<TState = unknown> = {
    app: AppDefinition<TState>;
    crdt: CrdtRuntime<TState>;
    history: HistoryRuntime<TState>;
    serverSchemaConfig?: ServerSchemaConfig<TState>;
};

type RegisteredEphemeralApp<TState, EphemeralData> = Omit<
    RegisteredApp<TState>,
    'app' | 'crdt'
> & {
    app: AppDefinition<TState, EphemeralData>;
    crdt: CrdtRuntime<TState, EphemeralData>;
};

const todoMigrationServerSchemaConfig: ServerSchemaConfig<TodoState> = {
    version: todoFixtureMigrationConfig.current.version,
    previous: todoFixtureMigrationConfig.previous,
    migrations: [todoFixtureMigration],
};

export const registeredApps = [
    {
        app: todoApp,
        crdt: todoCrdtRuntime,
        history: todoHistoryRuntime,
        serverSchemaConfig: todoMigrationServerSchemaConfig,
    },
    {
        app: whiteboardApp,
        crdt: whiteboardCrdtRuntime,
        history: whiteboardHistoryRuntime,
        serverSchemaConfig: undefined,
    },
] satisfies [
    RegisteredApp<TodoState>,
    RegisteredEphemeralApp<WhiteboardState, WhiteboardEphemeralData>,
];
export const apps = registeredApps.map((entry) => entry.app);
export const defaultApp = todoApp;
export const defaultCrdtRuntime = todoCrdtRuntime;
export const defaultHistoryRuntime = todoHistoryRuntime;

export function registeredAppForId(id: string) {
    return registeredApps.find((entry) => entry.app.id === id) ?? registeredApps[0];
}
