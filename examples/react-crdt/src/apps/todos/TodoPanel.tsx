import {useValue} from 'umkehr/react';
import type {AppEditorContext, GridSlot} from '../../lib/crdtApp';
import {TodoAddForm} from './TodoAddForm';
import {TodoColorPicker} from './TodoColorPicker';
import {UndoRedoButtons} from './TodoHistoryControls';
import {TodoList} from './TodoList';
import {TodoSummary} from './TodoSummary';
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

            <TodoAddForm editor={editor} replicaId={replicaId} readOnly={readOnly} />

            <TodoList editor={editor} bgcolor={bgcolor} readOnly={readOnly} />
        </section>
    );
}
