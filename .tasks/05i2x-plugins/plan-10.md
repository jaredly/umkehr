# Plan 10: Phase 10 Custom Selection Extension Point

## Context

Phases 1-9 give the editor a plugin registry that can declare block types, marks, inline embeds, command ids, renderers, option panels, code preview renderers, clipboard hooks, styles, and CRDT hooks. The registry also has a `selectionTypes` declaration, and compatibility checks already report retained selections whose type is not core or registered.

That is only an ownership declaration. The actual selection model still hard-codes table cell selections through `EditorSelection`, `RetainedSelection`, selection retention/resolution, block id derivation, block-level decorations, clipboard serialization, keyboard movement, and table rendering.

Phase 10 should create the extension point needed by Phase 11's structural plugins, especially `table`, without extracting the whole table feature yet.

## Goal

Introduce a registry-backed selection extension API that keeps core text and block selections stable while moving table-cell selection behavior behind a plugin-owned adapter.

The result should be:

- Core selection variants remain built in:
  - `caret`
  - `range`
  - `block`
- Plugin selection variants can be declared with handlers for retention, resolution, clamping, focus fallback, selected block ids, ordering, decorations, and optional clipboard participation.
- `table-cells` is implemented through the new selection extension path, while table rendering and table structural commands can remain central until Phase 11.
- Persisted or published selections with unknown plugin selection types fail compatibility checks.
- Existing public `BlockEditorSelectionState` behavior remains source-compatible where practical.
- Existing table cell selection behavior is unchanged under `legacyRichTextPlugins`.

## Non-Goals

- Do not extract the full `table` plugin in this phase.
- Do not move table rendering, row/column/cell commands, drag/drop, or table option UI fully out of `BlockRichTextEditor` yet.
- Do not replace DOM text selection read/restore for core caret/range selections.
- Do not redesign CRDT block ordering or virtual parent materialization.
- Do not make every selection operation async or React-dependent.
- Do not require third-party selection plugins to handle core `caret`, `range`, or `block` variants.
- Do not solve slide presentation selection constraints except by avoiding APIs that make them harder in Phase 11.

## Current Ownership To Untangle

Selection types and helpers:

- `EditorSelection` is a closed union of `caret`, `range`, `block`, and `table-cells`.
- `RetainedSelection` repeats the same closed union.
- `selectionModel.ts` contains table-specific helpers:
  - `tableCellSelection`
  - `selectedCellIdsForSelection`
  - `tableCellRectangleForSelection`
  - `tableCellPosition`
  - `tableRowsForSelection`
  - `tableCellsForSelection`
- Core helpers branch on `table-cells`:
  - `clampSelection`
  - `isBlockLevelSelection`
  - `focusPoint`
  - `focusBlockId`
  - `firstPointForSelection`
  - `selectedBlockIdsForSelection`
  - `selectedTopLevelBlockIdsForSelection`

Retention:

- `retainedSelection.ts` retains table-cell selections by block id only.
- Resolving a table-cell selection currently resolves deleted/joined table, anchor cell, and focus cell ids through generic block id fallback.
- `selectionSet.ts` sorts, dedupes, and decorates selections with core assumptions and explicit table-cell branches.

Clipboard:

- `clipboard.ts` recognizes `sourceSelectionType: 'table-cells'`.
- Table-cell clipboard serialization includes selected cell fragments and primary TSV data.
- Rich paste into a table-cell selection is handled in `multiSelectionCommands.ts`.

Editor UI and keyboard:

- `BlockRichTextEditor.tsx` handles table-cell drag selection, cell highlighting, focus styling, row/column add affordances, table cell tab/arrow movement, and table-cell deletion.
- Keyboard hooks call table-specific command helpers such as `moveTableSelectionByArrow`, `moveTableCellByTab`, and `advanceFromTableCellEnd`.
- Table drag/drop uses table-cell selection rectangles and table cell slot targets.

Plugin registry:

- `BlockEditorSelectionTypeSpec` currently has only `id`, `pluginId`, and `label`.
- `legacyRichTextBlocksPlugin` still declares `table-cells` as a transitional selection type.
- Compatibility checks already report unsupported non-core selection types.

## Proposed Plugin Boundary

### Core Selection Support

Core owns:

- `caret` and `range` text selections
- `block` block-level selections
- point retain/resolve logic for text selections
- default selection set normalization
- default text decorations
- default block selection decorations
- DOM text selection read/restore
- public retained selection set container shape

Core should expose registry-aware helpers for callers that currently use selection functions directly:

- `retainSelectionFromRegistry(registry, state, selection)`
- `resolveSelectionFromRegistry(registry, state, retainedSelection)`
- `clampSelectionFromRegistry(registry, state, selection)`
- `focusPointFromRegistry(registry, state, selection)`
- `focusBlockIdFromRegistry(registry, state, selection)`
- `firstPointForSelectionFromRegistry(registry, state, selection)`
- `selectedBlockIdsFromRegistry(registry, state, selection)`
- `selectedTopLevelBlockIdsFromRegistry(registry, state, selection)`
- `blockLevelDecorationsFromRegistry(registry, state, selectionSet)`

Compatibility wrappers may keep the existing names and use `legacyRichTextPlugins` or a default legacy registry during the transition, but new plugin-aware call sites should use the registry-backed helpers.

### `SelectionPluginSpec`

Add a richer selection contribution type, either by expanding `BlockEditorSelectionTypeSpec` or by adding a sibling field such as `selectionPlugins`.

Recommended shape:

```ts
type BlockEditorSelectionPlugin<Meta> = {
    id: string;
    pluginId?: string;
    label?: string;
    retain(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): PluginRetainedSelection;
    resolve(context: {state: CachedState<Meta>; selection: PluginRetainedSelection}): PluginEditorSelection;
    clamp?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): PluginEditorSelection;
    focusPoint?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): BlockPoint;
    focusBlockId?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): string;
    firstPoint?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): BlockPoint;
    selectedBlockIds?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): readonly string[];
    selectedTopLevelBlockIds?(context: {state: CachedState<Meta>; selection: PluginEditorSelection}): readonly string[];
    blockLevelDecorations?(context: {
        state: CachedState<Meta>;
        selection: PluginEditorSelection;
        entryId: string;
        primary: boolean;
    }): ReadonlyMap<string, BlockLevelSelectionDecorations>;
    compare?(context: {
        state: CachedState<Meta>;
        one: PluginEditorSelection | PluginRetainedSelection;
        two: PluginEditorSelection | PluginRetainedSelection;
    }): number;
};
```

The exact names can change during implementation. The important boundary is that core dispatches plugin selection behavior by `selection.type`.

Selection payloads should be structurally typed:

```ts
type PluginEditorSelection = {type: string} & Record<string, JsonValue>;
type PluginRetainedSelection = {type: string} & Record<string, JsonValue>;
```

This keeps the public shape serializable and compatible with published retained selection state.

### `tableSelectionPlugin`

Owns:

- selection type: `table-cells`
- table-cell editor selection shape:
  - `tableId`
  - `anchorCellId`
  - `focusCellId`
- table-cell retained selection shape, initially the same ids
- retain/resolve/clamp handlers
- selected cell/block id derivation
- table-cell rectangle helpers needed by selection behavior
- block-level decoration mapping for selected cells and focus cell
- first/focus point fallback to the anchor/focus cell
- ordering comparison for mixed selection sets, if core fallback is insufficient
- clipboard selection source id support, if the clipboard API is ready in this phase

Expected behavior:

- Existing table cell selection drag, highlight, focus styling, copy, TSV export, paste, delete, and keyboard movement remain unchanged when the table selection plugin is registered.
- Editors without the table selection plugin reject persisted `table-cells` selections through compatibility checks.

## Required Foundation Work

### 1. Split Core And Plugin Selection Types

Introduce explicit types for core and plugin selections:

- `CoreEditorSelection`
- `CoreRetainedSelection`
- `PluginEditorSelection`
- `PluginRetainedSelection`
- `EditorSelection = CoreEditorSelection | PluginEditorSelection`
- `RetainedSelection = CoreRetainedSelection | PluginRetainedSelection`

Keep the runtime shape unchanged for existing selections.

TypeScript should still narrow core variants cleanly. Plugin variants should require registry dispatch or feature-specific type guards.

### 2. Add Registry Index For Selection Plugins

Extend the plugin API so the registry indexes selection handlers by selection type.

Validation should reject:

- empty selection ids
- duplicate selection handler ids/types
- mismatches where a plugin declares a selection handler but not its public selection type, if those remain separate arrays

Compatibility should continue to use the public selection type id.

### 3. Add Registry-Aware Selection Operations

Create a focused module, likely `selectionPlugins.ts` or `selectionRegistry.ts`, that dispatches selection operations:

- core selection types use existing core functions
- plugin selection types use the registered handler
- unknown selection types either throw in strict paths or degrade to an initial/core fallback in best-effort UI paths

Prefer explicit strict/best-effort call sites over silently clamping unknown plugin selections everywhere.

### 4. Move Table-Cell Selection Helpers Behind The Adapter

Move or wrap table-specific helpers so the `tableSelectionPlugin` owns them:

- `tableCellSelection`
- `selectedCellIdsForSelection`
- `tableCellRectangleForSelection`
- `tableCellPosition`
- `tableRowsForSelection`
- `tableCellsForSelection`

During Phase 10, existing imports may remain via compatibility exports. Those wrappers should delegate to the table selection implementation rather than preserving table logic in core selection helpers.

### 5. Update Retained Selection Set Helpers

Update `selectionSet.ts` to use registry-aware operations for:

- resolving entries
- retaining entries
- deduping carets/ranges while preserving plugin selections
- sorting mixed selections
- deriving text decorations
- deriving block-level decorations
- selected top-level block ids

Core text decoration code can stay core-only. Plugin selections should contribute block-level decorations, not text selection segments, unless a later plugin explicitly needs inline decoration support.

### 6. Update Clipboard Integration

Keep generic clipboard serialization core-owned, but route custom block-level selection behavior through selection plugins where useful.

At minimum:

- source selection type should accept plugin block-level selection types
- selected block ids for plugin selections should come from the selection handler
- table-cell TSV export can remain a table-specific helper during Phase 10, but should be clearly owned by the table selection adapter or marked as a Phase 11 table clipboard hook

Avoid designing a broad clipboard plugin API inside Phase 10 unless table-cell behavior cannot be preserved without it.

### 7. Update Editor Keyboard And Rendering Call Sites

Replace broad `selection.type === 'table-cells'` checks only where the selection extension point needs to be proven:

- selection retention/restoration
- selected block ids and decorations
- compatibility checks
- clipboard block selection derivation

Leave table-specific keyboard movement and table rendering branches in place for Phase 11, but make them consume table selection adapter helpers where possible.

## Implementation Slices

### Slice 1: Selection Plugin Types And Registry

- Add the selection plugin contribution type.
- Index selection plugins by selection type in the registry.
- Preserve existing `selectionTypes` compatibility behavior or merge it into the richer spec.
- Add duplicate/missing declaration tests.

Verification:

- Core registry tests pass.
- Duplicate selection handler ownership fails clearly.
- Existing compatibility tests for missing `table-cells` still pass.

### Slice 2: Core Registry-Aware Selection Helpers

- Add registry-aware retain/resolve/clamp/focus/selected-id helpers.
- Keep existing non-registry helper exports as compatibility wrappers.
- Update tests for caret/range/block parity.

Verification:

- Existing caret/range/block selections retain, resolve, clamp, sort, and decorate exactly as before.
- Unknown plugin selection type fails in strict helper paths.

### Slice 3: Table Selection Adapter

- Add `tableSelectionPlugin`.
- Move table-cell selection shape and helper logic behind the adapter.
- Keep compatibility exports for current table call sites.
- Move `table-cells` selection ownership out of `legacyRichTextBlocksPlugin` and into the table selection plugin or a transitional table plugin.
- Add the table selection plugin to `legacyRichTextPlugins`.

Verification:

- `legacyRichTextPlugins` still accepts `table-cells` selections.
- A registry without the table selection plugin reports `table-cells` as unsupported.
- Table cell rectangle, row, and cell helper tests still pass.

### Slice 4: Retained Selection Set Integration

- Update selection set retain/resolve/decorations/sorting paths to dispatch through the registry.
- Preserve multi-selection dedupe behavior for text selections.
- Preserve plugin selections rather than attempting text-range dedupe on them.

Verification:

- Multi-caret/range dedupe tests still pass.
- Table-cell block-level decorations still mark selected cells and focus cell correctly.
- Mixed text, block, and table-cell selections sort deterministically.

### Slice 5: Clipboard And Command Compatibility

- Update clipboard selected-block derivation to use registry-aware selection helpers.
- Keep table TSV behavior unchanged, either through the table selection adapter or a narrow table clipboard helper.
- Update rich paste paths only as much as needed to consume registry-aware table selection helpers.

Verification:

- Copying a table cell selection still includes fragments and TSV.
- Pasting rich clipboard into one selected cell still replaces cell children.
- Pasting row/column-shaped data into selected cells still preserves current behavior.
- Deleting selected table cells still preserves current behavior.

### Slice 6: Editor Call Site Cleanup

- Replace direct imports of table-cell helpers from core selection modules with table selection adapter imports where practical.
- Leave table rendering, drag/drop, and keyboard command implementations central if moving them would start Phase 11 early.
- Document remaining table-specific call sites as Phase 11 cleanup.

Verification:

- Table cell drag selection and visual selection classes behave unchanged.
- Arrow and tab movement in tables behaves unchanged.
- Typecheck passes without widening every selection call site to unsafe casts.

## Test Matrix

Core selection:

- caret retain/resolve across inserts and deletes
- range retain/resolve across inserts and deletes
- block selection clamp after deleted/joined blocks
- selection set dedupe for overlapping ranges and duplicate carets
- text selection decorations
- block selection decorations

Plugin registry:

- selection plugin registration by type
- duplicate selection type ownership fails
- unknown persisted selection type fails compatibility
- `table-cells` compatibility succeeds only when the table selection plugin is registered

Table-cell selection:

- single cell selection retains and resolves
- rectangular cell selection derives the same cell ids
- selected cell decorations match current `.cellSelected` and `.cellSelectionFocus` behavior
- deleted/missing anchor/focus cells resolve to a reasonable fallback
- table row/column shape detection for clipboard remains unchanged

Clipboard:

- block selection copy still serializes top-level selected subtrees
- table-cell copy still serializes selected cell fragments
- table-cell copy still produces TSV for the primary selection
- rich paste into a single selected cell still works
- rich paste into full selected row/column still inserts row/column content as before

Editor behavior:

- mouse drag across cells selects the same rectangle
- shift-click/drag table extension remains unchanged
- arrow movement within and across table cells remains unchanged
- tab and shift-tab cell movement remain unchanged
- delete/backspace on selected cells behaves unchanged

## Risks

- Generalizing `EditorSelection` too broadly can weaken TypeScript narrowing across the editor. Keep core type guards strong and force plugin-specific logic through handlers or type guards.
- Registry-aware selection helpers may require many call-site updates. Prefer compatibility wrappers and focused migration over a single large rewrite.
- Table selection is tied to table structure helpers that currently live in core selection modules. Moving all of them at once could accidentally start the table extraction phase.
- Clipboard hooks are not yet feature-specific enough for all table behavior. Keep table clipboard behavior narrow in this phase and defer a broader clipboard plugin API unless required.
- Unknown plugin selections should not silently become carets in load/persistence paths. Use compatibility errors for persisted selections and reserve fallbacks for local UI recovery only.

## Completion Criteria

- The plugin API can express executable selection behavior, not just selection type ownership.
- Core caret/range/block selection behavior remains unchanged.
- `table-cells` selection behavior is owned by a registry selection plugin or adapter.
- `legacyRichTextPlugins` preserves all current table-cell selection behavior.
- Documents or published selection states with unavailable custom selection types fail compatibility checks.
- Selection retention, block decorations, selected block ids, and clipboard block derivation use registry-aware selection operations.
- Remaining central table rendering/command/drag-drop call sites are documented as Phase 11 work.
