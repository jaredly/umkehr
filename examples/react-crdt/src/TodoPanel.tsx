import {useMemo, useState} from 'react';
import type {GridSlot, State, Todo} from './model';

export function TodoPanel({
    title,
    state,
    queued,
    canUndo,
    canRedo,
    onAddTodo,
    onToggleTodo,
    onRenameTodo,
    onDeleteTodo,
    onUndo,
    onRedo,
    gridSlot,
}: {
    title: string;
    state: State;
    queued: number;
    canUndo: boolean;
    canRedo: boolean;
    onAddTodo: (title: string) => void;
    onToggleTodo: (index: number, done: boolean) => void;
    onRenameTodo: (index: number, title: string) => void;
    onDeleteTodo: (index: number) => void;
    onUndo: () => void;
    onRedo: () => void;
    gridSlot: GridSlot;
}) {
    const [draftTitle, setDraftTitle] = useState('');
    const completed = useMemo(() => state.todos.filter((todo) => todo.done).length, [state.todos]);

    return (
        <section className={`todoPanel ${gridSlot === 'left' ? 'leftPanel' : 'rightPanel'}`}>
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <p>
                        {completed}/{state.todos.length} done
                    </p>
                </div>
                <div className="panelActions">
                    <button type="button" onClick={onUndo} disabled={!canUndo}>
                        Undo
                    </button>
                    <button type="button" onClick={onRedo} disabled={!canRedo}>
                        Redo
                    </button>
                    <span className="queuedBadge">{queued} queued</span>
                </div>
            </header>

            <form
                className="addForm"
                onSubmit={(event) => {
                    event.preventDefault();
                    const next = draftTitle.trim();
                    if (!next) return;
                    onAddTodo(next);
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
                {state.todos.map((todo, index) => (
                    <TodoItem
                        key={todo.id}
                        todo={todo}
                        index={index}
                        onToggleTodo={onToggleTodo}
                        onRenameTodo={onRenameTodo}
                        onDeleteTodo={onDeleteTodo}
                    />
                ))}
            </ul>
        </section>
    );
}

function TodoItem({
    todo,
    index,
    onToggleTodo,
    onRenameTodo,
    onDeleteTodo,
}: {
    todo: Todo;
    index: number;
    onToggleTodo: (index: number, done: boolean) => void;
    onRenameTodo: (index: number, title: string) => void;
    onDeleteTodo: (index: number) => void;
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
        onRenameTodo(index, next);
    };

    return (
        <li className={todo.done ? 'todoItem done' : 'todoItem'}>
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => onToggleTodo(index, event.target.checked)}
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
                <button type="button" onClick={() => onDeleteTodo(index)}>
                    Delete
                </button>
            </div>
        </li>
    );
}
