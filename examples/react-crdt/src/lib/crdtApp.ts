import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    blankHistory,
    type ApplyTiming,
    type DraftPatch,
    type History,
    type MaybeNested,
    type PatchBuilder,
} from 'umkehr';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    type CrdtLocalHistory,
    type HlcTimestamp,
} from 'umkehr/crdt';
import type {Context} from 'umkehr/react';
import type {SyncedTransport} from 'umkehr/react-crdt';
import type {StatusStore} from 'umkehr';
import type {ReactElement} from 'react';

export type GridSlot = 'left' | 'right';

export type AppEditorContext<TState, Tag extends string = 'type'> = {
    latest(): TState;
    clearPreview(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    $: PatchBuilder<TState, Tag, void, Context>;
    dispatch(v: MaybeNested<DraftPatch<TState, Tag, Context>>, when?: ApplyTiming): void;
};

export type CrdtEditorContext<TState, Tag extends string = 'type'> =
    AppEditorContext<TState, Tag> & {
        previewHistory(history: CrdtLocalHistory<TState> | null): void;
        useLocalHistory(): CrdtLocalHistory<TState>;
    };

export type HistoryEditorContext<TState, TAnnotations = never> = Omit<
    AppEditorContext<TState>,
    'dispatch'
> & {
    dispatch(
        v:
            | {op: 'undo' | 'redo'}
            | {op: 'jump'; id: string}
            | MaybeNested<DraftPatch<TState, 'type', Context>>,
        when?: ApplyTiming,
    ): void;
    useHistory(): History<TState, TAnnotations>;
    previewJump(id: string): void;
};

export type AppPanelProps<TState> = {
    editor: AppEditorContext<TState>;
    actor: string;
    title: string;
    gridSlot?: GridSlot | 'full';
    readOnly?: boolean;
    setPresenceSelection?(elementId: string | null): void;
};

export type SyncedProvider<TState> = (props: {
    children: ReactElement;
    initial: CrdtLocalHistory<TState>;
    transport: SyncedTransport;
    save?(history: CrdtLocalHistory<TState>): void;
    statuses?: StatusStore;
}) => ReactElement;

export type HistoryProvider<TState, TAnnotations> = (props: {
    children: ReactElement;
    initial: History<TState, TAnnotations>;
    save?(history: History<TState, TAnnotations>): void;
}) => ReactElement;

export type AppDefinition<TState> = {
    id: string;
    title: string;
    tagKey: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    validateState(input: unknown): IValidation<TState>;
    initialState: TState;
    initialTimestamp?: HlcTimestamp;
    renderPanel(props: AppPanelProps<TState>): ReactElement;
};

export type CrdtRuntime<TState> = {
    docId: string;
    Provider: SyncedProvider<TState>;
    useEditorContext(): CrdtEditorContext<TState>;
};

export type HistoryRuntime<TState, TAnnotations = never> = {
    Provider: HistoryProvider<TState, TAnnotations>;
    useEditorContext(): HistoryEditorContext<TState, TAnnotations>;
};

export type RegisteredApp<TState, TAnnotations = never> = {
    app: AppDefinition<TState>;
    crdt?: CrdtRuntime<TState>;
    history?: HistoryRuntime<TState, TAnnotations>;
};

const defaultInitialTimestamp = hlc.pack(hlc.init('seed', 0));

export function createInitialCrdtHistory<TState>(
    app: AppDefinition<TState>,
): CrdtLocalHistory<TState> {
    return createCrdtLocalHistory(
        createCrdtDocument(app.initialState, app.schema, {
            timestamp: app.initialTimestamp ?? defaultInitialTimestamp,
        }),
    );
}

export function createInitialHistory<TState, TAnnotations = never>(
    app: AppDefinition<TState>,
): History<TState, TAnnotations> {
    return blankHistory<TState, TAnnotations>(app.initialState);
}
