import {useState} from 'react';
import {
    createInitialHistory,
    withDisabledEphemeral,
    type AppDefinition,
    type HistoryRuntime,
} from '../crdtApp';
import {HistoryView} from './HistoryView';

export function SoloApp<TState, TAnnotations = never, EphemeralData = never>({
    app,
    runtime,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: HistoryRuntime<TState, TAnnotations>;
}) {
    const [initialHistory] = useState(() => createInitialHistory<TState, TAnnotations>(app));
    const {Provider} = runtime;

    return (
        <main className="soloShell">
            <Provider initial={initialHistory}>
                <SoloDocument app={app} runtime={runtime} />
            </Provider>
        </main>
    );
}

function SoloDocument<TState, TAnnotations, EphemeralData>({
    app,
    runtime,
}: {
    app: AppDefinition<TState, EphemeralData>;
    runtime: HistoryRuntime<TState, TAnnotations>;
}) {
    const editor = runtime.useEditorContext();
    const history = editor.useHistory();

    return (
        <div>
            <HistoryView
                history={history}
                jump={(id) => editor.dispatch({op: 'jump', id})}
                previewJump={(id) => editor.previewJump(id)}
                clearPreview={() => editor.clearPreview()}
            />
            {app.renderPanel({
                actor: 'solo',
                editor: withDisabledEphemeral<TState, typeof editor, EphemeralData>(editor),
                title: app.title,
            })}
        </div>
    );
}
