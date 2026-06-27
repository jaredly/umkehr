import type {IJsonSchemaCollection, IValidation} from 'typia';
import {
    blankHistory,
    type ApplyTiming,
    type DraftPatch,
    type History,
    type LeafBuilderExtensionAny,
    type MaybeNested,
    type PatchBuilder,
    type PatchBuilderInternal,
} from 'umkehr';
import {
    createCrdtDocument,
    createCrdtLocalHistory,
    hlc,
    leafPluginDescriptor,
    type LeafCrdtPluginAny,
    type CrdtMeta,
    type CrdtLocalHistory,
    type CrdtDocument,
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
import type {ArtifactStore} from './artifacts';

export type GridSlot = 'left' | 'right';

export type AppEditorBase<
    TState,
    Tag extends string = 'type',
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    latest(): TState;
    clearPreview(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undo(): void;
    redo(): void;
    $: PatchBuilder<TState, Tag, void, Context, Extensions>;
    dispatch(
        v: MaybeNested<DraftPatch<TState, Tag, Context, Extensions>>,
        when?: ApplyTiming,
    ): void;
};

export type AppEphemeralContext<EphemeralData = never> = {
    publishEphemeral(messages: EphemeralMessage<EphemeralData>[]): void;
    useEphemeral(query?: EphemeralQuery): EphemeralRecord<EphemeralData>[];
};

export type AppEditorContext<
    TState,
    Tag extends string = 'type',
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = AppEditorBase<TState, Tag, Extensions> & AppEphemeralContext<EphemeralData>;

export type CrdtEditorContext<
    TState,
    Tag extends string = 'type',
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = AppEditorContext<TState, Tag, EphemeralData, Extensions> & {
    previewHistory(history: CrdtLocalHistory<TState> | null): void;
    useLocalHistory(): CrdtLocalHistory<TState>;
    useCrdtPath<Current>(
        node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
    ): CrdtPathSegment[];
    useCrdtMeta<Current>(
        node: PatchBuilderInternal<unknown, Current, Tag, unknown, Context, Extensions>,
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

export type AppPanelProps<
    TState,
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    editor: AppEditorContext<TState, 'type', EphemeralData, Extensions>;
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

export type AppDefinition<
    TState,
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    id: string;
    title: string;
    schemaVersion: number;
    tagKey: string;
    schema: IJsonSchemaCollection<'3.1', [TState]>;
    leafPlugins?: readonly LeafCrdtPluginAny[];
    builderExtensions?: Extensions;
    validateState(input: unknown): IValidation<TState>;
    initialState: TState;
    initialTimestamp?: HlcTimestamp;
    artifacts?: ArtifactStore;
    renderPanel(props: AppPanelProps<TState, EphemeralData, Extensions>): ReactElement;
};

export type CrdtRuntime<
    TState,
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    docId: string;
    Provider: SyncedProvider<TState>;
    useEditorContext(): CrdtEditorContext<TState, 'type', EphemeralData, Extensions>;
};

export type HistoryRuntime<TState, TAnnotations = never> = {
    Provider: HistoryProvider<TState, TAnnotations>;
    useEditorContext(): HistoryEditorContext<TState, TAnnotations>;
};

export type RegisteredApp<
    TState,
    TAnnotations = never,
    EphemeralData = never,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    app: AppDefinition<TState, EphemeralData, Extensions>;
    crdt?: CrdtRuntime<TState, EphemeralData, Extensions>;
    history?: HistoryRuntime<TState, TAnnotations>;
};

const defaultInitialTimestamp = hlc.pack(hlc.init('seed', 0));

export function createInitialCrdtHistory<TState, EphemeralData = never>(
    app: AppDefinition<TState, EphemeralData, readonly LeafBuilderExtensionAny[]>,
): CrdtLocalHistory<TState> {
    return createCrdtLocalHistory(
        createCrdtDocument(app.initialState, app.schema, {
            timestamp: app.initialTimestamp ?? defaultInitialTimestamp,
            leafPlugins: app.leafPlugins,
        }),
    );
}

export function cloneSerializableCrdtLocalHistory<TState>(
    history: CrdtLocalHistory<TState>,
): CrdtLocalHistory<TState> {
    return {
        base: cloneSerializableCrdtDocument(history.base),
        doc: cloneSerializableCrdtDocument(history.doc),
        updates: structuredClone(history.updates),
    };
}

export function hydrateCrdtLocalHistoryForApp<TState, EphemeralData = never>(
    history: CrdtLocalHistory<TState>,
    app: AppDefinition<TState, EphemeralData, readonly LeafBuilderExtensionAny[]>,
): CrdtLocalHistory<TState> {
    const schema = appSchemaContext(app);
    return {
        base: {...history.base, schema},
        doc: {...history.doc, schema},
        updates: history.updates,
    };
}

function cloneSerializableCrdtDocument<TState>(doc: CrdtDocument<TState>): CrdtDocument<TState> {
    return {
        state: structuredClone(doc.state),
        meta: structuredClone(doc.meta),
        pending: structuredClone(doc.pending),
        schema: {
            root: structuredClone(doc.schema.root),
            components: structuredClone(doc.schema.components),
            tagKey: doc.schema.tagKey,
            leafPlugins: {},
            requiredLeafPlugins: structuredClone(
                doc.schema.requiredLeafPlugins.length
                    ? doc.schema.requiredLeafPlugins
                    : Object.values(doc.schema.leafPlugins).map(leafPluginDescriptor),
            ),
        },
    };
}

function appSchemaContext<TState, EphemeralData = never>(
    app: AppDefinition<TState, EphemeralData, readonly LeafBuilderExtensionAny[]>,
) {
    return createCrdtDocument(app.initialState, app.schema, {
        timestamp: app.initialTimestamp ?? defaultInitialTimestamp,
        leafPlugins: app.leafPlugins,
    }).schema;
}

export function createInitialHistory<TState, TAnnotations = never>(
    app: AppDefinition<TState, any, readonly LeafBuilderExtensionAny[]>,
): History<TState, TAnnotations> {
    return blankHistory<TState, TAnnotations>(app.initialState);
}

export function withDisabledEphemeral<TEditor, EphemeralData>(
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
