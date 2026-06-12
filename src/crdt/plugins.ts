import type {BlockedEffect, CrdtLocalHistory, LocalEffect} from './history.js';
import type {
    CrdtDocument,
    CrdtPathSegment,
    CrdtUpdate,
    HlcTimestamp,
    JsonValue,
    LeafMeta,
    Schema,
} from './types.js';
import type {LeafBuilderExtension, LeafBuilderExtensionAny} from '../builderExtensions.js';

export type LeafPluginDescriptor = {
    id: string;
    version: number;
};

export type LeafOperationValidationIssue = {
    path: string;
    message: string;
    expected?: string;
    value?: unknown;
};

export type LeafOperationValidationResult<TOperation> =
    | {success: true; data: TOperation}
    | {success: false; errors: LeafOperationValidationIssue[]};

export type LeafPluginContext = {
    sessionId: string;
};

export type LeafInitInput<TValue extends JsonValue> = {
    value: TValue | undefined;
    schema: Schema;
    ts: HlcTimestamp;
};

export type LeafCreateOperationsInput<
    TValue extends JsonValue,
    TMetaData extends JsonValue,
    TPatchChange,
> = {
    value: TValue;
    meta: LeafMeta<TMetaData>;
    change: TPatchChange;
    ts: HlcTimestamp;
    context: LeafPluginContext;
};

export type LeafApplyOperationInput<
    TValue extends JsonValue,
    TMetaData extends JsonValue,
    TOperation extends JsonValue,
> = {
    value: TValue;
    meta: LeafMeta<TMetaData>;
    operation: TOperation;
    ts: HlcTimestamp;
    context: LeafPluginContext;
};

export type LeafEffectInput<
    TValue extends JsonValue,
    TMetaData extends JsonValue,
    TOperation extends JsonValue,
> = {
    path: CrdtPathSegment[];
    localTs: HlcTimestamp;
    before: TValue | undefined;
    after: TValue;
    meta: LeafMeta<TMetaData>;
    operation: TOperation;
};

export type LeafCrdtPlugin<
    TId extends string = string,
    TValue extends JsonValue = JsonValue,
    TPatchChange = unknown,
    TOperation extends JsonValue = JsonValue,
    TMetaData extends JsonValue = JsonValue,
> = {
    id: TId;
    version: number;
    builder?: LeafBuilderExtension<TValue, string, TId, any>;
    empty(input: {schema: Schema}): TValue;
    isValue(value: unknown): value is TValue;
    init(input: LeafInitInput<TValue>): {value: TValue; meta: TMetaData};
    createOperations(
        input: LeafCreateOperationsInput<TValue, TMetaData, TPatchChange>,
    ): TOperation[];
    applyOperation(input: LeafApplyOperationInput<TValue, TMetaData, TOperation>): {
        value: TValue;
        meta: TMetaData;
    };
    validateOperation(input: unknown): LeafOperationValidationResult<TOperation>;
    captureEffect?(
        input: LeafEffectInput<TValue, TMetaData, TOperation>,
    ): Extract<LocalEffect, {kind: 'leaf'}>;
    createUndoOperations?(input: {
        doc: CrdtDocument<unknown>;
        effect: Extract<LocalEffect, {kind: 'leaf'}>;
        ts: HlcTimestamp;
        context: LeafPluginContext;
    }): CrdtUpdate[];
    createUndoOperationsForEffects?(input: {
        doc: CrdtDocument<unknown>;
        effects: Extract<LocalEffect, {kind: 'leaf'}>[];
        ts: HlcTimestamp;
        context: LeafPluginContext;
    }): CrdtUpdate[];
    createRedoOperations?(input: {
        doc: CrdtDocument<unknown>;
        effect: Extract<LocalEffect, {kind: 'leaf'}>;
        ts: HlcTimestamp;
        context: LeafPluginContext;
    }): CrdtUpdate[];
    createRedoOperationsForEffects?(input: {
        doc: CrdtDocument<unknown>;
        effects: Extract<LocalEffect, {kind: 'leaf'}>[];
        redoGuardEffects?: Extract<LocalEffect, {kind: 'leaf'}>[];
        ts: HlcTimestamp;
        context: LeafPluginContext;
    }): CrdtUpdate[];
    checkEffect?(input: {
        doc: CrdtDocument<unknown>;
        history: CrdtLocalHistory<unknown>;
        command: {id: HlcTimestamp};
        effect: Extract<LocalEffect, {kind: 'leaf'}>;
    }): BlockedEffect | null;
};

export type LeafCrdtPluginAny = LeafCrdtPlugin<string, JsonValue, unknown, JsonValue, JsonValue>;

export type LeafPluginRegistry = Record<string, LeafCrdtPluginAny>;

export function leafPluginDescriptor(
    plugin: Pick<LeafCrdtPluginAny, 'id' | 'version'>,
): LeafPluginDescriptor {
    return {id: plugin.id, version: plugin.version};
}

export function createLeafPluginRegistry(
    plugins: readonly LeafCrdtPluginAny[] = [],
): LeafPluginRegistry {
    const registry: LeafPluginRegistry = {};
    for (const plugin of plugins) {
        const existing = registry[plugin.id];
        if (existing && existing.version !== plugin.version) {
            throw new Error(
                `Cannot register leaf CRDT plugin "${plugin.id}" at versions ${existing.version} and ${plugin.version}.`,
            );
        }
        registry[plugin.id] = plugin;
    }
    return registry;
}

export function sortLeafPluginDescriptors(
    descriptors: readonly LeafPluginDescriptor[],
): LeafPluginDescriptor[] {
    return descriptors
        .map((descriptor) => ({id: descriptor.id, version: descriptor.version}))
        .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
}

export function assertRequiredLeafPlugins(
    required: readonly LeafPluginDescriptor[],
    registry: LeafPluginRegistry,
) {
    for (const descriptor of required) {
        const plugin = registry[descriptor.id];
        if (!plugin) {
            throw new Error(
                `Missing required leaf CRDT plugin "${descriptor.id}" version ${descriptor.version}.`,
            );
        }
        if (plugin.version !== descriptor.version) {
            throw new Error(
                `Leaf CRDT plugin "${descriptor.id}" version mismatch: schema requires ${descriptor.version}, registered ${plugin.version}.`,
            );
        }
    }
}

export function builderExtensionsFromLeafPlugins(
    plugins: LeafPluginRegistry | readonly LeafCrdtPluginAny[] = [],
): LeafBuilderExtensionAny[] {
    const entries = Array.isArray(plugins) ? plugins : Object.values(plugins);
    return entries.flatMap((plugin) => {
        const builder = plugin.builder;
        if (!builder) return [];
        if (builder.plugin !== plugin.id) {
            throw new Error(
                `Leaf CRDT plugin "${plugin.id}" has builder extension for plugin "${builder.plugin}".`,
            );
        }
        return [builder as LeafBuilderExtensionAny];
    });
}
