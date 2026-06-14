import type {
    LeafBuilderCommandMap,
    LeafBuilderExtension,
    LeafBuilderExtensionAny,
} from './builderExtensions.js';

/* -------------- utility types ---------------- */

// Strip null/undefined for navigation
type NonNullish<T> = Exclude<T, null | undefined>;

// "Is this a union?" helper
// biome-ignore lint: this one is fine
type IsUnion<T, U = T> = (T extends any ? (x: T) => void : never) extends (x: U) => void
    ? false
    : true;

// All tag values for a given discriminant
type VariantTags<T, Tag extends PropertyKey> = T extends {[K in Tag]: infer V} ? V : never;

// The arm of a tagged union where Tag == V
type VariantOf<T, Tag extends PropertyKey, V extends VariantTags<T, Tag>> = Extract<
    T,
    {[K in Tag]: V}
>;

// "Is this a tagged union on Tag?"
// biome-ignore lint: this one is fine
type IsTaggedUnion<Current, Tag extends PropertyKey> =
    NonNullish<Current> extends {[K in Tag]: any} ? IsUnion<NonNullish<Current>> : false;

// For normal object navigation over unions
// biome-ignore lint: this one is fine
type KeysOfUnion<T> = T extends any ? keyof T : never;

// biome-ignore lint: this one is fine
type ValueOfUnion<T, K extends PropertyKey> = T extends any
    ? K extends keyof T
        ? T[K]
        : never
    : never;

/* ------------------ patch types ------------------- */

export type Path = PathSegment[];

export type AddOp<_T> = {op: 'add'; path: Path; value: unknown};

export type ReplaceOp<_T> = {
    op: 'replace';
    path: Path;
    value: unknown;
    previous: unknown;
};

export type RemoveOp<_T> = {op: 'remove'; path: Path; value: unknown};

export type ArrayMove = {fromIdx: number; targetIdx: number; after: boolean};

export type MoveOp<_T> = {op: 'move'; path: Path} & ArrayMove;

export type ReorderOp<_T> = {
    op: 'reorder';
    path: Path;
    indices: number[];
};

export type LeafPatch<_T, TPlugin extends string = string, TChange = unknown> = {
    op: 'leaf';
    plugin: TPlugin;
    path: Path;
    change: TChange;
};

export type Patch<T> =
    | AddOp<T>
    | ReplaceOp<T>
    | RemoveOp<T>
    | MoveOp<T>
    | ReorderOp<T>
    | LeafPatch<T>;

export type DraftReplace<_T> = {
    op: 'replace';
    path: Path;
    value: unknown;
};

export type DraftRemove<_T> = {op: 'remove'; path: Path};

export type DraftPush<_T> = {
    op: 'push';
    path: Path;
    value: unknown;
};

export type DraftNested<
    _T,
    Inner,
    Tag extends PropertyKey,
    Extra = unknown,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    op: 'nested';
    path: Path;
    builderExtensions?: Extensions;
    make: (
        v: Inner,
        update: PatchBuilderInternal<
            Inner,
            Inner,
            Tag,
            DraftPatch<Inner, Tag, Extra, Extensions>,
            Extra,
            Extensions
        >,
    ) => DraftPatch<Inner, Tag, Extra, Extensions> | DraftPatch<Inner, Tag, Extra, Extensions>[];
};

export type DraftPatch<
    T,
    Tag extends PropertyKey = 'type',
    Extra = unknown,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> =
    | AddOp<T>
    | DraftReplace<T>
    | DraftPush<T>
    | ReorderOp<T>
    | DraftRemove<T>
    | LeafPatch<T>
    | DraftNested<T, unknown, Tag, Extra, Extensions>
    | MoveOp<T>;

/* ---------------- builder and stuff ---------------- */

export type ApplyTiming = 'preview' | undefined;

export type PathSegment =
    | {type: 'key'; key: string | number}
    | {type: 'tag'; key: string; value: string};

export const pathToString = (path: PathSegment[]) =>
    path.map((p) => (p.type === 'key' ? p.key : `[${p.key}=${p.value}]`)).join('/');

// Only if P is an AddPath<Root, C>
type AddMethodsA<Value, R> = {$add(value: Value, when?: ApplyTiming): R};

// Only if P is a RemovablePath<Root, C>
type RemoveMethodsA<R> = {$remove(when?: ApplyTiming | React.MouseEvent): R};

export type OpMaker<
    Value,
    Tag extends PropertyKey,
    Extra,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = (
    v: Value,
    update: PatchBuilderInternal<
        Value,
        Value,
        Tag,
        DraftPatch<Value, Tag, Extra, Extensions>,
        Extra,
        Extensions
    >,
) => DraftPatch<Value, Tag, Extra, Extensions> | DraftPatch<Value, Tag, Extra, Extensions>[];

type ReplaceAndTestMethodsA<
    Value,
    Tag extends PropertyKey,
    R,
    Extra,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = {
    $replace(value: Value, when?: ApplyTiming): R;
    $update(opMaker: OpMaker<Value, Tag, Extra, Extensions>, when?: ApplyTiming): R;
};

type UpdateFunction<
    Value,
    Tag extends PropertyKey,
    R,
    Extra,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = (opMaker: Value | OpMaker<Value, Tag, Extra, Extensions>, when?: ApplyTiming) => R;

type BuilderCommandMethod<F, R> = F extends (arg: infer Arg) => unknown
    ? (arg: Arg, when?: ApplyTiming) => R
    : never;

type BuilderSurfaceForExtension<E, Current, R> =
    E extends LeafBuilderExtension<infer TValue, infer TKey, string, infer Commands>
        ? Commands extends LeafBuilderCommandMap
            ? NonNullish<Current> extends TValue
                ? {
                      [K in TKey]: {
                          [C in keyof Commands]: BuilderCommandMethod<Commands[C], R>;
                      };
                  }
                : {}
            : {}
        : {};

// biome-ignore lint: this one is fine
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void
    ? I
    : never;

type BuilderSurfacesForExtensions<
    Extensions extends readonly LeafBuilderExtensionAny[],
    Current,
    R,
> = [Extensions[number]] extends [never]
    ? {}
    : UnionToIntersection<BuilderSurfaceForExtension<Extensions[number], Current, R>>;

export const getPathSymbol = Symbol('get path');
export const getExtraSymbol = Symbol('get extra');

export type PatchBuilderInternal<
    Root,
    Current,
    Tag extends PropertyKey,
    R,
    Extra = unknown,
    Extensions extends readonly LeafBuilderExtensionAny[] = [],
> = AddMethodsA<Current, R> & {
    // operations at this path (unchanged)
    [getPathSymbol]: Path;
    [getExtraSymbol]: Extra;
} & ReplaceAndTestMethodsA<Current, Tag, R, Extra, Extensions> &
    RemoveMethodsA<R> &
    UpdateFunction<Current, Tag, R, Extra, Extensions> &
    BuilderSurfacesForExtensions<Extensions, Current, R> &
    // navigation
    (IsTaggedUnion<Current, Tag> extends true
        ? {
              $variant<
                  V extends VariantTags<NonNullish<Current>, Tag> & (string | number | symbol),
              >(
                  tag: V,
              ): PatchBuilderInternal<
                  Root,
                  VariantOf<NonNullish<Current>, Tag, V>,
                  Tag,
                  R,
                  Extra,
                  Extensions
              >;
              $variant<Result>(
                  value: Current,
                  kindFns: {
                      [V in VariantTags<NonNullish<Current>, Tag> & (string | number | symbol)]: (
                          value: VariantOf<NonNullish<Current>, Tag, V>,
                          up: PatchBuilderInternal<
                              Root,
                              VariantOf<NonNullish<Current>, Tag, V>,
                              Tag,
                              R,
                              Extra,
                              Extensions
                          >,
                      ) => Result;
                  },
              ): Result;
          }
        : // 🔹 arrays → index navigation
          NonNullish<Current> extends (infer Elem)[]
          ? {
                [K in number]: PatchBuilderInternal<Root, Elem, Tag, R, Extra, Extensions>;
            } & {
                $push(value: Elem, when?: ApplyTiming): R;
                $move(move: ArrayMove, when?: ApplyTiming): R;
                $reorder(indices: number[], when?: ApplyTiming): R;
            }
          : // 🔹 plain objects (including unions that are NOT tagged on Tag)
            NonNullish<Current> extends object
            ? {
                  [K in KeysOfUnion<NonNullish<Current>> & (string | number)]: PatchBuilderInternal<
                      Root,
                      ValueOfUnion<NonNullish<Current>, K>,
                      Tag,
                      R,
                      Extra,
                      Extensions
                  >;
              } & (string extends keyof NonNullish<Current> // optional: index signatures (Record<string, V>)
                  ? {
                        [key: string]: PatchBuilderInternal<
                            Root,
                            NonNullish<Current>[string],
                            Tag,
                            R,
                            Extra,
                            Extensions
                        >;
                    }
                  : // biome-ignore lint: this one is fine
                    {})
            : // biome-ignore lint: this one is fine
              {});
