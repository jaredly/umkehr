import type {ReactElement} from 'react';

import type {FormattedRun, VirtualBlockParentConfig} from '../../block-crdt/index.js';
import type {
    Block,
    CachedState,
    JsonValue,
    Mark,
    Op,
    TimestampedBlockMeta,
} from '../../block-crdt/types.js';
import type {RetainedSelectionSet} from '../selectionSet.js';

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

export type BlockEditorBlockRenderer<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    blockType: string;
    render(block: Block<Meta>, context: BlockEditorRenderContext<Meta>): ReactElement | null;
};

export type BlockEditorInlineRenderer<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    markType?: string;
    embedType?: string;
    render(run: FormattedRun, context: BlockEditorRenderContext<Meta>): ReactElement | null;
};

export type BlockEditorDestinationRenderer<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    destination: 'sidebar' | 'footer' | 'floating' | string;
    order?: number;
    render(context: BlockEditorRenderContext<Meta>): ReactElement | null;
};

export type BlockEditorOptionPanelSpec<Meta extends TimestampedBlockMeta = TimestampedBlockMeta> = {
    id: string;
    pluginId?: BlockEditorPluginId;
    blockType: string;
    render(block: Block<Meta>, context: BlockEditorRenderContext<Meta>): ReactElement | null;
};

export type BlockEditorCodePreviewRenderer = {
    id: string;
    pluginId?: BlockEditorPluginId;
    languages: readonly string[];
    label?: string;
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
