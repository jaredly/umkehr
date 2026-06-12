# Plan: Exported Block Rich Text Leaf Plugin

## Goal

Promote the current block-crdt spike into a first-class exported leaf CRDT plugin:

- export `blockRichTextLeafPlugin`
- provide a branded JSON value type for block rich text documents
- expose helpers for creating/materializing block rich text values
- integrate with core `src/crdt` leaf plugin registration and schema fingerprints
- add a hardcoded `$block` patch-builder surface, similar to the current `$text` surface

The general typed third-party builder extension API is intentionally out of scope for this pass.

## Phase 1: Public Block Leaf Module

Create a public module for the plugin, likely `src/block-richtext/index.ts` and `src/block-richtext/plugin.ts`.

Define:

- `BLOCK_RICH_TEXT_LEAF_PLUGIN_ID = 'umkehr.block-rich-text'`
- `BLOCK_RICH_TEXT_LEAF_PLUGIN_VERSION = 1`
- `BlockRichText`
- `BlockRichTextLeafMeta`
- `BlockRichTextPatchChange`
- `blockRichTextLeafPlugin`
- `blockRichText()`
- `blockRichTextWithState(...)` if useful for tests/fixtures

`BlockRichText` should be a branded JSON-compatible wrapper around `src/block-crdt` state:

```ts
export type BlockRichText = State & tags.JsonSchemaPlugin<{
    'x-umkehr-leaf-crdt': 'umkehr.block-rich-text';
    'x-umkehr-leaf-crdt-version': 1;
}> & {
    readonly [blockRichTextBrand]?: never;
};
```

Open choice: whether to use raw `State` directly as the public value, or wrap it with `{kind: 'block-rich-text', version: 1, state: State}`. The direct `State` approach is less migration churn for block-crdt internals; the wrapper is easier to distinguish at runtime. Prefer wrapper if it does not make the editor code much noisier.

Acceptance checks:

- typia schema output contains the generic leaf marker and version.
- `blockRichText()` returns a valid JSON value accepted by the plugin.
- `blockRichTextLeafPlugin` can be registered in `createCrdtDocument`.

## Phase 2: Plugin Implementation

Implement `blockRichTextLeafPlugin` using existing `src/block-crdt` primitives.

Use:

- `initialState(sessionId, ts)` for empty/init
- `cachedState(...)` for operation creation/application inputs
- `applyMany(...)` for applying raw ops
- `validateOp(...)` for operation validation
- `maxLamportCounterForOp(...)` to maintain leaf-local counter metadata
- `stateToString(...)`, `materializeFormattedBlocks(...)`, or new wrappers for render helpers

Metadata should track leaf-local allocation state:

```ts
type BlockRichTextLeafMeta = {
    maxSeenCount: number;
};
```

The plugin should accept two forms of patch changes:

```ts
type BlockRichTextPatchChange =
    | {kind: 'ops'; ops: Op[]}
    | {kind: 'insertText'; block: string | Lamport; offset: number; text: string}
    | {kind: 'deleteRange'; block: string | Lamport; startOffset: number; endOffset: number}
    | {kind: 'splitBlock'; block: string | Lamport; offset: number}
    | {kind: 'joinBlocks'; left: string | Lamport; right: string | Lamport}
    | {kind: 'moveBlock'; block: string | Lamport; parent: string | Lamport; before?: string | Lamport | null; after?: string | Lamport | null}
    | {kind: 'setBlockMeta'; block: string | Lamport; meta: DefaultBlockMeta};
```

Raw `ops` gives full escape-hatch coverage. The high-level variants cover the editor operations expected from a usable block rich text surface.

Important implementation details:

- Use `context.sessionId` as the block-crdt actor.
- Use `meta.data.maxSeenCount` or `state.maxSeenCount` for leaf-local counters.
- Convert string block ids with `parseLamportString`; accept `Lamport` too for low-level users.
- Generate HLC timestamps from the core update `ts` for block-crdt operations that need timestamps.
- Return one core `leaf` update per block-crdt `Op`, matching the spike and keeping validation simple.

Acceptance checks:

- raw `ops` changes validate and apply.
- high-level insert/delete/split/join/move/meta commands produce valid block-crdt ops.
- applying remote block ops updates both `state` and `LeafMeta.data.maxSeenCount`.
- invalid block ops fail CRDT update validation with a useful path/message.

## Phase 3: Undo/Redo Policy

Decide and implement undo support for the initial exported plugin.

Recommended first pass:

- support undo/redo where `planUndoOps(...)` can produce a plan
- return blocked/unsupported for operations the block undo planner marks unsupported
- keep the generic CRDT history result as `blocked` rather than throwing

Implementation hooks:

- `captureEffect`
- `createUndoOperations`
- `createRedoOperations`
- `checkEffect`

If full redo is awkward, ship with explicit unsupported undo for block leaves, but add tests documenting the behavior. Since this is a rich text editor plugin, prefer implementing at least insert/delete undo if the existing planner supports it cleanly.

Acceptance checks:

- `canUndoLocalCommand` returns true for supported block text insert operations.
- unsupported block operations produce a blocked undo result with reason `unsupported`.
- concurrent remote edits either remain undoable or block deterministically.

## Phase 4: Hardcoded `$block` Builder Surface

Add a hardcoded builder surface similar to `$text`.

Update:

- `src/types.ts`
- `src/helper.ts`
- `src/make.ts` only if needed
- `src/ops.ts` only if needed
- `src/history/history.ts` only if error text needs broadening

Add conditional builder methods for `BlockRichText`:

```ts
type BlockRichTextBuilderMethods<R> = {
    $block: {
        ops(ops: Op[], when?: ApplyTiming): R;
        insertText(block: string | Lamport, offset: number, text: string, when?: ApplyTiming): R;
        deleteRange(block: string | Lamport, startOffset: number, endOffset: number, when?: ApplyTiming): R;
        splitBlock(block: string | Lamport, offset: number, when?: ApplyTiming): R;
        joinBlocks(left: string | Lamport, right: string | Lamport, when?: ApplyTiming): R;
        moveBlock(args: MoveBlockArgs, when?: ApplyTiming): R;
        setBlockMeta(block: string | Lamport, meta: DefaultBlockMeta, when?: ApplyTiming): R;
    };
};
```

The runtime helper should emit:

```ts
{
    op: 'leaf',
    plugin: BLOCK_RICH_TEXT_LEAF_PLUGIN_ID,
    path,
    change
}
```

Acceptance checks:

- `$block` is available on `BlockRichText` values.
- `$block` is not available on plain objects or peritext `RichCollaborativeText`.
- builder payloads are type-checked.
- non-CRDT `History` still rejects `$block` leaf patches.

## Phase 5: Exports And Package Surface

Update package exports and barrels.

Likely changes:

- `package.json` exports:
  - `"./block-richtext"`
  - optional `"./block-richtext/*"`
- `src/block-richtext/index.ts`
- maybe export plugin from `src/block-crdt/index.ts` only if avoiding a new package path is preferred

Prefer a new `umkehr/block-richtext` package path. `umkehr/block-crdt` should remain the lower-level algorithm package; the leaf plugin is integration glue.

Acceptance checks:

- package smoke test can import `umkehr/block-richtext`.
- public exports include value constructor, plugin, constants, and useful render/materialize helpers.

## Phase 6: Core And Example Integration

Add a minimal core-CRDT-backed example or update the existing block-rich-text example to use the plugin path.

Option A: update `examples/block-rich-text` to create a core `CrdtDocument<{body: BlockRichText}>` and dispatch `$block` patches.

Option B: add a smaller example/test app first and leave the current standalone example as a comparison fixture.

Recommended order:

1. Add focused library tests first.
2. Add a small example integration in `examples/react-crdt` or a new fixture.
3. Decide whether to migrate the larger `examples/block-rich-text` after the plugin API feels stable.

For app definitions, register:

```ts
leafPlugins: [blockRichTextLeafPlugin]
```

Acceptance checks:

- schema fingerprint changes when block plugin version changes.
- missing block plugin registration fails document creation/import.
- local/peer/server protocol validation accepts block leaf updates when plugin is registered.

## Phase 7: Tests

Add focused tests before large example migration.

Core plugin tests:

- creates document with `BlockRichText`
- rejects missing plugin
- rejects plugin version mismatch
- validates raw op leaf updates
- applies insert text ops through `createCrdtUpdates` and `applyCrdtUpdate`
- converges two sessions applying concurrent block ops in different orders
- `changedNormalPathsForCrdtUpdate` returns the containing leaf path

Builder tests:

- `$block.insertText(...)` emits plugin-tagged `leaf` patch
- `$block.ops(...)` emits raw ops patch
- `resolveAndApply` carries `$block` patches without mutating public state
- non-CRDT history rejects `$block` patches

Fingerprint tests:

- `schemaFingerprintInput(...)` includes `{id: 'umkehr.block-rich-text', version: 1}`
- changing schema marker version changes hash

Package/API tests:

- package smoke import for `umkehr/block-richtext`
- typia marker test for `BlockRichText`

Example tests, if example is migrated:

- typecheck example
- one user-facing smoke test for editing/inserting text

## Phase 8: Cleanup

After the exported plugin is working, remove or revise the temporary block plugin spike in `src/crdt/leafPlugin.test.ts`.

Options:

- replace the test-only plugin with `blockRichTextLeafPlugin`
- keep one generic fake-plugin test only if it covers registry behavior not covered elsewhere

Also scan for duplicated block operation helpers between the plugin and example command code. Prefer moving shared command construction into the exported block-richtext module rather than duplicating in examples.

## Verification

Run:

```sh
npm run typecheck
npm run typecheck:examples
npm test
```

If the block-rich-text example is migrated and has e2e coverage, also run the relevant example tests.

## Known Risks

- Undo/redo may be the largest ambiguity. If the block undo planner cannot support all operations, document unsupported cases explicitly and make them block cleanly.
- Existing block editor command code may already encode UI-level decisions. Avoid dragging UI-only behavior into the plugin; keep the plugin operation-oriented.
- String block ids are easier for app code, but block-crdt internals use Lamport tuples. Conversion should be centralized.
- The first `$block` builder surface is intentionally hardcoded. Do not over-design a third-party extension mechanism in this pass.

