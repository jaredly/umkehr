import type {IJsonSchemaCollection, IValidation} from 'typia';
import type {History, Patch} from 'umkehr';
import {
    applyCrdtUpdate,
    createCrdtDocument,
    createCrdtUpdates,
    latestCrdtUpdateTimestamp,
    type CrdtDocument,
    type CrdtLocalHistory,
    type CrdtPathSegment,
    type CrdtUpdate,
    type JsonValue,
} from 'umkehr/crdt';
import {
    type SchemaMigration,
    type SchemaMigrationConfig,
    sha256Hex,
    type VersionedSchema,
} from 'umkehr/migration';

export type TodoFixtureV1 = {
    id: string;
    text: string;
    done: boolean;
    archived?: boolean;
};

export type TodoFixtureStateV1 = {
    bgcolor: string;
    todos: TodoFixtureV1[];
    legacyFilter?: string;
};

export type TodoFixtureV2 = {
    id: string;
    title: string;
    done: boolean;
    priority: 'normal' | 'high';
};

export type TodoFixtureStateV2 = {
    bgcolor: string;
    todos: TodoFixtureV2[];
};

export type TodoFixtureV3 = {
    id: string;
    title: string;
    done: boolean;
    priority: 'normal' | 'high';
    notes: string;
};

export type TodoFixtureStateV3 = {
    bgcolor: string;
    todos: TodoFixtureV3[];
    view: 'all' | 'active' | 'done';
};

export const TODO_FIXTURE_DOC_ID_V1 = 'todos-fixture-v1';
export const TODO_FIXTURE_DOC_ID_V2 = 'todos-fixture-v2';
export const TODO_FIXTURE_DOC_ID_V3 = 'todos-fixture-v3';
export const TODO_FIXTURE_TAG_KEY = 'type';
export const TODO_FIXTURE_MIGRATED_AT = '2026-05-20T00:00:00.000Z';

export const todoFixtureV1Schema = {
    version: '3.1',
    schemas: [
        {
            type: 'object',
            required: ['bgcolor', 'todos'],
            properties: {
                bgcolor: {type: 'string'},
                legacyFilter: {type: 'string'},
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['id', 'text', 'done'],
                        properties: {
                            id: {type: 'string'},
                            text: {type: 'string'},
                            done: {type: 'boolean'},
                            archived: {type: 'boolean'},
                        },
                    },
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [TodoFixtureStateV1]>;

export const todoFixtureV2Schema = {
    version: '3.1',
    schemas: [
        {
            type: 'object',
            required: ['bgcolor', 'todos'],
            properties: {
                bgcolor: {type: 'string'},
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['id', 'title', 'done', 'priority'],
                        properties: {
                            id: {type: 'string'},
                            title: {type: 'string'},
                            done: {type: 'boolean'},
                            priority: {type: 'string', enum: ['normal', 'high']},
                        },
                    },
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [TodoFixtureStateV2]>;

export const todoFixtureV3Schema = {
    version: '3.1',
    schemas: [
        {
            type: 'object',
            required: ['bgcolor', 'todos', 'view'],
            properties: {
                bgcolor: {type: 'string'},
                view: {type: 'string', enum: ['all', 'active', 'done']},
                todos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['id', 'title', 'done', 'priority', 'notes'],
                        properties: {
                            id: {type: 'string'},
                            title: {type: 'string'},
                            done: {type: 'boolean'},
                            priority: {type: 'string', enum: ['normal', 'high']},
                            notes: {type: 'string'},
                        },
                    },
                },
            },
        },
    ],
    components: {schemas: {}},
} as unknown as IJsonSchemaCollection<'3.1', [TodoFixtureStateV3]>;

export const todoFixtureV1Fingerprint = fixtureSchemaFingerprint(todoFixtureV1Schema);
export const todoFixtureV1FingerprintHash =
    '5138c45a7d7f08608d1d45ebd8f036e7ae7a6af38f742e4c45f7b49ce6638522';
export const todoFixtureV2Fingerprint = fixtureSchemaFingerprint(todoFixtureV2Schema);
export const todoFixtureV2FingerprintHash =
    'ce25d2ccf3aa388ac7ced90e75ae333e7853723c7040f7ba86a15efdfe546967';
export const todoFixtureV3Fingerprint = fixtureSchemaFingerprint(todoFixtureV3Schema);
export const todoFixtureV3FingerprintHash = sha256Hex(todoFixtureV3Fingerprint);

export const todoFixtureV1Metadata: VersionedSchema<TodoFixtureStateV1> = {
    version: 1,
    schema: todoFixtureV1Schema,
    fingerprint: todoFixtureV1Fingerprint,
    fingerprintHash: todoFixtureV1FingerprintHash,
    tagKey: TODO_FIXTURE_TAG_KEY,
    validateState: validateTodoFixtureV1,
};

export const todoFixtureV2Metadata: VersionedSchema<TodoFixtureStateV2> = {
    version: 2,
    schema: todoFixtureV2Schema,
    fingerprint: todoFixtureV2Fingerprint,
    fingerprintHash: todoFixtureV2FingerprintHash,
    tagKey: TODO_FIXTURE_TAG_KEY,
    validateState: validateTodoFixtureV2,
};

export const todoFixtureV3Metadata: VersionedSchema<TodoFixtureStateV3> = {
    version: 3,
    schema: todoFixtureV3Schema,
    fingerprint: todoFixtureV3Fingerprint,
    fingerprintHash: todoFixtureV3FingerprintHash,
    tagKey: TODO_FIXTURE_TAG_KEY,
    validateState: validateTodoFixtureV3,
};

export const todoFixtureMigration: SchemaMigration<unknown, unknown> = {
    id: 'todos-fixture-v1-to-v2',
    fromVersion: 1,
    toVersion: 2,
    fromFingerprintHash: todoFixtureV1FingerprintHash,
    toFingerprintHash: todoFixtureV2FingerprintHash,
    migrateState(input) {
        return migrateTodoFixtureState(input as TodoFixtureStateV1);
    },
    migratePatch(input) {
        return migrateTodoFixturePatch(input as Patch<TodoFixtureStateV1>);
    },
    migrateCrdtUpdate(input) {
        return migrateTodoFixtureCrdtUpdate(input);
    },
};

export const todoFixtureV1ToV2Migration = todoFixtureMigration;

export const todoFixtureV2ToV3Migration: SchemaMigration<unknown, unknown> = {
    id: 'todos-fixture-v2-to-v3',
    fromVersion: 2,
    toVersion: 3,
    fromFingerprintHash: todoFixtureV2FingerprintHash,
    toFingerprintHash: todoFixtureV3FingerprintHash,
    migrateState(input) {
        return migrateTodoFixtureStateV2ToV3(input as TodoFixtureStateV2);
    },
    migratePatch(input) {
        return migrateTodoFixturePatchV2ToV3(input as Patch<TodoFixtureStateV2>);
    },
    migrateCrdtUpdate(input) {
        return migrateTodoFixtureCrdtUpdateV2ToV3(input);
    },
};

export const todoFixtureMigrationConfig: SchemaMigrationConfig<TodoFixtureStateV2> = {
    current: todoFixtureV2Metadata,
    previous: [todoFixtureV1Metadata],
    migrations: [todoFixtureMigration],
};

export const todoFixtureV3MigrationConfig: SchemaMigrationConfig<TodoFixtureStateV3> = {
    current: todoFixtureV3Metadata,
    previous: [todoFixtureV1Metadata, todoFixtureV2Metadata],
    migrations: [todoFixtureMigration, todoFixtureV2ToV3Migration],
};

export const todoFixtureInitialV1: TodoFixtureStateV1 = {
    bgcolor: '#fff',
    legacyFilter: 'all',
    todos: [
        {id: 'one', text: 'Write README', done: true, archived: false},
        {id: 'two', text: 'Try CRDT sync', done: false},
    ],
};

export const todoFixtureInitialV3: TodoFixtureStateV3 = {
    bgcolor: '#eef2ff',
    view: 'active',
    todos: [
        {
            id: 'future-one',
            title: 'Future schema item',
            done: false,
            priority: 'high',
            notes: 'Requires a client that understands the v3 notes field.',
        },
        {
            id: 'future-two',
            title: 'Client upgrade prompt',
            done: false,
            priority: 'normal',
            notes: 'Seeded ahead of the current migration fixture client.',
        },
    ],
};

export const todoFixtureInitialV1MigratedToV3: TodoFixtureStateV3 =
    migrateTodoFixtureStateV2ToV3(migrateTodoFixtureState(todoFixtureInitialV1));

export function createTodoFixtureHistoryV1(): History<TodoFixtureStateV1, never> {
    const current: TodoFixtureStateV1 = {
        bgcolor: '#fff',
        legacyFilter: 'done',
        todos: [
            {id: 'one', text: 'Write migration plan', done: true, archived: true},
            {id: 'two', text: 'Try CRDT sync', done: false},
            {id: 'three', text: 'Ship fixture', done: false},
        ],
    };
    return {
        version: 2,
        initial: todoFixtureInitialV1,
        current,
        root: 'root',
        tip: 'edit-1',
        undoTrail: [],
        annotations: {},
        nodes: {
            root: {id: 'root', pid: 'root', children: ['edit-1'], changes: []},
            'edit-1': {
                id: 'edit-1',
                pid: 'root',
                children: [],
                changes: [
                    {
                        op: 'replace',
                        path: [
                            {type: 'key', key: 'todos'},
                            {type: 'key', key: 0},
                            {type: 'key', key: 'text'},
                        ],
                        previous: 'Write README',
                        value: 'Write migration plan',
                    },
                    {
                        op: 'replace',
                        path: [
                            {type: 'key', key: 'todos'},
                            {type: 'key', key: 0},
                            {type: 'key', key: 'archived'},
                        ],
                        previous: false,
                        value: true,
                    },
                    {
                        op: 'replace',
                        path: [{type: 'key', key: 'legacyFilter'}],
                        previous: 'all',
                        value: 'done',
                    },
                    {
                        op: 'add',
                        path: [
                            {type: 'key', key: 'todos'},
                            {type: 'key', key: 2},
                        ],
                        value: {id: 'three', text: 'Ship fixture', done: false},
                    },
                ],
            },
        },
    };
}

export function createTodoFixtureCrdtHistoryV1(): CrdtLocalHistory<TodoFixtureStateV1> {
    const base = createTodoFixtureDocumentV1();
    const updates = createTodoFixtureCrdtUpdatesV1(base);
    let doc = base;
    for (const update of updates) doc = applyCrdtUpdate(doc, update);
    return {
        base,
        doc,
        updates,
    };
}

export function createTodoFixtureDocumentV1(state = todoFixtureInitialV1): CrdtDocument<TodoFixtureStateV1> {
    return createCrdtDocument(state, todoFixtureV1Schema, {
        timestamp: todoFixtureTs('seed', 0),
        tagKey: TODO_FIXTURE_TAG_KEY,
    });
}

export function createTodoFixtureCrdtUpdatesV1(
    base = createTodoFixtureDocumentV1(),
): CrdtUpdate[] {
    const titleUpdate = createCrdtUpdates(
        base,
        {
            op: 'replace',
            path: [
                {type: 'key', key: 'todos'},
                {type: 'key', key: 0},
                {type: 'key', key: 'text'},
            ],
            previous: 'Write README',
            value: 'Write migration plan',
        },
        todoFixtureTs('local', 10),
    )[0];
    let doc = applyCrdtUpdate(base, titleUpdate);
    const archivedUpdate = createCrdtUpdates(
        doc,
        {
            op: 'replace',
            path: [
                {type: 'key', key: 'todos'},
                {type: 'key', key: 0},
                {type: 'key', key: 'archived'},
            ],
            previous: false,
            value: true,
        },
        todoFixtureTs('local', 11),
    )[0];
    doc = applyCrdtUpdate(doc, archivedUpdate);
    const addedTodoUpdate = createCrdtUpdates(
        doc,
        {
            op: 'add',
            path: [
                {type: 'key', key: 'todos'},
                {type: 'key', key: 2},
            ],
            value: {id: 'three', text: 'Ship fixture', done: false},
        },
        todoFixtureTs('local', 12),
    )[0];
    return [titleUpdate, archivedUpdate, addedTodoUpdate];
}

export function todoFixtureServerUpdateEventsV1() {
    return createTodoFixtureCrdtUpdatesV1().map((update, index) => {
        const hlcTimestamp = latestCrdtUpdateTimestamp(update);
        if (!hlcTimestamp) throw new Error('Expected fixture update timestamp.');
        return {
            kind: 'update' as const,
            docId: TODO_FIXTURE_DOC_ID_V1,
            branchId: 'main',
            eventIndex: index + 1,
            origin: 'fixture:local',
            hlcTimestamp,
            receivedAt: TODO_FIXTURE_MIGRATED_AT,
            update,
            recorded: true,
        };
    });
}

export function todoFixtureServerUpdateEventsV3({
    docId = TODO_FIXTURE_DOC_ID_V3,
    receivedAt = TODO_FIXTURE_MIGRATED_AT,
}: {
    docId?: string;
    receivedAt?: string;
} = {}) {
    const base = createCrdtDocument(todoFixtureInitialV3, todoFixtureV3Schema, {
        timestamp: todoFixtureTs('seed-v3', 0),
        tagKey: TODO_FIXTURE_TAG_KEY,
    });
    const update = createCrdtUpdates(
        base,
        {
            op: 'replace',
            path: [
                {type: 'key', key: 'todos'},
                {type: 'key', key: 1},
                {type: 'key', key: 'notes'},
            ],
            previous: 'Seeded ahead of the current migration fixture client.',
            value: 'Opening this document should require a newer client.',
        },
        todoFixtureTs('future', 10),
    )[0];
    const hlcTimestamp = latestCrdtUpdateTimestamp(update);
    if (!hlcTimestamp) throw new Error('Expected fixture update timestamp.');
    return [{
        kind: 'update' as const,
        docId,
        branchId: 'main',
        eventIndex: 1,
        origin: 'fixture:future',
        hlcTimestamp,
        receivedAt,
        update,
    }];
}

export function todoFixtureTs(node: string, value: number) {
    return `${String(value).padStart(15, '0')}:00000:${node}`;
}

export function migrateTodoFixtureState(input: TodoFixtureStateV1): TodoFixtureStateV2 {
    return {
        bgcolor: input.bgcolor,
        todos: input.todos.map(migrateTodoFixtureTodo),
    };
}

export function migrateTodoFixtureStateV2ToV3(input: TodoFixtureStateV2): TodoFixtureStateV3 {
    return {
        bgcolor: input.bgcolor,
        view: 'all',
        todos: input.todos.map(migrateTodoFixtureTodoV2ToV3),
    };
}

function migrateTodoFixturePatch(input: Patch<TodoFixtureStateV1>): Patch<TodoFixtureStateV2> | null {
    if (patchPathHasKey(input.path, 'legacyFilter') || patchPathHasKey(input.path, 'archived')) {
        return null;
    }
    return {
        ...input,
        path: input.path.map((segment) =>
            segment.type === 'key' && segment.key === 'text' ? {...segment, key: 'title'} : segment,
        ),
        ...patchValues(input),
    } as Patch<TodoFixtureStateV2>;
}

function migrateTodoFixtureCrdtUpdate(input: CrdtUpdate): CrdtUpdate | null {
    const path = input.op === 'setOrder' || input.op === 'insert' ? input.arrayPath : input.path;
    if (crdtPathHasField(path, 'legacyFilter') || crdtPathHasField(path, 'archived')) return null;
    if (input.op === 'setOrder') return input;
    if (input.op === 'insert') {
        return {
            ...input,
            arrayPath: migrateTodoFixtureCrdtPath(input.arrayPath),
            value: migrateUnknownValue(input.value) as JsonValue,
        };
    }
    const migratedPath = migrateTodoFixtureCrdtPath(input.path);
    if (input.op === 'set') {
        return {
            ...input,
            path: migratedPath,
            value: migrateUnknownValue(input.value) as JsonValue,
        };
    }
    return {
        ...input,
        path: migratedPath,
    };
}

function migrateTodoFixturePatchV2ToV3(input: Patch<TodoFixtureStateV2>): Patch<TodoFixtureStateV3> {
    return {
        ...input,
        ...patchValuesV2ToV3(input),
    } as Patch<TodoFixtureStateV3>;
}

function migrateTodoFixtureCrdtUpdateV2ToV3(input: CrdtUpdate): CrdtUpdate {
    if (input.op === 'setOrder' || input.op === 'delete') return input;
    if (input.op === 'insert') {
        return {
            ...input,
            value: migrateUnknownValueV2ToV3(input.value) as JsonValue,
        };
    }
    return {
        ...input,
        value: migrateUnknownValueV2ToV3(input.value) as JsonValue,
    };
}

function patchValues(input: Patch<TodoFixtureStateV1>) {
    switch (input.op) {
        case 'add':
        case 'remove':
            return {value: migrateUnknownValue(input.value)};
        case 'replace':
            return {
                previous: migrateUnknownValue(input.previous),
                value: migrateUnknownValue(input.value),
            };
        case 'move':
        case 'reorder':
            return {};
    }
}

function patchValuesV2ToV3(input: Patch<TodoFixtureStateV2>) {
    switch (input.op) {
        case 'add':
        case 'remove':
            return {value: migrateUnknownValueV2ToV3(input.value)};
        case 'replace':
            return {
                previous: migrateUnknownValueV2ToV3(input.previous),
                value: migrateUnknownValueV2ToV3(input.value),
            };
        case 'move':
        case 'reorder':
            return {};
    }
}

function migrateUnknownValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(migrateUnknownValue);
    if (!isRecord(value)) return value;
    if (isTodoFixtureStateV1(value)) return migrateTodoFixtureState(value);
    if (isTodoFixtureTodoV1(value)) return migrateTodoFixtureTodo(value);
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === 'archived' || key === 'legacyFilter') continue;
        next[key === 'text' ? 'title' : key] = migrateUnknownValue(child);
    }
    return next;
}

function migrateUnknownValueV2ToV3(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(migrateUnknownValueV2ToV3);
    if (!isRecord(value)) return value;
    if (isTodoFixtureStateV2(value)) return migrateTodoFixtureStateV2ToV3(value);
    if (isTodoFixtureTodoV2(value)) return migrateTodoFixtureTodoV2ToV3(value);
    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, migrateUnknownValueV2ToV3(child)]),
    );
}

function migrateTodoFixtureTodo(input: TodoFixtureV1): TodoFixtureV2 {
    return {
        id: input.id,
        title: input.text,
        done: input.done,
        priority: 'normal',
    };
}

function migrateTodoFixtureTodoV2ToV3(input: TodoFixtureV2): TodoFixtureV3 {
    return {
        id: input.id,
        title: input.title,
        done: input.done,
        priority: input.priority,
        notes: '',
    };
}

function validateTodoFixtureV1(input: unknown): IValidation<TodoFixtureStateV1> {
    return isTodoFixtureStateV1(input)
        ? {success: true, data: input}
        : {success: false, data: input, errors: []};
}

function validateTodoFixtureV2(input: unknown): IValidation<TodoFixtureStateV2> {
    return isTodoFixtureStateV2(input)
        ? {success: true, data: input}
        : {success: false, data: input, errors: []};
}

function validateTodoFixtureV3(input: unknown): IValidation<TodoFixtureStateV3> {
    return isTodoFixtureStateV3(input)
        ? {success: true, data: input}
        : {success: false, data: input, errors: []};
}

function isTodoFixtureStateV1(input: unknown): input is TodoFixtureStateV1 {
    return (
        isRecord(input) &&
        typeof input.bgcolor === 'string' &&
        (input.legacyFilter === undefined || typeof input.legacyFilter === 'string') &&
        Array.isArray(input.todos) &&
        input.todos.every(isTodoFixtureTodoV1)
    );
}

function isTodoFixtureStateV2(input: unknown): input is TodoFixtureStateV2 {
    return (
        isRecord(input) &&
        typeof input.bgcolor === 'string' &&
        Array.isArray(input.todos) &&
        input.todos.every(isTodoFixtureTodoV2)
    );
}

function isTodoFixtureStateV3(input: unknown): input is TodoFixtureStateV3 {
    return (
        isRecord(input) &&
        typeof input.bgcolor === 'string' &&
        (input.view === 'all' || input.view === 'active' || input.view === 'done') &&
        Array.isArray(input.todos) &&
        input.todos.every(isTodoFixtureTodoV3)
    );
}

function isTodoFixtureTodoV1(input: unknown): input is TodoFixtureV1 {
    return (
        isRecord(input) &&
        typeof input.id === 'string' &&
        typeof input.text === 'string' &&
        typeof input.done === 'boolean' &&
        (input.archived === undefined || typeof input.archived === 'boolean')
    );
}

function isTodoFixtureTodoV2(input: unknown): input is TodoFixtureV2 {
    return (
        isRecord(input) &&
        typeof input.id === 'string' &&
        typeof input.title === 'string' &&
        typeof input.done === 'boolean' &&
        (input.priority === 'normal' || input.priority === 'high')
    );
}

function isTodoFixtureTodoV3(input: unknown): input is TodoFixtureV3 {
    return (
        isTodoFixtureTodoV2(input) &&
        isRecord(input) &&
        typeof (input as Record<string, unknown>).notes === 'string'
    );
}

function isRecord(input: unknown): input is Record<string, unknown> {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function fixtureSchemaFingerprint<TState>(schema: IJsonSchemaCollection<'3.1', [TState]>) {
    return stableStringify({
        root: schema.schemas[0],
        components: schema.components,
        tagKey: TODO_FIXTURE_TAG_KEY,
    });
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

function patchPathHasKey(path: Patch<unknown>['path'], key: string) {
    return path.some((segment) => segment.type === 'key' && segment.key === key);
}

function migrateTodoFixtureCrdtPath(path: CrdtPathSegment[]) {
    return path.map((segment) =>
        segment.type === 'objectField' && segment.key === 'text'
            ? {...segment, key: 'title'}
            : segment,
    );
}

function crdtPathHasField(path: CrdtPathSegment[], key: string) {
    return path.some((segment) => segment.type === 'objectField' && segment.key === key);
}
