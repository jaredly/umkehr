import type {AppDefinition, CrdtRuntime, HistoryRuntime} from './crdtApp';
import type {LeafBuilderExtensionAny} from 'umkehr';
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
    richNotesApp,
    richNotesCrdtRuntime,
    richNotesHistoryRuntime,
} from '../apps/rich-notes/RichNotesApp';
import type {RichNotesBuilderExtensions, RichNotesState} from '../apps/rich-notes/model';
import {
    blockNotesApp,
    blockNotesCrdtRuntime,
    blockNotesHistoryRuntime,
} from '../apps/block-notes/BlockNotesApp';
import type {
    BlockNotesBuilderExtensions,
    BlockNotesEphemeralData,
    BlockNotesState,
} from '../apps/block-notes/model';
import {
    wordsearchApp,
    wordsearchCrdtRuntime,
    wordsearchHistoryRuntime,
} from '../apps/wordsearch/WordsearchApp';
import type {WordsearchEphemeralData, WordsearchState} from '../apps/wordsearch/model';
import {jigsawApp, jigsawCrdtRuntime, jigsawHistoryRuntime} from '../apps/jigsaw/JigsawApp';
import type {JigsawEphemeralData, JigsawState} from '../apps/jigsaw/model';
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
import {schemaFingerprint, schemaFingerprintHash} from './local-first/schemaFingerprint';

type RegisteredApp<TState = unknown, Extensions extends readonly LeafBuilderExtensionAny[] = []> = {
    routeId?: string;
    app: AppDefinition<TState, never, Extensions>;
    crdt: CrdtRuntime<TState, never, Extensions>;
    history: HistoryRuntime<TState>;
    serverSchemaConfig?: ServerSchemaConfig<TState>;
    localFirstSchemaConfig?: LocalFirstSchemaConfig<TState>;
    serverOldPendingChangesPolicy?: ServerOldPendingChangesPolicy;
};

type RegisteredEphemeralApp<
    TState,
    EphemeralData,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = Omit<RegisteredApp<TState, Extensions>, 'app' | 'crdt'> & {
    app: AppDefinition<TState, EphemeralData, Extensions>;
    crdt: CrdtRuntime<TState, EphemeralData, Extensions>;
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
            fromFingerprint: schemaFingerprint(todoV1App),
            fromFingerprintHash: schemaFingerprintHash(todoV1App),
            toFingerprint: schemaFingerprint(todoApp),
            toFingerprintHash: schemaFingerprintHash(todoApp),
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
    {
        app: richNotesApp,
        crdt: richNotesCrdtRuntime,
        history: richNotesHistoryRuntime,
        serverSchemaConfig: undefined,
    },
    {
        app: blockNotesApp,
        crdt: blockNotesCrdtRuntime,
        history: blockNotesHistoryRuntime,
        serverSchemaConfig: undefined,
    },
    {
        app: wordsearchApp,
        crdt: wordsearchCrdtRuntime,
        history: wordsearchHistoryRuntime,
        serverSchemaConfig: undefined,
    },
    {
        app: jigsawApp,
        crdt: jigsawCrdtRuntime,
        history: jigsawHistoryRuntime,
        serverSchemaConfig: undefined,
    },
] satisfies [
    RegisteredApp<TodoState>,
    RegisteredApp<TodoFixtureStateV1>,
    RegisteredApp<TodoFixtureStateV3>,
    RegisteredEphemeralApp<WhiteboardState, WhiteboardEphemeralData>,
    RegisteredApp<RichNotesState, RichNotesBuilderExtensions>,
    RegisteredEphemeralApp<BlockNotesState, BlockNotesEphemeralData, BlockNotesBuilderExtensions>,
    RegisteredEphemeralApp<WordsearchState, WordsearchEphemeralData>,
    RegisteredEphemeralApp<JigsawState, JigsawEphemeralData>,
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
