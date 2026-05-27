import type {AppDefinition, CrdtRuntime, HistoryRuntime} from './crdtApp';
import {createElement} from 'react';
import {createHistoryContext} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import {todoApp, todoCrdtRuntime, todoHistoryRuntime} from '../apps/todos/TodoApp';
import type {TodoState} from '../apps/todos/model';
import {TodoMigrationFixturePanel} from '../apps/todos/TodoMigrationFixturePanel';
import {
    whiteboardApp,
    whiteboardCrdtRuntime,
    whiteboardHistoryRuntime,
} from '../apps/whiteboard/WhiteboardApp';
import type {WhiteboardEphemeralData, WhiteboardState} from '../apps/whiteboard/model';
import {
    TODO_FIXTURE_DOC_ID_V2,
    TODO_FIXTURE_TAG_KEY,
    todoFixtureInitialV1,
    todoFixtureMigration,
    todoFixtureMigrationConfig,
    todoFixtureV2Metadata,
    type TodoFixtureStateV2,
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

const [ProvideTodoMigrationFixtureHistory, useTodoMigrationFixtureHistory] =
    createHistoryContext<TodoFixtureStateV2, never, 'type'>('type');
const [ProvideTodoMigrationFixture, useTodoMigrationFixture] =
    createSyncedContext<TodoFixtureStateV2>('type');

const todoMigrationFixtureApp: AppDefinition<TodoFixtureStateV2> = {
    id: 'todos-migration-fixture',
    title: 'Todos migration',
    schemaVersion: todoFixtureMigrationConfig.current.version,
    tagKey: TODO_FIXTURE_TAG_KEY,
    schema: todoFixtureV2Metadata.schema,
    validateState: todoFixtureV2Metadata.validateState,
    initialState: {
        bgcolor: todoFixtureInitialV1.bgcolor,
        todos: todoFixtureInitialV1.todos
            .filter((todo) => !todo.archived)
            .map((todo) => ({
                id: todo.id,
                title: todo.text,
                done: todo.done,
                priority: 'normal',
            })),
    },
    initialTimestamp: todoApp.initialTimestamp,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return createElement(TodoMigrationFixturePanel, {
            editor,
            replicaId: actor,
            title,
            gridSlot,
            readOnly,
        });
    },
};

const todoMigrationFixtureRuntime: CrdtRuntime<TodoFixtureStateV2> = {
    docId: TODO_FIXTURE_DOC_ID_V2,
    Provider: ProvideTodoMigrationFixture,
    useEditorContext: useTodoMigrationFixture,
};

const todoMigrationFixtureHistoryRuntime: HistoryRuntime<TodoFixtureStateV2> = {
    Provider: ProvideTodoMigrationFixtureHistory,
    useEditorContext: useTodoMigrationFixtureHistory,
};

const todoMigrationServerSchemaConfig: ServerSchemaConfig<TodoFixtureStateV2> = {
    version: todoFixtureMigrationConfig.current.version,
    previous: todoFixtureMigrationConfig.previous,
    migrations: [todoFixtureMigration],
};

export const registeredApps = [
    {
        app: todoApp,
        crdt: todoCrdtRuntime,
        history: todoHistoryRuntime,
        serverSchemaConfig: undefined,
    },
    {
        app: todoMigrationFixtureApp,
        crdt: todoMigrationFixtureRuntime,
        history: todoMigrationFixtureHistoryRuntime,
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
    RegisteredApp<TodoFixtureStateV2>,
    RegisteredEphemeralApp<WhiteboardState, WhiteboardEphemeralData>,
];
export const apps = registeredApps.map((entry) => entry.app);
export const defaultApp = todoApp;
export const defaultCrdtRuntime = todoCrdtRuntime;
export const defaultHistoryRuntime = todoHistoryRuntime;

export function registeredAppForId(id: string) {
    return registeredApps.find((entry) => entry.app.id === id) ?? registeredApps[0];
}
