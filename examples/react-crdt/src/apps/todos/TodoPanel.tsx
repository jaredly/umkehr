import {useState} from 'react';
import {useValue} from 'umkehr/react';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {TodoColorPicker} from './TodoColorPicker';
import {UndoRedoButtons} from './TodoHistoryControls';
import {TodoList} from './TodoList';
import type {TodoState} from './model';

export function TodoPanel({
    editor,
    replicaId,
    title,
    gridSlot = 'full',
    readOnly = false,
}: {
    editor: AppEditorContext<TodoState>;
    replicaId: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);
    const [draftTitle, setDraftTitle] = useState('');

    return (
        <section
            className={`todoPanel ${
                gridSlot === 'left' ? 'leftPanel' : gridSlot === 'right' ? 'rightPanel' : ''
            }`}
        >
            <header className="panelHeader">
                <div>
                    <h1>{title}</h1>
                    <TodoSummary editor={editor} />
                </div>
                <div className="panelActions">
                    <UndoRedoButtons editor={editor} readOnly={readOnly} />
                </div>
            </header>

            <TodoColorPicker editor={editor} readOnly={readOnly} />

            <form
                className="addForm"
                onSubmit={(event) => {
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
                }}
            >
                <input
                    value={draftTitle}
                    placeholder="New todo"
                    onChange={(event) => setDraftTitle(event.target.value)}
                    disabled={readOnly}
                />
                <button type="submit" disabled={readOnly}>
                    Add
                </button>
            </form>

            <TodoList editor={editor} bgcolor={bgcolor} readOnly={readOnly} />
        </section>
    );
}

function TodoSummary({editor}: {editor: AppEditorContext<TodoState>}) {
    const summary = useValue(editor.$.todos, (todos) => ({
        completed: todos.filter((todo) => todo.done).length,
        total: todos.length,
    }));
    return (
        <p>
            {summary.completed}/{summary.total} done
        </p>
    );
}
