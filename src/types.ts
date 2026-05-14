/* -------------- utility types ---------------- */

// Strip null/undefined for navigation
type NonNullish<T> = Exclude<T, null | undefined>;

// "Is this a union?" helper
// biome-ignore lint: this one is fine
type IsUnion<T, U = T> = (T extends any ? (x: T) => void : never) extends (
	x: U,
) => void
	? false
	: true;

// All tag values for a given discriminant
type VariantTags<T, Tag extends PropertyKey> = T extends { [K in Tag]: infer V }
	? V
	: never;

// The arm of a tagged union where Tag == V
type VariantOf<
	T,
	Tag extends PropertyKey,
	V extends VariantTags<T, Tag>,
> = Extract<T, { [K in Tag]: V }>;

// "Is this a tagged union on Tag?"
// biome-ignore lint: this one is fine
type IsTaggedUnion<Current, Tag extends PropertyKey> =
	NonNullish<Current> extends { [K in Tag]: any }
		? IsUnion<NonNullish<Current>>
		: false;

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

export type AddOp<T> = { op: "add"; path: Path; value: unknown };

export type ReplaceOp<T> = {
	op: "replace";
	path: Path;
	value: unknown;
	previous: unknown;
};

export type RemoveOp<T> = { op: "remove"; path: Path; value: unknown };

export type MoveOp<T> = { op: "move"; from: Path; path: Path };

export type CopyOp<T> = { op: "copy"; from: Path; path: Path };

export type ReorderOp<T> = {
	op: "reorder";
	path: Path;
	indices: number[];
};

export type Patch<T> =
	| AddOp<T>
	| ReplaceOp<T>
	| RemoveOp<T>
	| MoveOp<T>
	| CopyOp<T>
	| ReorderOp<T>;

export type DraftReplace<T> = {
	op: "replace";
	path: Path;
	value: unknown;
};

export type DraftRemove<T> = { op: "remove"; path: Path };

export type DraftPush<T> = {
	op: "push";
	path: Path;
	value: unknown;
};

export type DraftNested<T, Inner, Tag extends PropertyKey, Extra = unknown> = {
	op: "nested";
	path: Path;
	make: (
		v: Inner,
		update: PatchBuilderInternal<
			Inner,
			Inner,
			Tag,
			DraftPatch<Inner, Tag, Extra>,
			Extra
		>,
	) => DraftPatch<Inner, Tag, Extra> | DraftPatch<Inner, Tag, Extra>[];
};

export type DraftPatch<T, Tag extends PropertyKey = "type", Extra = unknown> =
	| AddOp<T>
	| DraftReplace<T>
	| DraftPush<T>
	| ReorderOp<T>
	| DraftRemove<T>
	| DraftNested<T, unknown, Tag, Extra>
	| MoveOp<T>
	| CopyOp<T>;

/* ---------------- builder and stuff ---------------- */

export type ApplyTiming = "immediate" | "preview" | undefined;

export type PathSegment =
	| { type: "key"; key: string | number }
	| { type: "tag"; key: string; value: string };

export const pathToString = (path: PathSegment[]) =>
	path
		.map((p) => (p.type === "key" ? p.key : `[${p.key}=${p.value}]`))
		.join("/");

type ReplaceAndTestMethodsA<Value, Tag extends PropertyKey, R, Extra> = {
	$replace(value: Value, when?: ApplyTiming): R;
	$update(opMaker: OpMaker<Value, Tag, Extra>, when?: ApplyTiming): R;
};

// Only if P is an AddPath<Root, C>
type AddMethodsA<Value, R> = { $add(value: Value, when?: ApplyTiming): R };

// Only if P is a RemovablePath<Root, C>
type RemoveMethodsA<R> = { $remove(when?: ApplyTiming | React.MouseEvent): R };

export type OpMaker<Value, Tag extends PropertyKey, Extra> = (
	v: Value,
	update: PatchBuilderInternal<
		Value,
		Value,
		Tag,
		DraftPatch<Value, Tag, Extra>,
		Extra
	>,
) => DraftPatch<Value, Tag, Extra> | DraftPatch<Value, Tag, Extra>[];

type UpdateFunction<Value, Tag extends PropertyKey, R, Extra> = (
	opMaker: Value | OpMaker<Value, Tag, Extra>,
	when?: ApplyTiming,
) => R;

export const getPathSymbol = Symbol("get path");
export const getExtraSymbol = Symbol("get extra");

export type PatchBuilderInternal<
	Root,
	Current,
	Tag extends PropertyKey,
	R,
	Extra = unknown,
> = AddMethodsA<Current, R> & {
	// operations at this path (unchanged)
	[getPathSymbol]: Path;
	[getExtraSymbol]: Extra;
} & ReplaceAndTestMethodsA<Current, Tag, R, Extra> &
	RemoveMethodsA<R> &
	UpdateFunction<Current, Tag, R, Extra> &
	// navigation
	// 🔹 tagged union → must choose an arm via variant()
	(IsTaggedUnion<Current, Tag> extends true
		? {
				$variant<
					V extends VariantTags<NonNullish<Current>, Tag> &
						(string | number | symbol),
				>(
					tag: V,
				): PatchBuilderInternal<
					Root,
					VariantOf<NonNullish<Current>, Tag, V>,
					Tag,
					R,
					Extra
				>;
				$variant<Result>(
					value: Current,
					kindFns: {
						[V in VariantTags<NonNullish<Current>, Tag> &
							(string | number | symbol)]: (
							value: VariantOf<NonNullish<Current>, Tag, V>,
							up: PatchBuilderInternal<
								Root,
								VariantOf<NonNullish<Current>, Tag, V>,
								Tag,
								R,
								Extra
							>,
						) => Result;
					},
				): Result;
			}
		: // 🔹 arrays → index navigation
			NonNullish<Current> extends (infer Elem)[]
			? {
					[K in number]: PatchBuilderInternal<Root, Elem, Tag, R, Extra>;
				} & {
					$push(value: Elem, when?: ApplyTiming): R;
					$move(
						from: string | number,
						to: string | number,
						when?: ApplyTiming,
					): R;
					$reorder(indices: number[], when?: ApplyTiming): R;
				}
			: // 🔹 plain objects (including unions that are NOT tagged on Tag)
				NonNullish<Current> extends object
				? {
						[K in KeysOfUnion<NonNullish<Current>> &
							(string | number)]: PatchBuilderInternal<
							Root,
							ValueOfUnion<NonNullish<Current>, K>,
							Tag,
							R,
							Extra
						>;
					} & {
						$move(
							from: string | number,
							to: string | number,
							when?: ApplyTiming,
						): R;
					} & (string extends keyof NonNullish<Current> // optional: index signatures (Record<string, V>)
							? {
									[key: string]: PatchBuilderInternal<
										Root,
										NonNullish<Current>[string],
										Tag,
										R,
										Extra
									>;
								}
							: // biome-ignore lint: this one is fine
								{})
				: // biome-ignore lint: this one is fine
					{});
