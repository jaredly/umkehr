import {useState, type CSSProperties} from 'react';
import {createHistoryContext, useValue, type Updater} from 'umkehr/react';
import {createSyncedContext} from 'umkehr/react-crdt';
import type {
    AppDefinition,
    AppEditorContext,
    CrdtRuntime,
    GridSlot,
    HistoryRuntime,
} from '../../lib/crdtApp';
import {
    TODO_FIXTURE_DOC_ID_V1,
    TODO_FIXTURE_DOC_ID_V3,
    TODO_FIXTURE_TAG_KEY,
    todoFixtureInitialV1,
    todoFixtureInitialV1MigratedToV3,
    todoFixtureV1Metadata,
    todoFixtureV3Metadata,
    type TodoFixtureV1,
    type TodoFixtureV3,
    type TodoFixtureStateV1,
    type TodoFixtureStateV3,
} from '../../../../migration-fixtures/todos';
import {TodoAddFormView} from './TodoAddForm';
import {TodoItemView} from './TodoItem';

const [ProvideTodosV1History, useTodosV1History] =
    createHistoryContext<TodoFixtureStateV1, never, 'type'>('type');
const [ProvideTodosV1, useTodosV1] = createSyncedContext<TodoFixtureStateV1>('type');

const [ProvideTodosV3History, useTodosV3History] =
    createHistoryContext<TodoFixtureStateV3, never, 'type'>('type');
const [ProvideTodosV3, useTodosV3] = createSyncedContext<TodoFixtureStateV3>('type');

export const todoV1App: AppDefinition<TodoFixtureStateV1> = {
    id: 'todos',
    title: 'Todos v1',
    schemaVersion: todoFixtureV1Metadata.version,
    tagKey: TODO_FIXTURE_TAG_KEY,
    schema: todoFixtureV1Metadata.schema,
    validateState: todoFixtureV1Metadata.validateState,
    initialState: todoFixtureInitialV1,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <TodoV1Panel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

export const todoV1CrdtRuntime: CrdtRuntime<TodoFixtureStateV1> = {
    docId: TODO_FIXTURE_DOC_ID_V1,
    Provider: ProvideTodosV1,
    useEditorContext: useTodosV1,
};

export const todoV1HistoryRuntime: HistoryRuntime<TodoFixtureStateV1> = {
    Provider: ProvideTodosV1History,
    useEditorContext: useTodosV1History,
};

export const todoV3App: AppDefinition<TodoFixtureStateV3> = {
    id: 'todos',
    title: 'Todos v3',
    schemaVersion: todoFixtureV3Metadata.version,
    tagKey: TODO_FIXTURE_TAG_KEY,
    schema: todoFixtureV3Metadata.schema,
    validateState: todoFixtureV3Metadata.validateState,
    initialState: todoFixtureInitialV1MigratedToV3,
    renderPanel({editor, actor, title, gridSlot, readOnly}) {
        return (
            <TodoV3Panel
                editor={editor}
                actor={actor}
                title={title}
                gridSlot={gridSlot}
                readOnly={readOnly}
            />
        );
    },
};

export const todoV3CrdtRuntime: CrdtRuntime<TodoFixtureStateV3> = {
    docId: TODO_FIXTURE_DOC_ID_V3,
    Provider: ProvideTodosV3,
    useEditorContext: useTodosV3,
};

export const todoV3HistoryRuntime: HistoryRuntime<TodoFixtureStateV3> = {
    Provider: ProvideTodosV3History,
    useEditorContext: useTodosV3History,
};

function TodoV1Panel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<TodoFixtureStateV1>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const legacyFilter = useValue(editor.$.legacyFilter);
    const todos = useValue(editor.$.todos);
    const todoIds = useValue(editor.$.todos, (items) => items.map((todo) => todo.id));

    return (
        <section className={`todoPanel ${panelSlotClass(gridSlot)}`}>
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {todos.filter((todo) => todo.done).length}/{todos.length} done
                        {legacyFilter ? `, filter: ${legacyFilter}` : ''}
                    </p>
                </div>
            </header>
            <VersionTodoAddForm
                readOnly={readOnly}
                onAdd={(title) => {
                    editor.$.todos.$push({
                        id: `${actor}-${crypto.randomUUID()}`,
                        text: title,
                        done: false,
                        archived: false,
                    });
                }}
            />
            <ul className="todoList" style={{'--task-bg': bgcolor} as CSSProperties}>
                {todoIds.map((id, index) => (
                    <TodoV1ItemSlot
                        key={id}
                        path={editor.$.todos[index]}
                        readOnly={readOnly}
                    />
                ))}
            </ul>
        </section>
    );
}

function TodoV3Panel({
    editor,
    actor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<TodoFixtureStateV3>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const view = useValue(editor.$.view);
    const todos = useValue(editor.$.todos);
    const todoIds = useValue(editor.$.todos, (items) => items.map((todo) => todo.id));

    return (
        <section className={`todoPanel ${panelSlotClass(gridSlot)}`}>
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {todos.filter((todo) => todo.done).length}/{todos.length} done, view: {view}
                    </p>
                </div>
            </header>
            <VersionTodoAddForm
                readOnly={readOnly}
                onAdd={(title) => {
                    editor.$.todos.$push({
                        id: `${actor}-${crypto.randomUUID()}`,
                        title,
                        done: false,
                        priority: 'normal',
                        notes: '',
                    });
                }}
            />
            <ul className="todoList" style={{'--task-bg': bgcolor} as CSSProperties}>
                {todoIds.map((id, index) => (
                    <TodoV3ItemSlot
                        key={id}
                        path={editor.$.todos[index]}
                        readOnly={readOnly}
                    />
                ))}
            </ul>
        </section>
    );
}

function VersionTodoAddForm({
    readOnly,
    onAdd,
}: {
    readOnly: boolean;
    onAdd(title: string): void;
}) {
    const [draftTitle, setDraftTitle] = useState('');

    return (
        <TodoAddFormView
            draftTitle={draftTitle}
            readOnly={readOnly}
            onDraftTitleChange={setDraftTitle}
            onSubmit={() => {
                const next = draftTitle.trim();
                if (readOnly || !next) return;
                onAdd(next);
                setDraftTitle('');
            }}
        />
    );
}

function TodoV1ItemSlot({
    path,
    readOnly,
}: {
    path: Updater<TodoFixtureV1>;
    readOnly: boolean;
}) {
    const todo = useValue(path) as TodoFixtureV1 | undefined;
    if (!todo) return null;

    return (
        <TodoItemView
            id={todo.id}
            title={todo.text}
            done={todo.done}
            titleSuffix={todo.archived ? <span className="todoTitleMeta"> (archived)</span> : null}
            readOnly={readOnly}
            onDoneChange={(next) => {
                if (readOnly) return;
                path.done(next);
            }}
            onTitleCommit={(next) => {
                if (readOnly || next === todo.text) return;
                path.text(next);
            }}
            onDelete={() => {
                if (readOnly) return;
                path.$remove();
            }}
            extraActions={
                <label className="todoExtraControl">
                    <input
                        type="checkbox"
                        checked={todo.archived ?? false}
                        onChange={(event) => {
                            if (readOnly) return;
                            path.archived(event.target.checked);
                        }}
                        disabled={readOnly}
                    />
                    <span>Archived</span>
                </label>
            }
        />
    );
}

function TodoV3ItemSlot({
    path,
    readOnly,
}: {
    path: Updater<TodoFixtureV3>;
    readOnly: boolean;
}) {
    const todo = useValue(path) as TodoFixtureV3 | undefined;
    if (!todo) return null;

    return (
        <TodoItemView
            id={todo.id}
            title={todo.title}
            done={todo.done}
            titleSuffix={<span className="todoTitleMeta"> [{todo.priority}]</span>}
            readOnly={readOnly}
            onDoneChange={(next) => {
                if (readOnly) return;
                path.done(next);
            }}
            onTitleCommit={(next) => {
                if (readOnly || next === todo.title) return;
                path.title(next);
            }}
            onDelete={() => {
                if (readOnly) return;
                path.$remove();
            }}
            details={
                <input
                    className="todoNotesInput"
                    value={todo.notes}
                    aria-label={`Notes for ${todo.title}`}
                    placeholder="Notes"
                    onChange={(event) => {
                        if (readOnly) return;
                        path.notes(event.target.value);
                    }}
                    disabled={readOnly}
                />
            }
            extraActions={
                <label className="todoExtraControl">
                    <span>Priority</span>
                    <select
                        className="todoPrioritySelect"
                        value={todo.priority}
                        onChange={(event) => {
                            if (readOnly) return;
                            path.priority(event.target.value as TodoFixtureV3['priority']);
                        }}
                        disabled={readOnly}
                    >
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                    </select>
                </label>
            }
        />
    );
}

function panelSlotClass(gridSlot: GridSlot | 'full') {
    if (gridSlot === 'left') return 'leftPanel';
    if (gridSlot === 'right') return 'rightPanel';
    return '';
}
