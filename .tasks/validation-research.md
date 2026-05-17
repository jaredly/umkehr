# Preserving type safety for untrusted patches

## Context

Umkehr currently has a strong in-process story:

- `createPatchBuilder<State>()` gives callers a typed way to construct `DraftPatch<State>` values.
- Navigation through `PatchBuilderInternal` encodes object keys, array element types, record/index-signature values, and tagged-union refinement through `$variant(...)`.
- `resolveAndApply(...)` realizes drafts into invertible `Patch<State>` values by reading the current state and adding state-dependent fields such as `previous` for `replace` and `value` for `remove`.
- `Patch<State>` itself stores `path`, `from`, `value`, and `previous` with broad runtime types (`Path` plus `unknown` payloads). The type parameter is currently phantom on the realized operation shapes.

That split is reasonable for trusted in-process construction. It is not enough for data received from a server, local storage, sync log, database, or another process.

`typia` is still useful for validating full `State` values. Its validator APIs generate code from TypeScript types at compile time, and `validate<T>()` returns a structured success/error result. Typia also supports type tags and custom tags, but those tags attach validation rules to values in the TypeScript type graph; they do not express cross-field semantics like "this path points to a value whose type is the type of this other property." See:

- https://typia.io/docs/validators/validate/
- https://typia.io/docs/json/schema/
- https://typia.io/docs/validators/tags/
- https://www.typescriptlang.org/docs/handbook/2/types-from-types.html

The hard problem is not structural validation of the patch object. The hard problem is semantic validation of the relationship between:

- the operation kind,
- its `path` and optional `from` path,
- the `State` type,
- operation payloads (`value`, `previous`, `indices`),
- and, for realized patches, the current state value.

This note assumes the untrusted format is the realized `Patch<State>` format, not `DraftPatch<State>`. `DraftPatch` can contain `nested` operations with functions, so it is not a serialization boundary.

## Validation levels

It helps to separate three different guarantees.

### 1. Patch envelope validation

This checks only that an unknown value looks like an Umkehr patch:

- `op` is one of `add`, `replace`, `remove`, `move`, `reorder`.
- `path` and `from` are arrays of valid path segments.
- key path segments are `{type: "key", key: string | number}`.
- tag path segments are `{type: "tag", key: string, value: string}`.
- `replace` has `value` and `previous`.
- `add` and `remove` have `value`.
- `move` has `from`.
- `reorder` has `indices: number[]`.

This is easy to validate with typia or a small hand-written validator. It does not prove type safety for `State`.

### 2. Schema-level patch validation

This validates a patch against the TypeScript shape of `State`, without looking at a particular current state instance:

- `path` is legal for `State`.
- `from` is legal for `State` and compatible with `path` for `move`.
- `value` has the type at `path` for `add` and `replace`.
- `previous` has the type at `path` for `replace`.
- `value` has the type at `path` for `remove`.
- `reorder.path` points to an array.
- tag segments refine tagged unions in the same way `$variant(...)` does.

This is the piece typia does not appear to provide directly. The validation rule depends on interpreting a runtime path as a traversal through a compile-time TypeScript type.

### 3. State-level patch validation

This validates a patch against a particular current `State` value:

- `replace.previous` equals the current value at `path`.
- `remove.value` equals the current value at `path`.
- `add` targets an absent object key or a valid array insertion position.
- `move.from` exists.
- `reorder.indices` is a permutation of the current array's indices and has the current array length.
- tag path segments match the actual discriminant values in the current state.

Some of these cannot be answered from the TypeScript type alone. They require the current state.

## Important distinction: type safety vs patch authenticity

If the goal is "an untrusted patch must not put the app into an invalid `State`," the simplest sound strategy is:

1. Validate the current state with `typia.validate<State>()`.
2. Validate the patch envelope.
3. Attempt to apply the patch with existing runtime checks.
4. Validate the resulting state with `typia.validate<State>()`.

This is conservative and probably enough for many trust boundaries. It catches invalid final state and catches many bad path/state preconditions through existing `ops.apply(...)` errors.

It does not prove that the patch is a well-typed `Patch<State>` in the same sense as one produced by `PatchBuilder`. For example, it treats type preservation as a postcondition. That may be fine for ingestion, but weaker for storage, auditability, error reporting, sync protocols, and rejecting nonsensical operations before mutation.

If the goal is "this untrusted value is a valid realized `Patch<State>`," we need schema-level and state-level validation.

## Why typia alone is not enough for `Patch<State>`

`Patch<T>` currently erases the interesting parts:

```ts
export type AddOp<_T> = {op: 'add'; path: Path; value: unknown};
export type ReplaceOp<_T> = {
    op: 'replace';
    path: Path;
    value: unknown;
    previous: unknown;
};
```

Typia can generate a validator for the structural type it sees. For `Patch<State>`, the structural type says `value: unknown`, `previous: unknown`, and `path: Path`. There is no TypeScript-level relationship saying:

- for path `[{type: "key", key: "title"}]`, `value` must be `string`;
- for path `[{type: "key", key: "items"}, {type: "key", key: 0}]`, `value` must be the array element type;
- for path through `{type: "tag", key: "type", value: "circle"}`, following keys must be checked against the `circle` union arm.

TypeScript can express many type transformations with `keyof`, indexed access, conditional types, mapped types, and template literal types, but the runtime path is data. The static type `Patch<State>` does not carry a finite discriminated union of all valid path/value combinations, and for arrays and records that union is not finite anyway.

Typia custom tags also do not seem to solve this directly. Custom tags can attach additional generated validation logic to a value type, but the patch invariant is relational: validating `value` requires inspecting sibling field `path` and interpreting it through the `State` type graph.

## Options

### Option A: Postcondition validation only

Provide an API like:

```ts
validateAndApplyPatch<State>(
    current: unknown,
    patch: unknown,
    validateState: (value: unknown) => Validation<State>,
    equal: EqualFn,
): Validation<{current: State; patch: Patch<State>}>;
```

Implementation:

- validate `current` as `State`;
- validate patch envelope;
- apply with `ops.apply`;
- validate the resulting state as `State`;
- return either structured errors or the typed result.

Pros:

- Small implementation.
- No compiler plugin required.
- Uses typia where it is strongest.
- Validates the actual safety property most applications care about: state remains valid.
- Existing runtime operation checks already cover many state-dependent preconditions.

Cons:

- Does not reject every semantically ill-typed patch before applying it.
- Error messages may say "resulting state is invalid" rather than "patch value at `items/0/done` must be boolean."
- A bad patch can be computationally expensive before it is rejected.
- Does not give a reusable "trusted `Patch<State>`" artifact independent of a current state.

This is a good baseline regardless of whether a stronger generator is later added.

### Option B: Hand-written generic runtime walker plus user-provided schema

Define a runtime schema representation for `State`, then validate paths and payloads by walking that schema.

This could be a small internal schema language:

```ts
const StateSchema = object({
    title: string(),
    items: array(object({id: string(), done: boolean()})),
    shape: taggedUnion("type", {
        circle: object({type: literal("circle"), radius: number()}),
        rect: object({type: literal("rect"), width: number()}),
    }),
});
```

Pros:

- No TypeScript transformer.
- Semantics are explicit.
- Can validate paths, values, previous values, `from`, and reorder targets.
- Can be used in any build system.

Cons:

- Duplicates the `State` type unless the schema becomes the source of truth.
- Less aligned with the current "derive from TypeScript type" direction.
- Users must learn and maintain an Umkehr schema DSL.

This is likely the most maintainable strong validator if avoiding compile-time code generation is a priority.

### Option C: Custom compile-time generator from `State`

Build an Umkehr generator that uses the TypeScript compiler API to emit validators for `Patch<State>`.

Possible API:

```ts
export const validateTodoPatch = umkehr.createPatchValidator<State>();
```

The transformer would replace that call with generated JavaScript that knows how to walk the `State` type graph. Generated code would include validators for reachable node types and a path interpreter matching `PatchBuilderInternal` semantics.

High-level generated algorithm:

1. Validate patch envelope and operation-specific required fields.
2. Walk `path` through a generated runtime representation of `State`.
3. At the terminal node, validate `value` and/or `previous` using generated validators for that node type.
4. For `move`, walk `from`, walk `path`, and check assignability or equality of schema nodes.
5. For `reorder`, ensure `path` resolves to an array schema.
6. If a current state is provided, also perform state-level checks.

Pros:

- Best match for the current typia-like user experience.
- No duplicated schema for users.
- Can provide precise patch-specific error messages.
- Can mirror `PatchBuilder` rules exactly if both are treated as one specification.

Cons:

- This is a real compiler project.
- TypeScript type analysis edge cases are substantial: unions, recursive types, aliases, optional properties, index signatures, readonly tuples, branded/intersection types, `any`, `unknown`, `never`, and imported types.
- Build-system integration is a long-term maintenance cost.
- If typia is already in the user build, a second transformer may create adoption friction.

This is the strongest long-term option, but should probably be preceded by a minimal runtime schema prototype or a narrower generator.

### Option D: Generate a schema, not a validator

Instead of generating final validation code, generate a compact schema graph from `State`, then use one shared runtime validator.

Possible API:

```ts
export const StatePatchSchema = umkehr.createPatchSchema<State>();
export const validatePatch = createPatchValidator(StatePatchSchema);
```

Pros:

- The compiler-generated output is easier to inspect and test than large predicate code.
- The path semantics live in normal runtime code.
- Could support debug tooling, docs, or protocol negotiation.

Cons:

- Slower than fully inlined generated validators.
- Still requires a compile-time generator.
- Schema format becomes a public or semi-public contract.

This may be a better first generator than fully inlined validation code.

#### Option D1: Use typia's generated JSON schema as the schema graph

Typia already exposes a public compile-time schema generator:

```ts
const schemas = typia.json.schemas<[State], "3.1">();
```

The generated value is an `IJsonSchemaCollection` with a `schemas` array and shared `components`. Typia's docs describe this as compile-time analysis of the target TypeScript types into OpenAPI 3.0 or 3.1 JSON schema. This is very close to what Umkehr needs for the "generate schema, interpret at runtime" approach.

An Umkehr API could therefore be:

```ts
const stateSchemas = typia.json.schemas<[State], "3.1">();
const validatePatch = createPatchValidator(stateSchemas);
```

or, if we want a tiny adapter:

```ts
const validatePatch = createTypiaPatchValidator<State>(
    typia.json.schemas<[State], "3.1">(),
);
```

The Umkehr-owned part would not be TypeScript type extraction. It would be a JSON-schema/OpenAPI walker that:

- resolves `$ref` through `components`;
- walks `object.properties`, `required`, and `additionalProperties`;
- walks `array.items` and tuple schemas where available;
- interprets `oneOf`/union schemas, especially discriminated unions;
- returns the schema node reached by an Umkehr `Path`;
- validates patch payloads against that reached schema node, probably by compiling or interpreting the sub-schema;
- performs patch-specific checks for `move` compatibility and `reorder` array targets.

This avoids writing an Umkehr transformer at first and keeps typia as the source of truth for TypeScript-to-schema conversion.

Pros:

- Reuses typia's existing compile-time type analysis.
- Keeps runtime validation proportional to the patch path and payload, not the whole `State`.
- Avoids validating a large next-state value just to accept or reject a small patch.
- Lets Umkehr ship normal runtime code plus an optional typia adapter.
- The generated schema is inspectable and potentially reusable for protocol/debug tooling.

Cons:

- JSON Schema is not TypeScript. Some TypeScript semantics are approximated or lost.
- Umkehr must still define its own path semantics over the generated schema.
- Discriminated union handling may require conventions or preprocessing; JSON Schema `oneOf` alone does not say "this is the `$variant` discriminant."
- Typia schema generation has JSON/OpenAPI limits; for example, typia documents that JSON schema generation does not support `bigint`.
- This couples strong patch validation to typia's emitted schema shape, so we should isolate it behind an adapter.

This is now the most promising version of Option D. The first prototype should take a typia OpenAPI 3.1 schema collection and implement only the schema traversal needed for existing Umkehr semantics: objects, arrays, records/additional properties, literals, simple unions, and tagged unions.

### Option E: PatchBuilder-authenticated patches

Make patches carry an unforgeable in-process brand when constructed by `PatchBuilder`, and treat unbranded patches as untrusted.

Pros:

- Clarifies the API boundary.
- Prevents accidental mixing of trusted in-process patches and decoded JSON.
- Cheap to implement.

Cons:

- Does not solve validation after serialization, because brands do not survive JSON.
- Does not validate server/database patches.

This is complementary to the validation work, not a replacement.

## Semantics the validator must decide

### `add`

For schema validation, `value` should be assignable to the target slot:

- object property type for object paths;
- element type for array paths;
- index-signature value type for records;
- root type for root add, if root add is allowed.

For state validation:

- object target must be missing or `undefined`, matching current `_add` behavior;
- array target must be a numeric insertion index;
- array bounds should be explicitly specified. Current `splice` semantics permit out-of-range insertion by clamping to the end. We should decide whether untrusted patches should allow that.

### `replace`

For schema validation, both `previous` and `value` should validate against the target type.

For state validation, `previous` must equal the current value at `path`.

### `remove`

For schema validation, `value` should validate against the target type.

For state validation, target must exist and `value` must equal the current value.

### `move`

For schema validation:

- `from` must resolve to a source type;
- `path` must resolve to a destination slot;
- source type must be assignable to destination type, or both schema nodes must be equivalent.

For state validation:

- `from` must exist;
- destination preconditions are similar to `add`, after removing source.

Open question: should moves be restricted to array/object siblings under the same parent? `PatchBuilder.$move` creates sibling moves by construction, but `MoveOp` can represent arbitrary `from` and `path`.

### `reorder`

For schema validation, `path` must resolve to an array.

For state validation, `indices` must be a permutation of the current array indices. Existing code already enforces this.

## Tricky type cases

### Tagged unions

`PatchBuilderInternal` forces `$variant(...)` navigation for tagged unions. Runtime validation should probably require the equivalent `{type: "tag", key, value}` segment before navigating into variant-specific fields.

Question: should paths into common fields of a tagged union be allowed without a tag segment? The builder currently treats a tagged union as requiring `$variant`, so the stricter answer is "no."

### Untagged unions

The builder permits navigation over keys of non-tagged unions with value type equal to the union of matching property types. A validator can mirror that, but error messages and move compatibility become less obvious.

Question: should untrusted patch validation support this fully, or should it reject ambiguous union paths unless the schema can prove a single target type?

### Optional properties

For a path through an optional object, static validation can say the path is legal, but state validation may fail if the parent value is absent. This matches current `_get` behavior.

Question: should schema validation treat `undefined` as part of the terminal value type for optional properties? For `replace`, the current realized patch model records `previous`, so replacing an absent optional is normally realized as `add`, not `replace`.

### Records and index signatures

Records are feasible: any string key maps to the index-signature value type. This matches the builder's string index-signature support.

Question: should numeric-looking string keys be normalized to numbers only for array paths, as `createPatchDispatcher` does during property navigation?

### Arrays and tuples

Plain arrays are straightforward. Tuples need a decision:

- Treat tuples as arrays of the union of element types.
- Or preserve per-index tuple types for numeric literal indices.

The first is simpler; the second is more type-safe but more complex.

### `any` and `unknown`

If the `State` type contains `any` or `unknown`, a generated validator cannot recover safety below that point.

Question: should the generator reject paths through `any`, accept anything, or require user-supplied validators?

## Recommended direction

Start with two layers:

1. Add a small, explicit validator for the patch envelope.
2. Add a `validateAndApplyPatch` helper that validates current state, validates the envelope, applies the patch, and validates the next state with a user-provided state validator.

That gives a sound ingestion story quickly:

- untrusted input cannot be treated as a patch without structural validation;
- invalid operations are rejected by existing operation checks;
- invalid final state is rejected by typia.

Then prototype strong schema-level validation with a runtime schema representation before committing to a TypeScript transformer. The schema prototype will force the semantics to become crisp: union navigation, optional values, tuple behavior, move compatibility, and array bounds. Once those semantics are stable, a compile-time generator can target the same schema format.

## Option questions

1. What guarantee do we want to advertise first: "safe to apply because the resulting state validates" or "this value is a semantically valid `Patch<State>`"?
2. Is validation always performed against a current state, or do we need to validate patches offline before a current state is available?
3. Should untrusted `move` patches be allowed to move across unrelated paths, or only within the same parent as the builder currently constructs?
4. Should array `add` reject indices outside `[0, length]` even though JavaScript `splice` is more permissive?
5. Should tagged-union paths require explicit tag segments for all navigation, matching the builder?
6. How should untagged unions be handled: permissive union-of-fields behavior, or rejection of ambiguous paths?
7. Should optional terminal properties allow `replace` with `previous: undefined`, or should absent optional writes always be represented as `add`?
8. Should tuple types preserve per-index validation, or collapse to array-of-union semantics?
9. What is the story when `State` contains `any` or `unknown`?
10. Are users willing to add an Umkehr compile-time transform, especially if they already use typia?
11. Should Umkehr expose a schema DSL as an alternative for users who cannot or do not want to use a transformer?
12. Do persisted patches need canonicalization, versioning, or migration support as `State` evolves?

## Proposed near-term API sketch

```ts
type ValidationError = {
    path: string;
    expected: string;
    value: unknown;
    message?: string;
};

type Validation<T> =
    | {success: true; data: T}
    | {success: false; data: unknown; errors: ValidationError[]};

function validatePatchEnvelope(input: unknown): Validation<Patch<unknown>>;

function validateAndApplyPatch<T>(
    current: unknown,
    patch: unknown,
    validateState: (input: unknown) => Validation<T>,
    equal: EqualFn,
): Validation<{current: T; patch: Patch<T>}>;
```

Later, a stronger generated validator could fit beside it:

```ts
const validatePatch = createPatchValidator<State>();

const result = validatePatch(input, {
    current,
    equal,
    mode: "schema-and-state",
});
```

The immediate API should avoid promising more than it proves. A postcondition-based helper can be documented as "validates that this patch can be applied to this state and produces a valid next state." A future generated validator can be documented as "validates Umkehr patch semantics for `State`."
