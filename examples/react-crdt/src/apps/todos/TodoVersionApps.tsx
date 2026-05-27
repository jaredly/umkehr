import type {CSSProperties} from 'react';
import {createHistoryContext, useValue} from 'umkehr/react';
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
    todoFixtureInitialV3,
    todoFixtureV1Metadata,
    todoFixtureV3Metadata,
    type TodoFixtureStateV1,
    type TodoFixtureStateV3,
} from '../../../../migration-fixtures/todos';

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
    renderPanel({editor, title, gridSlot, readOnly}) {
        return (
            <TodoV1Panel
                editor={editor}
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
    initialState: todoFixtureInitialV3,
    renderPanel({editor, title, gridSlot, readOnly}) {
        return (
            <TodoV3Panel
                editor={editor}
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
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<TodoFixtureStateV1>;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const legacyFilter = useValue(editor.$.legacyFilter);
    const todos = useValue(editor.$.todos);

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
            <ul className="todoList" style={{'--task-bg': bgcolor} as CSSProperties}>
                {todos.map((todo) => (
                    <li key={todo.id} className={todo.done ? 'todoItem done' : 'todoItem'}>
                        <span className="dragHandleSpacer" aria-hidden="true" />
                        <label>
                            <input type="checkbox" checked={todo.done} readOnly disabled={readOnly} />
                            <span className="todoTitle">
                                {todo.text}
                                {todo.archived ? ' (archived)' : ''}
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function TodoV3Panel({
    editor,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<TodoFixtureStateV3>;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const view = useValue(editor.$.view);
    const todos = useValue(editor.$.todos);

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
            <ul className="todoList" style={{'--task-bg': bgcolor} as CSSProperties}>
                {todos.map((todo) => (
                    <li key={todo.id} className={todo.done ? 'todoItem done' : 'todoItem'}>
                        <span className="dragHandleSpacer" aria-hidden="true" />
                        <label>
                            <input type="checkbox" checked={todo.done} readOnly disabled={readOnly} />
                            <span className="todoTitle">
                                {todo.title} [{todo.priority}]
                            </span>
                        </label>
                        <div className="itemActions">
                            <span className="presenceEmpty">{todo.notes}</span>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function panelSlotClass(gridSlot: GridSlot | 'full') {
    if (gridSlot === 'left') return 'leftPanel';
    if (gridSlot === 'right') return 'rightPanel';
    return '';
}
