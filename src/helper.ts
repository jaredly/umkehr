// const TAG_KEY = 'kind' as const; // or "type" or make it a generic param
import {
    pathToString,
    type ApplyTiming,
    type PatchBuilderInternal,
    type DraftPatch,
    getPathSymbol,
    getExtraSymbol,
    type PathSegment,
    type OpMaker,
    type ArrayMove,
} from './types.js';

export type PatchBuilder<
    T,
    Tag extends PropertyKey = 'type',
    R = void,
    Context = unknown,
> = PatchBuilderInternal<T, T, Tag, R, Context>;

export function createPatchBuilder<T>(): PatchBuilder<
    T,
    'type',
    DraftPatch<T, 'type', undefined>,
    undefined
>;
export function createPatchBuilder<T, Tag extends string>(tag: Tag): PatchBuilder<
    T,
    Tag,
    DraftPatch<T, Tag, undefined>,
    undefined
>;
export function createPatchBuilder<T, Tag extends string = 'type'>(tag?: Tag) {
    return createPatchBuilderWithContext<T, undefined, Tag>((tag ?? 'type') as Tag, undefined);
}

export function createPatchBuilderWithContext<T, Context, Tag extends string = 'type'>(
    tag: Tag,
    context: Context,
) {
    return createPatchDispatcher<T, Context, Tag, DraftPatch<T, Tag, Context>>(
        (x) => x,
        context,
        tag,
    );
}

export const getPath = <A, B, T extends PropertyKey, C, E>(
    builder: PatchBuilderInternal<A, B, T, C, E>,
) => builder[getPathSymbol];

export const getExtra = <A, B, T extends PropertyKey, C, E>(
    builder: PatchBuilderInternal<A, B, T, C, E>,
): E => builder[getExtraSymbol];

export function createPatchDispatcher<T, Extra, Tag extends string = 'type', R = void>(
    apply: (v: DraftPatch<T, Tag, Extra>, when?: ApplyTiming) => R,
    extra: Extra,
    tag: Tag,
): PatchBuilder<T, Tag, R, Extra> {
    // biome-ignore lint: this one is fine
    const cache: Record<string, (v: any, b: any) => R> = {};
    // biome-ignore lint: this one is fine
    const proxyCache: Record<string, any> = {};
    const ghost = {}; // {_t: T} a phantom type kinda thing
    // biome-ignore lint: this one is fine
    function makeProxy(path: Array<PathSegment>): any {
        const pathString = JSON.stringify(path);

        const updateFn = (value: T | OpMaker<T, Tag, Extra>, when?: ApplyTiming) => {
            if (typeof value !== 'function') {
                return apply({op: 'replace', path, value, ...ghost}, when);
            }
            // biome-ignore lint: this one is fine
            return apply({op: 'nested', make: value as any, path, ...ghost}, when);
        };

        // biome-ignore lint: this one is fine
        const handler: ProxyHandler<any> = {
            get(_target, prop, _receiver) {
                // 🔹 variant(): refine the *last* path segment with `[kind=value]`
                if (prop === '$variant') {
                    return (...args: [string] | [any, Record<string, any>]) => {
                        if (!args.length) {
                            throw new Error(`Invalid call`);
                        }
                        if (args.length === 1) {
                            const [tagValue] = args;

                            const k = pathString + '/' + tagValue;
                            if (!proxyCache[k])
                                proxyCache[k] = makeProxy([
                                    ...path,
                                    {type: 'tag', key: tag, value: tagValue},
                                ]);
                            return proxyCache[k];
                        }
                        const [value, record] = args;
                        const tagValue = value[tag];

                        const k = pathString + '/' + tagValue;
                        if (!proxyCache[k])
                            proxyCache[k] = makeProxy([
                                ...path,
                                {type: 'tag', key: tag, value: tagValue},
                            ]);

                        return record[value[tag]](value, proxyCache[k]);
                    };
                }

                if (prop === 'toString') {
                    return () => pathToString(path);
                }

                if (prop === 'valueOf') {
                    // React may coerce updater functions while rendering controlled inputs.
                    return null;
                }

                // 🔹 operations
                if (prop === '$replace') {
                    const k = pathString + '/replace';
                    if (!cache[k])
                        cache[k] = (value, when?: ApplyTiming) =>
                            apply({op: 'replace', path, value, ...ghost}, when);
                    return cache[k];
                }

                if (prop === '$update') {
                    return updateFn;
                }

                if (prop === '$add') {
                    const k = pathString + '/add';
                    if (!cache[k])
                        cache[k] = (value, when?: ApplyTiming) =>
                            apply({op: 'add', path, value, ...ghost}, when);
                    return cache[k];
                }

                if (prop === '$move') {
                    const k = pathString + '/move';
                    if (!cache[k])
                        cache[k] = (move: ArrayMove, when?: ApplyTiming) => {
                            return apply(
                                {
                                    op: 'move',
                                    path,
                                    fromIdx: move.fromIdx,
                                    targetIdx: move.targetIdx,
                                    after: move.after,
                                    ...ghost,
                                    // biome-ignore lint: this one is fine
                                } as any,
                                when,
                            );
                        };
                    return cache[k];
                }

                if (prop === '$push') {
                    const k = pathString + '/push';
                    if (!cache[k])
                        cache[k] = (value, when?: ApplyTiming) =>
                            apply({op: 'push', path, value, ...ghost}, when);
                    return cache[k];
                }

                if (prop === '$reorder') {
                    const k = pathString + '/reorder';
                    if (!cache[k])
                        cache[k] = (indices, when?: ApplyTiming) =>
                            apply({op: 'reorder', path, indices, ...ghost}, when);
                    return cache[k];
                }

                if (prop === '$remove') {
                    const k = pathString + '/remove';
                    if (!cache[k])
                        cache[k] = (when?: ApplyTiming | React.MouseEvent) =>
                            apply(
                                {op: 'remove', path, ...ghost},
                                typeof when === 'string' ? when : undefined,
                            );
                    return cache[k];
                }

                if (prop === getPathSymbol) {
                    return path;
                }
                if (prop === getExtraSymbol) {
                    return extra;
                }

                if (prop === Symbol.toPrimitive) {
                    return (hint: string) => {
                        if (hint === 'string' || hint === 'default') {
                            return '() => {}'; // react does this
                        }
                        return 0;
                    };
                }

                // ignore symbols
                if (typeof prop === 'symbol') return undefined;

                // 🔹 navigation: property or index
                const key =
                    typeof prop === 'string' && /^\d+$/.test(prop)
                        ? Number(prop)
                        : (prop as string | number);

                const k = pathString + '-' + prop;
                if (!proxyCache[k]) proxyCache[k] = makeProxy([...path, {type: 'key', key}]);
                return proxyCache[k];
            },
        };

        return new Proxy(updateFn, handler);
    }
    return makeProxy([]) as PatchBuilder<T, Tag, R, Extra>;
}
