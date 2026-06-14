export type LeafBuilderCommand<TChange = unknown, TArg = unknown> = (arg: TArg) => TChange;

export type LeafBuilderCommandMap<TChange = unknown> = Record<
    string,
    LeafBuilderCommand<TChange, any>
>;

export type LeafBuilderExtension<
    TValue = unknown,
    TKey extends string = string,
    TPlugin extends string = string,
    TCommands extends LeafBuilderCommandMap = LeafBuilderCommandMap,
> = {
    key: TKey;
    plugin: TPlugin;
    commands: TCommands;
    readonly __value?: TValue;
};

export type LeafBuilderExtensionAny = LeafBuilderExtension<
    unknown,
    string,
    string,
    LeafBuilderCommandMap
>;

export type PatchBuilderRuntimeExtension = Pick<
    LeafBuilderExtensionAny,
    'key' | 'plugin' | 'commands'
>;

export type PatchBuilderOptions<Extensions extends readonly LeafBuilderExtensionAny[] = []> = {
    builderExtensions?: Extensions;
};

export function defineLeafBuilderExtension<TValue, TChange = unknown>() {
    return <
        TKey extends string,
        TPlugin extends string,
        TCommands extends LeafBuilderCommandMap<TChange>,
    >(extension: {
        key: TKey;
        plugin: TPlugin;
        commands: TCommands;
    }): LeafBuilderExtension<TValue, TKey, TPlugin, TCommands> =>
        extension as LeafBuilderExtension<TValue, TKey, TPlugin, TCommands>;
}

export function normalizeBuilderExtensions(
    extensions: readonly PatchBuilderRuntimeExtension[] = [],
) {
    const byKey = new Map<string, PatchBuilderRuntimeExtension>();
    for (const extension of extensions) {
        const existing = byKey.get(extension.key);
        if (existing) {
            throw new Error(
                `Duplicate patch builder extension key "${extension.key}" for plugins "${existing.plugin}" and "${extension.plugin}".`,
            );
        }
        byKey.set(extension.key, extension);
    }
    return byKey;
}
