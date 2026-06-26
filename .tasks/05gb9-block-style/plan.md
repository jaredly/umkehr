# Plan: Block Styles

## Decisions From Research

- Add `style` as a first-class field on every block, separate from `meta`.
- Use patch-style `block:style` ops.
- Merge style LWW independently per attribute.
- Use `null` as the unset/default value for a style attribute.
- Block-rich-text supported attributes:
  - `background-color`: any string or `null`
  - `color`: any string or `null`
  - `font-size`: `xsmall | small | normal | large | xlarge | null`
  - `padding`: `xsmall | small | normal | large | xlarge | null`
- Preserve block style in document import/export.
- Preserve block style in rich clipboard copy/paste.
- Style changes should participate in undo/redo.
- Do not add configurable style merge behavior to `VirtualBlockParentConfig`.
- Remove slide metadata `backgroundColor`; slides should use `block.style['background-color']`.
- Background color should apply to the whole block, including children. Image background should wrap the whole image block including padding.

## Phase 1: Core CRDT Style Model

Update the block CRDT data model and operation layer.

Files:

- `src/block-crdt/types.ts`
- `src/block-crdt/initialState.ts`
- `src/block-crdt/changes.ts`
- `src/block-crdt/apply.ts`
- `src/block-crdt/ops.ts`
- `src/block-crdt/index.ts`

Tasks:

1. Add exported types:

   ```ts
   export type BlockStyle = Record<string, {value: JsonValue; ts: HLC}>;
   export type BlockStylePatch = Record<string, {value: JsonValue; ts: HLC}>;
   ```

2. Add `style: BlockStyle` to `Block`.

3. Add a new op:

   ```ts
   | {type: 'block:style'; id: Lamport; style: BlockStylePatch}
   ```

4. Initialize all new blocks with `style: {}`:

   - initial states
   - `blockBetween`
   - split/insert helpers
   - custom block ops created by example code or tests

5. Add `setBlockStyleOps(state, {block, style})`.

6. Implement per-attribute LWW merge:

   - missing local attr accepts incoming attr
   - higher `ts` wins
   - equal `ts` resolves deterministically, likely with `JSON.stringify(value)` as a tie-breaker
   - `value: null` is retained in the CRDT as the winning unset marker

7. In `applyBlock`, merge incoming full-block `style` into existing block style with the same helper used by `block:style`.

8. Update op validation, max counter, dependency checks, and exports for `block:style`.

9. Update any exhaustive switches that break after adding the op.

Tests:

- `src/block-crdt/index.test.ts`
  - initial block has `style: {}`
  - inserted/split-created blocks have `style: {}`
  - `block:style` accepts patches with multiple independent attributes
  - stale attr update is ignored while newer sibling attr is accepted
  - equal timestamp conflicts converge deterministically regardless of op order
  - full `block` op and `block:style` op commute for existing blocks
  - unknown block id returns pending/missing block dependency

## Phase 2: Undo, History, And Runtime Clock Safety

Make style operations replayable, importable, and undoable.

Files:

- `src/block-crdt/undo.ts`
- `examples/block-rich-text/src/history.ts`
- `examples/block-rich-text/src/undoHistory.ts`
- `examples/block-rich-text/src/blockEditorRuntime.ts`
- `examples/block-rich-text/src/history.test.ts`
- `examples/block-rich-text/src/undoHistory.test.ts`

Tasks:

1. Add `block:style` support to `planUndoOps`.

   For each style attr in the original patch:

   - if the attr existed before, emit `{value: beforeValue, ts: nextTs()}`
   - if it did not exist before, emit `{value: null, ts: nextTs()}`

2. Ensure redo works through existing undo-of-undo flow.

3. Add `block:style` to `CURRENT_OP_TYPES` in history import validation.

4. Update history op parsing validation so block style patches are accepted and malformed patches are rejected.

5. Update `stateTimestamps` in `blockEditorRuntime.ts` to include every block style attr `ts`. This keeps local HLC generation ahead of received style updates.

Tests:

- undoing a style command restores the previous style
- undoing a newly-set attr emits `null`
- redo reapplies the style
- history import/export accepts `block:style`
- local timestamps advance after receiving remote style ops

## Phase 3: Block-Rich-Text Style Helpers

Add example-level style validation, commands, and multi-selection behavior.

Files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/multiSelectionCommands.ts`
- related command tests

Tasks:

1. Add supported style constants/types:

   ```ts
   export type RichBlockStyleAttribute =
       | 'background-color'
       | 'color'
       | 'font-size'
       | 'padding';
   ```

2. Add size value helpers:

   ```ts
   type RichBlockStyleSize = 'xsmall' | 'small' | 'normal' | 'large' | 'xlarge';
   ```

3. Add validators/normalizers:

   - colors: any string or `null`
   - sizes: one of the size values or `null`
   - unsupported attrs should be ignored by rendering/import or rejected at command/document parse boundaries

4. Add command helpers mirroring metadata:

   - `setBlockStyle`
   - `updateBlockStyle`
   - `setBlockStyleEverywhere`
   - `updateBlockStyleEverywhere`

5. Commands should use one timestamp per changed attribute.

6. Commands should no-op if the normalized new value already matches the effective current value.

Tests:

- setting one style attr does not disturb another
- multi-selection applies style to all selected blocks
- `null` unsets an attr
- unsupported/invalid values are rejected or ignored according to helper boundary

## Phase 4: Rendering And UI Controls

Render styles and expose controls in block-rich-text.

Files:

- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/style.css`
- `examples/block-rich-text/src/App.test.tsx`

Tasks:

1. Convert block style records into React/CSS props.

   Suggested mapping:

   - `background-color` string -> `backgroundColor`
   - `color` string -> `color`
   - `font-size` size -> CSS class or CSS variable
   - `padding` size -> CSS class or CSS variable

2. Treat `null`, missing attrs, and invalid values as unset/default.

3. Apply background and padding at the whole-block wrapper level so they include children.

4. Apply text color and font size so editable text and common block content inherit them.

5. Verify complex block behavior:

   - image background wraps figure/caption
   - preview and poll blocks do not lose readability
   - tables and nested children inherit or override coherently
   - callouts still show their existing semantic styling

6. Extend `BlockOptions` with style controls.

   Suggested controls:

   - color input or text input for `color`
   - color input or text input for `background-color`
   - select for `font-size`
   - select for `padding`
   - reset/unset action for each attr

7. Wire controls through `renderEditableBlock` callbacks to style command helpers.

8. Use command labels so history/undo UI remains understandable.

Tests:

- UI can set and unset each supported style
- style survives remote sync between left/right editors
- background covers child blocks where applicable
- image block background covers the whole figure
- style controls are undoable and redoable

## Phase 5: Slide Background Migration

Remove slide-specific metadata background color and replace it with generic block style.

Files:

- `examples/block-rich-text/src/blockMeta.ts`
- `examples/block-rich-text/src/blockTypeHelpers.ts`
- `examples/block-rich-text/src/blockCommands.ts`
- `examples/block-rich-text/src/EditorApp.tsx`
- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/history.ts`
- `examples/block-rich-text/src/documentFixtures.ts`
- tests referencing `backgroundColor`

Tasks:

1. Remove `backgroundColor` from `SlideMeta`.

2. Update `defaultSlideMeta` so it no longer supplies a background.

3. When creating a new slide, set `block.style['background-color']` to the old default if a visible default is still desired. If not, let CSS/default rendering handle it.

4. Update `SlideBlockView` to read slide background from `node.block.block.style['background-color']`.

5. Replace slide background controls with the generic style control for `background-color`.

6. Update document import:

   - new format should use `block.style.background-color`
   - optionally accept old `meta.backgroundColor` as a backward-compatible import alias, converting it into block style

7. Update document export to omit slide `meta.backgroundColor` and include style instead.

8. Update clipboard parsing/serialization similarly.

9. Update fixtures and tests that currently include slide `meta.backgroundColor`.

Tests:

- old document slide metadata background imports into style if compatibility is kept
- exported slides use `style`, not `meta.backgroundColor`
- slide rendering background comes from block style
- slide background undo/redo works through `block:style`

## Phase 6: Document Import/Export

Preserve block style in the example document format.

Files:

- `examples/block-rich-text/src/documentFormat.ts`
- `examples/block-rich-text/src/documentFormat.test.ts`
- `examples/block-rich-text/src/documentFixtures.ts`
- `examples/block-rich-text/src/documentFixtures.test.ts`

Tasks:

1. Add `style?: Record<string, JsonValue>` or a narrower document style type to `DocumentBlock`.

2. Parse style objects with the same supported attribute validation:

   - colors: string or `null`
   - sizes: allowed size string or `null`

3. Import parsed style by emitting `block:style` patches after block insertion.

4. Generate timestamps for each imported style attr.

5. Export style by converting CRDT `{value, ts}` records into plain document style values.

6. Omit missing attrs and probably omit `null` attrs from exported document style unless retaining explicit unsets is useful.

7. Include style on annotation body blocks and nested children.

Tests:

- imports style onto blocks
- exports style from blocks
- round-trips nested styled blocks
- rejects invalid size values
- accepts arbitrary color strings
- handles `null` unset values

## Phase 7: Rich Clipboard

Preserve block style in internal rich clipboard payloads.

Files:

- `examples/block-rich-text/src/clipboard.ts`
- `examples/block-rich-text/src/clipboard.test.ts`
- paste paths in `examples/block-rich-text/src/multiSelectionCommands.ts` if needed

Tasks:

1. Add `style` to `ClipboardFragment`.

2. Serialize style in `fragmentForRange`.

3. Parse and validate style in `parseFragments`.

4. Preserve style when pasting fragments as new blocks.

5. Add style to generated HTML where useful:

   - `style` attribute on block tags for `background-color`, `color`, maybe padding/font-size
   - keep internal JSON payload authoritative

6. Preserve style for annotation body fragments.

Tests:

- copying whole blocks includes style in JSON payload
- pasting rich payload preserves style
- copying a partial selection preserves the source block style consistently with current metadata behavior
- malformed clipboard style is rejected

## Phase 8: Broad Compatibility And Cleanup

Fix raw block constructors, tests, and docs impacted by the required `style` field.

Files:

- `src/block-crdt/*.test.ts`
- `examples/block-rich-text/src/*.test.ts`
- `src/block-crdt/Readme.md`
- any raw `Block` literals found by typecheck

Tasks:

1. Update raw block literals to include `style: {}` or intentional style data.

2. Update tests that assert exact block/meta snapshots.

3. Update README/API snippets if they show block shape or op shape.

4. Consider whether `cachedState` should normalize missing `style` from older raw state. If not, document that persisted block-crdt states need migration.

Verification:

```sh
npm exec vitest -- run src/block-crdt/index.test.ts src/block-crdt/formatting.test.ts
npm exec vitest -- run examples/block-rich-text/src/blockCommands.test.ts examples/block-rich-text/src/documentFormat.test.ts examples/block-rich-text/src/clipboard.test.ts examples/block-rich-text/src/undoHistory.test.ts
npm exec vitest -- run examples/block-rich-text/src/App.test.tsx
npm run typecheck
npm run typecheck:examples
```

If `App.test.tsx` is too slow during iteration, run focused tests first and leave the full file for the end.
