import {useState, type CSSProperties, type FormEvent} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import type {TodoFixtureStateV2} from '../../../../migration-fixtures/todos';

export function TodoMigrationFixturePanel({
    editor,
    replicaId,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<TodoFixtureStateV2>;
    replicaId: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const todos = useValue(editor.$.todos);
    const [draftTitle, setDraftTitle] = useState('');

    function addTodo(event: FormEvent) {
        event.preventDefault();
        const next = draftTitle.trim();
        if (readOnly || !next) return;
        editor.$.todos.$push({
            id: `${replicaId}-${crypto.randomUUID()}`,
            title: next,
            done: false,
            priority: 'normal',
        });
        setDraftTitle('');
    }

    return (
        <section
            className={`todoPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
        >
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {todos.filter((todo) => todo.done).length}/{todos.length} done
                    </p>
                </div>
            </header>
            <form className="addForm" onSubmit={addTodo}>
                <input
                    value={draftTitle}
                    placeholder="New todo"
                    onChange={(event) => setDraftTitle(event.currentTarget.value)}
                    disabled={readOnly}
                />
                <button type="submit" disabled={readOnly}>
                    Add
                </button>
            </form>
            <ul className="todoList" style={{'--task-bg': bgcolor} as CSSProperties}>
                {todos.map((todo, index) => (
                    <TodoMigrationFixtureItem
                        key={todo.id}
                        todo={todo}
                        setTitle={(nextTitle) => editor.$.todos[index].title(nextTitle)}
                        setDone={(done) => editor.$.todos[index].done(done)}
                        remove={() => editor.$.todos[index].$remove()}
                        readOnly={readOnly}
                    />
                ))}
            </ul>
        </section>
    );
}

function TodoMigrationFixtureItem({
    todo,
    setTitle,
    setDone,
    remove,
    readOnly,
}: {
    todo: TodoFixtureStateV2['todos'][number];
    setTitle(title: string): void;
    setDone(done: boolean): void;
    remove(): void;
    readOnly: boolean;
}) {
    const [editingTitle, setEditingTitle] = useState<null | string>(null);

    function commit() {
        if (editingTitle === null) return;
        const next = editingTitle.trim();
        setEditingTitle(null);
        if (!readOnly && next && next !== todo.title) setTitle(next);
    }

    return (
        <li className={todo.done ? 'todoItem done' : 'todoItem'}>
            <span className="dragHandleSpacer" aria-hidden="true" />
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => setDone(event.currentTarget.checked)}
                    disabled={readOnly}
                />
                {editingTitle !== null ? (
                    <input
                        className="titleInput"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.currentTarget.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') setEditingTitle(null);
                        }}
                        autoFocus
                        disabled={readOnly}
                    />
                ) : (
                    <span className="todoTitle">{todo.title}</span>
                )}
            </label>
            <div className="itemActions">
                <button type="button" onClick={() => setEditingTitle(todo.title)} disabled={readOnly}>
                    Edit
                </button>
                <button type="button" onClick={remove} disabled={readOnly}>
                    Delete
                </button>
            </div>
        </li>
    );
}
