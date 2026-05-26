import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    blankHistory,
    type ApplyTiming,
    type DraftPatch,
    type History,
    type MaybeNested,
    type PatchBuilder,
    type PatchBuilderInternal,
} from 'umkehr';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    type CrdtMeta,
    type CrdtLocalHistory,
    type CrdtPathSegment,
    type HlcTimestamp,
} from 'umkehr/crdt';
import type {Context} from 'umkehr/react';
import type {
    EphemeralMessage,
    EphemeralQuery,
    EphemeralRecord,
    SyncedTransport,
} from 'umkehr/react-crdt';
import type {StatusStore} from 'umkehr';
import type {ReactElement} from 'react';

export type GridSlot = 'left' | 'right';

export type AppEditorBase<TState, Tag extends string = 'type'> = {
    latest(): TState;
    clearPreview(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    $: PatchBuilder<TState, Tag, void, Context>;
    dispatch(v: MaybeNested<DraftPatch<TState, Tag, Context>>, when?: ApplyTiming): void;
};

export type AppEphemeralContext<EphemeralData = never> = {
    publishEphemeral(messages: EphemeralMessage<EphemeralData>[]): void;
    useEphemeral(query?: EphemeralQuery): EphemeralRecord<EphemeralData>[];
};

export type AppEditorContext<
    TState,
    Tag extends string = 'type',
    EphemeralData = never,
> = AppEditorBase<TState, Tag> & AppEphemeralContext<EphemeralData>;

export type CrdtEditorContext<
    TState,
    Tag extends string = 'type',
    EphemeralData = never,
> = AppEditorContext<TState, Tag, EphemeralData> & {
        previewHistory(history: CrdtLocalHistory<TState> | null): void;
        useLocalHistory(): CrdtLocalHistory<TState>;
        useCrdtPath<Current>(
            node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context>,
        ): CrdtPathSegment[];
        useCrdtMeta<Current>(
            node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context>,
        ): CrdtMeta | undefined;
    };

export type HistoryEditorContext<TState, TAnnotations = never> = Omit<
    AppEditorBase<TState>,
    'dispatch'
> & {
    getHistory(): History<TState, TAnnotations>;
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

export type AppPanelProps<TState, EphemeralData = never> = {
    editor: AppEditorContext<TState, 'type', EphemeralData>;
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

export type AppDefinition<TState, EphemeralData = never> = {
    id: string;
    title: string;
    tagKey: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    validateState(input: unknown): IValidation<TState>;
    initialState: TState;
    initialTimestamp?: HlcTimestamp;
    renderPanel(props: AppPanelProps<TState, EphemeralData>): ReactElement;
};

export type CrdtRuntime<TState, EphemeralData = never> = {
    docId: string;
    Provider: SyncedProvider<TState>;
    useEditorContext(): CrdtEditorContext<TState, 'type', EphemeralData>;
};

export type HistoryRuntime<TState, TAnnotations = never> = {
    Provider: HistoryProvider<TState, TAnnotations>;
    useEditorContext(): HistoryEditorContext<TState, TAnnotations>;
};

export type RegisteredApp<TState, TAnnotations = never, EphemeralData = never> = {
    app: AppDefinition<TState, EphemeralData>;
    crdt?: CrdtRuntime<TState, EphemeralData>;
    history?: HistoryRuntime<TState, TAnnotations>;
};

const defaultInitialTimestamp = hlc.pack(hlc.init('seed', 0));

export function createInitialCrdtHistory<TState, EphemeralData = never>(
    app: AppDefinition<TState, EphemeralData>,
): CrdtLocalHistory<TState> {
    return createCrdtLocalHistory(
        createCrdtDocument(app.initialState, app.schema, {
            timestamp: app.initialTimestamp ?? defaultInitialTimestamp,
        }),
    );
}

export function createInitialHistory<TState, TAnnotations = never>(
    app: AppDefinition<TState, any>,
): History<TState, TAnnotations> {
    return blankHistory<TState, TAnnotations>(app.initialState);
}

export function withDisabledEphemeral<TState, TEditor extends AppEditorBase<TState>, EphemeralData>(
    editor: TEditor,
): TEditor & AppEphemeralContext<EphemeralData> {
    return {
        ...editor,
        publishEphemeral() {},
        useEphemeral() {
            return [];
        },
    };
}
