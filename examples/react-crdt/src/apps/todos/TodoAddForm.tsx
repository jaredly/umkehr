import {useState} from 'react';
import type {AppEditorContext} from '../../lib/crdtApp';
import type {TodoState} from './model';

export function TodoAddForm({
    editor,
    replicaId,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    replicaId: string;
    readOnly: boolean;
}) {
    const [draftTitle, setDraftTitle] = useState('');

    return (
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
    );
}
