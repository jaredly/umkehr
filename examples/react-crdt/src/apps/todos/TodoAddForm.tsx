import {useState} from 'react';
import type {AppEditorContext} from '../../lib/crdtApp';
import type {TodoState} from './model';

export function TodoAddFormView({
    draftTitle,
    placeholder = 'New todo',
    readOnly,
    onDraftTitleChange,
    onSubmit,
}: {
    draftTitle: string;
    placeholder?: string;
    readOnly: boolean;
    onDraftTitleChange(value: string): void;
    onSubmit(): void;
}) {
    return (
        <form
            className="addForm"
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
        >
            <input
                value={draftTitle}
                placeholder={placeholder}
                onChange={(event) => onDraftTitleChange(event.target.value)}
                disabled={readOnly}
            />
            <button type="submit" disabled={readOnly}>
                Add
            </button>
        </form>
    );
}

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
        <TodoAddFormView
            draftTitle={draftTitle}
            readOnly={readOnly}
            onDraftTitleChange={setDraftTitle}
            onSubmit={() => {
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
        />
    );
}
