import type {ReactElement} from 'react';

import type {FormattedBlock, FormattedRun, VirtualBlockParentConfig} from '../../block-crdt/index.js';
import type {
    Block,
    BlockStyle,
    CachedState,
    JsonValue,
    Mark,
    Op,
    TimestampedBlockMeta,
} from '../../block-crdt/types.js';
import type {RetainedSelectionSet} from '../selectionSet.js';
import type {
    BlockPoint,
    EditorSelection,
    PluginEditorSelection,
    PluginRetainedSelection,
} from '../selectionModel.js';
import type {BlockLevelSelectionDecorations} from '../selectionSet.js';
import type {CodePreviewKind} from '../blockMeta.js';

export type BlockEditorPluginId = string;
export type BlockEditorContributionId = string;

export type BlockEditorPluginStyle =
    | {id: string; pluginId?: BlockEditorPluginId; order?: number; type: 'css'; cssText: string}
    | {id: string; pluginId?: BlockEditorPluginId; order?: number; type: 'import'; href: string};

export type BlockEditorBlockTypeSpec<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    label?: string;
    create?(context: {ts: string; current?: Meta}): Meta;
    withTs?(meta: Meta, ts: string): Meta;
    isMeta?(meta: TimestampedBlockMeta): meta is Meta;
    validate?(meta: unknown): meta is Meta;
};

export type BlockEditorInlineMarkSpec = {
    id: string;
    pluginId?: BlockEditorPluginId;
    label?: string;
};

export type BlockEditorInlineEmbedSpec = {
    id: string;
    pluginId?: BlockEditorPluginId;
    label?: string;
};

export type BlockEditorSelectionTypeSpec = {
    id: string;
    pluginId?: BlockEditorPluginId;
    label?: string;
};

export type BlockEditorSelectionPlugin<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    label?: string;
    retain(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): PluginRetainedSelection;
    resolve(context: {state: CachedState<Meta>; selection: PluginRetainedSelection}): PluginEditorSelection;
    clamp?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): PluginEditorSelection;
    focusPoint?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): BlockPoint;
    focusBlockId?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): string;
    firstPoint?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): BlockPoint;
    selectedBlockIds?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): readonly string[];
    selectedTopLevelBlockIds?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): readonly string[];
    blockLevelDecorations?(context: {
        state: CachedState<Meta>;
        selection: PluginEditorSelection;
        entryId: string;
        primary: boolean;
    }): ReadonlyMap<string, BlockLevelSelectionDecorations>;
    compare?(context: {
        state: CachedState<Meta>;
        one: PluginEditorSelection | PluginRetainedSelection;
        two: PluginEditorSelection | PluginRetainedSelection;
    }): number;
};

export type BlockEditorToolbarItemSpec = {
    id: string;
    pluginId?: BlockEditorPluginId;
    group?: string;
    label?: string;
    order?: number;
    commandId?: string;
};

export type BlockEditorSlashCommandSpec = {
    id: string;
    pluginId?: BlockEditorPluginId;
    label: string;
    group?: string;
    keywords?: string[];
    order?: number;
    commandId?: string;
};

export type BlockEditorMarkdownShortcutSpec<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    match(context: {
        text: string;
        currentMeta: Meta;
        nextTs(): string;
    }): null | {length: number; meta: Meta; kind?: string};
};

export type BlockEditorCommandContext<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    state: CachedState<Meta>;
    selection: RetainedSelectionSet;
    dispatch(command: BlockEditorCommand): void;
};

export type BlockEditorCommand = {
    id: string;
    payload?: JsonValue;
};

export type BlockEditorCommandResult<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    state: CachedState<Meta>;
    ops: Array<Op<Meta>>;
    selection?: RetainedSelectionSet;
};

export type BlockEditorCommandSpec<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    handle(
        command: BlockEditorCommand,
        context: BlockEditorCommandContext<Meta>,
    ): BlockEditorCommandResult<Meta> | void;
};

export type BlockEditorRenderContext<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    state: CachedState<Meta>;
    registry: BlockEditorRegistry<Meta>;
};

export type BlockEditorRenderedBlockNode<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    block: FormattedBlock<Meta>;
    children: BlockEditorRenderedBlockNode<Meta>[];
};

export type BlockEditorBlockChildrenMode = 'core' | 'renderer';

export type BlockEditorEditableBlockOptions = {
    ariaLabel?: string;
    placeholder?: string;
    surfaceClassName?: string;
    hideBlockAffordance?: boolean;
    hideInlineControls?: boolean;
    hideBlockLevelDecoration?: boolean;
    registerBlockRow?: boolean;
};

export type BlockEditorBlockRenderServices<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    renderEditableBlock(
        node: BlockEditorRenderedBlockNode<Meta> | FormattedBlock<Meta>,
        options?: BlockEditorEditableBlockOptions,
    ): ReactElement;
    renderChildren(node: BlockEditorRenderedBlockNode<Meta>): ReactElement[];
    renderChildrenAtRelativeDepth(
        node: BlockEditorRenderedBlockNode<Meta>,
        baseDepth: number,
    ): ReactElement[];
    renderNodeAtRelativeDepth(
        node: BlockEditorRenderedBlockNode<Meta>,
        baseDepth: number,
    ): ReactElement;
    blockText(block: FormattedBlock<Meta>): string;
    nodeText(node: BlockEditorRenderedBlockNode<Meta>): string;
};

export type BlockEditorSelectionRenderServices = {
    focus(selection?: EditorSelection | null): void;
    dispatch(command: BlockEditorCommand): void;
};

export type BlockEditorAttachmentRenderServices = {
    get(id: string): unknown;
};

export type BlockEditorPreviewRenderServices = {
    setUrl(blockId: string, url: string): void;
    setMetadata(blockId: string, url: string, metadata: JsonValue | null): void;
};

export type BlockEditorBlockDropIndicator = {
    indicatorPlacement: string;
};

export type BlockEditorDragDropRenderServices = {
    registerRow(blockId: string, element: HTMLElement | null): void;
    startBlockDragFromHandle(blockId: string, event: unknown): void;
    isDragging(blockId: string): boolean;
    isDraggingRoot(blockId: string): boolean;
    dropTargetForBlock(blockId: string): BlockEditorBlockDropIndicator | null;
};

export type BlockEditorDecorationRenderServices = {
    blockLevel(blockId: string): BlockLevelSelectionDecorations | null;
};

export type BlockEditorTableRenderServices = Record<string, unknown>;
export type BlockEditorSlideRenderServices = Record<string, unknown>;
export type BlockEditorPollRenderServices = {
    modeForBlock(blockId: string): string;
    setModeForBlock(blockId: string, mode: string): void;
    vote(blockId: string, optionId: string, rowId?: string): void;
    answerLong(blockId: string, text: string): void;
};
export type BlockEditorAnnotationRenderServices = Record<string, unknown>;

export type BlockEditorBlockRenderContext<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> =
    BlockEditorRenderContext<Meta> & {
        userId: string;
        blocks: BlockEditorBlockRenderServices<Meta>;
        selection: BlockEditorSelectionRenderServices;
        attachments: BlockEditorAttachmentRenderServices;
        previews: BlockEditorPreviewRenderServices;
        dragDrop: BlockEditorDragDropRenderServices;
        decorations: BlockEditorDecorationRenderServices;
        table: BlockEditorTableRenderServices;
        slides: BlockEditorSlideRenderServices;
        polls: BlockEditorPollRenderServices;
        annotations: BlockEditorAnnotationRenderServices;
    };

export type BlockEditorInlineRenderContext<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> =
    BlockEditorRenderContext<Meta> & {
        markClassNames(markType: string, value: unknown): readonly string[];
        markAttributes(markType: string, value: unknown): Record<string, string | undefined>;
        dispatch(command: BlockEditorCommand): void;
    };

export type BlockEditorDestinationRenderContext<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> =
    BlockEditorRenderContext<Meta> & {
        destination: string;
        userId: string;
        annotations: BlockEditorAnnotationRenderServices;
        dispatch(command: BlockEditorCommand): void;
    };

export type BlockEditorOptionPanelRenderContext<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> =
    BlockEditorRenderContext<Meta> & {
        updateBlockMeta(blockId: string, meta: Meta): void;
        updateBlockStyle(blockId: string, style: BlockStyle | undefined): void;
        dispatch(command: BlockEditorCommand): void;
    };

export type BlockEditorBlockRenderer<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    blockType: string;
    children?: BlockEditorBlockChildrenMode;
    render(
        node: BlockEditorRenderedBlockNode<Meta>,
        context: BlockEditorBlockRenderContext<Meta>,
    ): ReactElement | null;
};

export type BlockEditorInlineRenderer<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    markType?: string;
    embedType?: string;
    render(run: FormattedRun, context: BlockEditorInlineRenderContext<Meta>): ReactElement | null;
};

export type BlockEditorDestinationRenderer<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    destination: 'sidebar' | 'footer' | 'floating' | string;
    order?: number;
    render(context: BlockEditorDestinationRenderContext<Meta>): ReactElement | null;
};

export type BlockEditorOptionPanelSpec<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    blockType: string;
    render(block: Block<Meta>, context: BlockEditorOptionPanelRenderContext<Meta>): ReactElement | null;
};

export type BlockEditorCodePreviewRenderer = {
    id: string;
    pluginId?: BlockEditorPluginId;
    languages: readonly string[];
    label?: string;
    previewKind: CodePreviewKind;
    emptyLabel: string;
    loadingLabel: string;
    errorLabel: string;
    render(source: string, renderId: string): Promise<{html: string}>;
};

export type BlockEditorCrdtHooks<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    markBehavior?: VirtualBlockParentConfig<Meta>['markBehavior'];
    virtualParents?: (block: Block<Meta>) => readonly Mark['id'][];
    markVirtualParents?: (mark: Mark) => readonly Mark['id'][];
    mergeBlockMeta?: (current: Meta, incoming: Meta) => Meta | null | undefined;
    mergeBlockMetaTypes?: readonly string[];
};

export type BlockEditorClipboardHooks<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    serialize?(context: {state: CachedState<Meta>}): JsonValue | undefined;
    deserialize?(context: {state: CachedState<Meta>; data: JsonValue}): Array<Op<Meta>>;
};

export type BlockEditorPlugin<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: BlockEditorPluginId;
    requires?: readonly BlockEditorPluginId[];
    blockTypes?: readonly BlockEditorBlockTypeSpec<Meta>[];
    marks?: readonly BlockEditorInlineMarkSpec[];
    inlineEmbeds?: readonly BlockEditorInlineEmbedSpec[];
    selectionTypes?: readonly BlockEditorSelectionTypeSpec[];
    selectionPlugins?: readonly BlockEditorSelectionPlugin<Meta>[];
    toolbarItems?: readonly BlockEditorToolbarItemSpec[];
    slashCommands?: readonly BlockEditorSlashCommandSpec[];
    markdownShortcuts?: readonly BlockEditorMarkdownShortcutSpec<Meta>[];
    commands?: readonly BlockEditorCommandSpec<Meta>[];
    blockRenderers?: readonly BlockEditorBlockRenderer<Meta>[];
    inlineRenderers?: readonly BlockEditorInlineRenderer<Meta>[];
    destinationRenderers?: readonly BlockEditorDestinationRenderer<Meta>[];
    optionPanels?: readonly BlockEditorOptionPanelSpec<Meta>[];
    codePreviewRenderers?: readonly BlockEditorCodePreviewRenderer[];
    clipboard?: readonly BlockEditorClipboardHooks<Meta>[];
    crdt?: BlockEditorCrdtHooks<Meta>;
    styles?: readonly BlockEditorPluginStyle[];
};

export type BlockEditorRegistry<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    plugins: readonly BlockEditorPlugin<Meta>[];
    blockTypes: ReadonlyMap<string, BlockEditorBlockTypeSpec<Meta>>;
    marks: ReadonlyMap<string, BlockEditorInlineMarkSpec>;
    inlineEmbeds: ReadonlyMap<string, BlockEditorInlineEmbedSpec>;
    selectionTypes: ReadonlyMap<string, BlockEditorSelectionTypeSpec>;
    selectionPlugins: ReadonlyMap<string, BlockEditorSelectionPlugin<Meta>>;
    toolbarItems: readonly BlockEditorToolbarItemSpec[];
    slashCommands: readonly BlockEditorSlashCommandSpec[];
    markdownShortcuts: readonly BlockEditorMarkdownShortcutSpec<Meta>[];
    commands: ReadonlyMap<string, BlockEditorCommandSpec<Meta>>;
    blockRenderers: ReadonlyMap<string, BlockEditorBlockRenderer<Meta>>;
    inlineRenderers: readonly BlockEditorInlineRenderer<Meta>[];
    destinationRenderers: ReadonlyMap<string, readonly BlockEditorDestinationRenderer<Meta>[]>;
    optionPanels: ReadonlyMap<string, readonly BlockEditorOptionPanelSpec<Meta>[]>;
    codePreviewRenderers: ReadonlyMap<string, BlockEditorCodePreviewRenderer>;
    codePreviewRenderersByLanguage: ReadonlyMap<string, BlockEditorCodePreviewRenderer>;
    clipboard: ReadonlyMap<string, BlockEditorClipboardHooks<Meta>>;
    styles: readonly BlockEditorPluginStyle[];
    crdtConfig(): VirtualBlockParentConfig<Meta>;
};

export class BlockEditorPluginRegistryError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'BlockEditorPluginRegistryError';
        this.code = code;
    }
}
