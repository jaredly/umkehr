import {useValue} from 'umkehr/react';
import type {AppEditorContext} from '../../lib/crdtApp';
import type {TodoState} from './model';

export function TodoSummary({editor}: {editor: AppEditorContext<TodoState>}) {
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
