import {useMemo, useState} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import type {Todo, TodoState} from './model';

export function TodoPanel({
    editor,
    replicaId,
    title,
    gridSlot = 'full',
}: {
    editor: AppEditorContext<TodoState>;
    replicaId: string;
    title: string;
    gridSlot?: GridSlot | 'full';
}) {
    const todos = useValue(editor.$.todos);
    const [draftTitle, setDraftTitle] = useState('');
    const completed = useMemo(() => todos.filter((todo) => todo.done).length, [todos]);

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
                        {completed}/{todos.length} done
                    </p>
                </div>
                <div className="panelActions">
                    <button type="button" onClick={() => editor.undo()} disabled={!editor.canUndo()}>
                        Undo
                    </button>
                    <button type="button" onClick={() => editor.redo()} disabled={!editor.canRedo()}>
                        Redo
                    </button>
                </div>
            </header>

            <form
                className="addForm"
                onSubmit={(event) => {
                    event.preventDefault();
                    const next = draftTitle.trim();
                    if (!next) return;
                    editor.$.todos.$push({
                        id: `${replicaId}-${crypto.randomUUID()}`,
                        title: next,
                        done: false,
                    });
                    setDraftTitle('');
                }}
            >
                <input
                    value={draftTitle}
                    placeholder="New todo"
                    onChange={(event) => setDraftTitle(event.target.value)}
                />
                <button type="submit">Add</button>
            </form>

            <ul className="todoList">
                {todos.map((todo, index) => (
                    <TodoItem key={todo.id} editor={editor} todo={todo} index={index} />
                ))}
            </ul>
        </section>
    );
}

function TodoItem({
    editor,
    todo,
    index,
}: {
    editor: AppEditorContext<TodoState>;
    todo: Todo;
    index: number;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [title, setTitle] = useState(todo.title);

    const commit = () => {
        const next = title.trim();
        setIsEditing(false);
        if (!next || next === todo.title) {
            setTitle(todo.title);
            return;
        }
        editor.$.todos[index].title(next);
    };

    return (
        <li className={todo.done ? 'todoItem done' : 'todoItem'}>
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => editor.$.todos[index].done(event.target.checked)}
                />
                {isEditing ? (
                    <input
                        className="titleInput"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                                setTitle(todo.title);
                                setIsEditing(false);
                            }
                        }}
                        autoFocus
                    />
                ) : (
                    <span className="todoTitle">{todo.title}</span>
                )}
            </label>
            <div className="itemActions">
                <button type="button" onClick={() => setIsEditing(true)}>
                    Edit
                </button>
                <button type="button" onClick={() => editor.$.todos[index].$remove()}>
                    Delete
                </button>
            </div>
        </li>
    );
}
