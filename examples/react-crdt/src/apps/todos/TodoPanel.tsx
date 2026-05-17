import {useMemo, useState, type CSSProperties} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import type {Todo, TodoState} from './model';

const pastelColors = ['#fff', '#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe'] as const;

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
    const bgcolor = useValue(editor.$.bgcolor);
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

            <section
                className="colorPicker"
                aria-label="Task background color"
                onMouseLeave={() => editor.clearPreview()}
            >
                {pastelColors.map((color) => (
                    <button
                        key={color}
                        type="button"
                        className={color === bgcolor ? 'swatch selected' : 'swatch'}
                        style={{backgroundColor: color}}
                        title={color}
                        aria-label={`Use ${color}`}
                        onClick={() => editor.$.bgcolor(color)}
                        onMouseEnter={() => editor.$.bgcolor(color, 'preview')}
                    />
                ))}
            </section>

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

            <ul className="todoList" style={{'--task-bg': bgcolor} as CSSProperties}>
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
    const [editingTitle, setEditingTitle] = useState<null | string>(null);

    const commit = () => {
        if (editingTitle === null) return;
        const next = editingTitle.trim();
        setEditingTitle(null);
        if (!next || next === todo.title) {
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
                {editingTitle !== null ? (
                    <input
                        className="titleInput"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                            if (event.key === 'Escape') {
                                setEditingTitle(null);
                            }
                        }}
                        autoFocus
                    />
                ) : (
                    <span className="todoTitle">{todo.title}</span>
                )}
            </label>
            <div className="itemActions">
                <button type="button" onClick={() => setEditingTitle(todo.title)}>
                    Edit
                </button>
                <button type="button" onClick={() => editor.$.todos[index].$remove()}>
                    Delete
                </button>
            </div>
        </li>
    );
}
