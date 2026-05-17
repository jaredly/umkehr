import {useMemo, useState} from 'react';
import {$, type GridSlot, type ReplicaId, type State, type Todo, type TodoDraft} from './model';

export function TodoPanel({
    replicaId,
    title,
    state,
    queued,
    canUndo,
    canRedo,
    applyLocal,
    onUndo,
    onRedo,
    gridSlot,
}: {
    replicaId: ReplicaId;
    title: string;
    state: State;
    queued: number;
    canUndo: boolean;
    canRedo: boolean;
    applyLocal: (draft: TodoDraft) => void;
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
                    applyLocal(
                        $.todos.$push({
                            id: `${replicaId}-${crypto.randomUUID()}`,
                            title: next,
                            done: false,
                        }),
                    );
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
                        applyLocal={applyLocal}
                        onToggleTodo={$.todos[index].done.$replace}
                        onRenameTodo={$.todos[index].title.$replace}
                        onDeleteTodo={$.todos[index].$remove}
                    />
                ))}
            </ul>
        </section>
    );
}

function TodoItem({
    todo,
    applyLocal,
    onToggleTodo,
    onRenameTodo,
    onDeleteTodo,
}: {
    todo: Todo;
    applyLocal: (draft: TodoDraft) => void;
    onToggleTodo: (done: boolean) => TodoDraft;
    onRenameTodo: (title: string) => TodoDraft;
    onDeleteTodo: () => TodoDraft;
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
        applyLocal(onRenameTodo(next));
    };

    return (
        <li className={todo.done ? 'todoItem done' : 'todoItem'}>
            <label>
                <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => applyLocal(onToggleTodo(event.target.checked))}
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
                <button type="button" onClick={() => applyLocal(onDeleteTodo())}>
                    Delete
                </button>
            </div>
        </li>
    );
}
