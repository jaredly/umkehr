# Research: Block Styles

## Goal

Add a first-class `style` object to every `src/block-crdt` block, separate from block metadata. Each style attribute should be independently updateable with LWW semantics:

```ts
Record<string, {value: JsonValue; ts: string}>
```

Then expose initial block-rich-text support for:

- `background-color`
- `font-size`
- `color`

## Current State

The block CRDT block shape is currently:

```ts
export type Block<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    id: Lamport;
    meta: M;
    order: BlockOrder;
    deleted: boolean;
};
```

`meta` is currently the only user-facing per-block payload. It is whole-record LWW by default:

- `Op` has `block` and `block:meta`, but no style-specific op.
- `applyBlockMeta` calls `mergeBlockMeta`.
- `mergeBlockMeta` returns `incoming` only when `incoming.ts > current.ts`, unless `VirtualBlockParentConfig.mergeBlockMeta` overrides it.
- `applyBlock` also merges the incoming block's `meta` against an existing block if the block is already present.

This means unrelated metadata fields can conflict unless the example provides a custom merge. The rich text example already has some large metadata records, most notably polls, slides, preview blocks, and code block options.

Block-rich-text defines its metadata union in `examples/block-rich-text/src/blockMeta.ts` as `RichBlockMeta`. It uses metadata for structural and block-specific behavior, including:

- block type and heading/list/todo/code/callout settings
- slide deck and slide settings
- poll state and votes
- image and preview block settings

The editor command layer wraps metadata updates through:

- `setBlockMeta` / `updateBlockMeta` in `examples/block-rich-text/src/blockCommands.ts`
- `setBlockMetaEverywhere` / `updateBlockMetaEverywhere` in `examples/block-rich-text/src/multiSelectionCommands.ts`
- many render callbacks in `EditorApp.tsx` that call `setBlockMeta`

Rendering flows through `materializeFormattedBlocks` in `src/block-crdt/marks.ts`. A `FormattedBlock` currently carries:

```ts
{
    id: string;
    block: Block<M>;
    runs: FormattedRun[];
    depth: number;
    parentId: string;
}
```

Since it includes the whole `Block`, adding `block.style` should naturally be available anywhere formatted blocks are used.

## Recommended CRDT Shape

Add explicit style types in `src/block-crdt/types.ts`:

```ts
export type BlockStyle = Record<string, {value: JsonValue; ts: HLC}>;
export type BlockStylePatch = Record<string, {value: JsonValue; ts: HLC}>;

export type Block<M extends TimestampedBlockMeta = DefaultBlockMeta> = {
    id: Lamport;
    meta: M;
    style: BlockStyle;
    order: BlockOrder;
    deleted: boolean;
};
```

The task text says `Record<string, {value: JsonValue, ts: string}>`; using the existing `HLC` alias for `ts` keeps the code consistent while preserving the requested runtime shape.

Add a style op rather than overloading `block:meta`:

```ts
| {type: 'block:style'; id: Lamport; style: BlockStylePatch}
```

The apply rule should merge per attribute:

- if the block is missing, `block:style` is pending with the block id as its missing dependency
- if an incoming style key does not exist locally, accept it
- if `incoming[key].ts > current[key].ts`, accept it
- if timestamps are equal, use a deterministic tie-breaker

The existing metadata LWW logic does not currently use a tie-breaker for equal timestamps. For block style, equal timestamps are less likely if all updates use HLCs from the local replica, but concurrent imports/tests can create equal strings. A deterministic tie-breaker avoids divergent replicas. Possible rule: compare `{value, ts}` by `ts`, then `JSON.stringify(value)` if timestamps are equal. This is only needed when two values are different at the same ts.

`block` ops should carry full `style`. In `applyBlock`, if the block already exists, style should merge attribute-wise exactly like `block:style` rather than replacing the full style object. This keeps late full-block ops and standalone style ops commutative.

## Files To Update

Core CRDT:

- `src/block-crdt/types.ts`
  - add `BlockStyle` and optional `BlockStylePatch` exports
  - add `style: BlockStyle` to `Block`
  - add `block:style` to `Op`
- `src/block-crdt/initialState.ts`
  - initialize blocks with `style: {}`
- `src/block-crdt/changes.ts`
  - ensure `blockBetween` and all inserted blocks include `style: {}`
  - add `setBlockStyleOps(state, {block, style})`
  - optionally add `setBlockStyleAttributeOps` as a convenience
- `src/block-crdt/apply.ts`
  - add `applyBlockStyle`
  - merge style inside `applyBlock`
  - include `block:style` in pending dependency handling
- `src/block-crdt/ops.ts`
  - include `block:style` in validation, lamport extraction, and max counter logic
  - style values do not contain Lamports, so max counter only needs `op.id[0]`
- `src/block-crdt/index.ts`
  - export the new style types and helper ops
- `src/block-crdt/undo.ts`
  - inspect undo planning for exhaustive `Op` switches; add a no-op/unsupported path if needed
- tests in `src/block-crdt/index.test.ts`
  - style field exists on initial and inserted blocks
  - `block:style` merges independent attributes
  - stale attribute updates are ignored without suppressing newer sibling attributes
  - full `block` insert merged with existing block preserves newer local style attributes
  - pending behavior for unknown block id

Block-rich-text:

- `examples/block-rich-text/src/blockMeta.ts`
  - define supported rich block style attribute names and validation helpers
  - recommended type:

    ```ts
    export type RichBlockStyleAttribute = 'background-color' | 'font-size' | 'color';
    ```

- `examples/block-rich-text/src/blockCommands.ts`
  - add `setBlockStyle` and `updateBlockStyle`
  - likely mirror `setBlockMeta`, returning `CommandResult`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
  - add `setBlockStyleEverywhere` / `updateBlockStyleEverywhere` using the existing block-meta command traversal
- `examples/block-rich-text/src/EditorApp.tsx`
  - derive React `CSSProperties` from `block.block.style`
  - apply style to the block row, editable surface, or type-specific wrapper
  - extend `BlockOptions` with controls for the three supported attributes
- `examples/block-rich-text/src/clipboard.ts`
  - decide whether rich clipboard fragments should include `style`
  - if yes, update `ClipboardFragment`, `fragmentForRange`, parse validation, HTML rendering, and paste handling
- `examples/block-rich-text/src/documentFormat.ts`
  - decide whether import/export documents should include `style`
  - if yes, update `DocumentBlock`, parse/export, and import insertion flow
- `examples/block-rich-text/src/blockEditorRuntime.ts`
  - update `stateTimestamps` to include block style attribute timestamps, otherwise local HLC generation can lag behind received style updates
- tests in `examples/block-rich-text/src/*`
  - add focused command/render tests if this is implemented in the editor
  - update any fixtures or exact block-shape assertions that construct raw `Block` values

## Rendering Notes

The simplest render path is:

1. Convert the CRDT style record into a React style object:

    ```ts
    const blockStyle = stylePropsForBlock(block.block.style);
    ```

2. Only pass through recognized attributes with safe value checks:

    - `background-color`: string accepted by a conservative hex-color validator, or possibly any CSS color string if product wants flexibility
    - `color`: same validator as background
    - `font-size`: probably constrained to a small enum or a clamped CSS length string

3. Apply the resulting style to `.blockRow` for background and to the editable surface for text color/font size. Applying all three to `.blockRow` may work via CSS inheritance for text, but type-specific wrappers like image, preview, poll, and code preview need verification.

Slides already have `meta.backgroundColor`. That is different from generic `style['background-color']`. If both are set, there needs to be a clear precedence rule in the render layer.

## Persistence And Compatibility

Adding a required `style` field to `Block` is a raw-state shape change. Existing tests and persisted states may omit it.

Options:

- Make `style` required in the TypeScript type and update all constructors/tests. This is clean for new data but requires all callers to set `style: {}`.
- Make `style?: BlockStyle` in the type and normalize to `{}` in helpers/rendering. This is backward-compatible but weakens the "every block should have a style object" requirement.
- Keep `style` required, but make `cachedState` or an explicit migration normalize loaded raw states. This is likely the best long-term answer if persisted block CRDT states exist.

I would implement the clean required field and add a small normalization/migration only if there is an existing persistence contract for raw `State` outside tests.

## Open Questions

1. Should `block:style` set one attribute per op or accept a patch with multiple attributes?

   The requested type is a record, so a patch op is natural. The apply semantics still need to be per attribute.

    - patch sounds good

2. How should a style attribute be removed?

   The requested record has `{value: JsonValue; ts: string}` but no tombstone. Options:

   - use `value: null` as "unset"
   - add an explicit `{value: JsonValue | undefined}` is not valid JSON
   - add a separate remove op
   - keep unset unsupported for the first pass

   For UI controls with defaults, `null` as unset is the most compact, but it should be documented.

    - null is good

3. What validation should block-rich-text enforce for style values?

   Recommended first pass:

   - `background-color`: hex color string or `null`
   - `color`: hex color string or `null`
   - `font-size`: one of a small set like `'small' | 'normal' | 'large' | 'x-large'`, or a clamped pixel number

   The task names CSS-like attributes, but the CRDT stores `JsonValue`, so the example does not have to accept arbitrary CSS strings.

    - any string for colors. xsmall/small/normal/large/xlarge for font size
    - let's add in `padding` as well, with the same size strings

4. Where should styles apply in complex blocks?

   Regular text blocks are straightforward. Complex blocks need explicit decisions:

   - image caption only or whole figure?
   - preview card subtitle only or whole card?
   - poll question only or full poll card?
   - table row/cell wrapper or editable text inside the cell?
   - slide generic style vs slide metadata background?

    -> let's remove the slide metadata background color, and just use the block.style.background-color
    -> image background should be around the whole block (including padding)
    -> in general, background color should apply to the whole 'block', including children

5. Should document import/export include block style?

   If the example is meant to demonstrate persistence, yes. Add `style?: Record<string, JsonValue>` to `DocumentBlock` and generate CRDT timestamps on import. Export probably should omit unset/null/default values.

    - definitely

6. Should rich clipboard include block style?

   Rich internal copy/paste probably should preserve styles, especially when copying whole blocks. Partial text selection is less clear: copying part of a block currently creates a fragment with the source block's `meta`; preserving style would be consistent with that behavior.

    - yes

7. Should style updates participate in undo/redo?

   Block option changes currently flow through command history. Style controls should probably do the same. Undo code needs to either invert `block:style` patches or mark style changes as unsupported by CRDT-level undo if the example history handles them differently.

    - yes

8. Should `VirtualBlockParentConfig` include style merge customization?

   Probably not for the first pass. Unlike metadata, style merge semantics are fixed by the task: independent LWW attributes.

    - no

## Suggested Implementation Order

1. Add core CRDT style types, initial `style: {}`, `block:style` op, apply merge, and tests.
2. Export `setBlockStyleOps` from `umkehr/block-crdt`.
3. Update block-rich-text command helpers and runtime timestamp collection.
4. Add rendering and `BlockOptions` controls for the three supported attributes.
5. Decide and implement document/clipboard style preservation.
6. Run:

```sh
npm exec vitest -- run src/block-crdt/index.test.ts
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/App.test.tsx
npm run typecheck:examples
```

The second command may be too broad if `App.test.tsx` is slow; add focused tests first and widen only after the CRDT behavior is stable.
