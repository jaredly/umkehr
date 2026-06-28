# Plan: Block Editor Plugin System

## Decisions From Research

- The plugin system is public API, not only internal source organization.
- The base editor ships without built-in feature plugins enabled, except for the core paragraph type.
- Built-in feature plugins are provided as opt-in exports and likely as a convenience preset.
- Block metadata should be built from registered plugins, not a permanently fixed `RichBlockMeta` union.
- Documents using unavailable plugins should fail to load rather than render unknown fallback blocks.
- Paragraph remains core.
- Images and math should become plugins.
- Underline should be added to `basic-marks`.
- Comments, footnotes, and popovers can be combined into one annotations plugin for now.
- `sidebar` and `footer` can be editor-owned named destinations. Plugins can render into them, but should not dictate sidebar sizing.
- Mermaid and Vega should be preview renderer registrations on the code plugin.
- Plugins should be able to provide styles.
- Plugins should be able to add custom selection types.
- Plugins must declare what they handle. Registration conflicts should error.
- Plugin order should not affect rendering or command behavior.
- Clipboard/document compatibility with missing plugins is a load error.

## Guiding Constraints

- Preserve current behavior for the existing rich editor by creating a built-in plugin preset that installs all current features.
- Keep paragraph editing, plain text operations, DOM selection, retained selection, CRDT application, and block tree materialization in core.
- Make plugin resolution deterministic and conflict-checked at registry construction time.
- Avoid order-dependent fallthrough behavior. Runtime dispatch should use explicit ids, types, commands, or handlers registered by key.
- Extract high-coupling features only after the registry can express their needs.

## Phase 1: Core Plugin API And Registry

Add the public types and normalization layer.

Work items:

- Add `src/block-editor/plugins/types.ts`.
- Add `src/block-editor/plugins/registry.ts`.
- Define `BlockEditorPlugin` with stable `id`, optional `requires`, provided feature declarations, and optional style descriptors.
- Define registry contribution types for:
  - block types
  - inline marks
  - inline embeds
  - custom selection types
  - toolbar items/groups
  - slash commands
  - markdown shortcuts
  - block renderers
  - inline renderers
  - destination renderers
  - block option panels
  - command handlers
  - CRDT hooks
  - clipboard/serialization hooks
  - code preview renderers
- Define a `BlockEditorRegistry` produced from plugins.
- Implement dependency validation:
  - duplicate plugin ids error
  - missing `requires` error
  - cycles error
- Implement conflict validation:
  - duplicate block type ids error
  - duplicate mark ids error
  - duplicate inline embed ids error
  - duplicate custom selection type ids error
  - duplicate command ids error
  - duplicate slash command ids error
  - duplicate toolbar item ids error
  - duplicate code preview renderer ids/languages error
- Make dispatch tables keyed by explicit ids so plugin order does not decide behavior.
- Export a `createBlockEditorRegistry(plugins)` API.

Tests:

- Registry sorts dependencies deterministically.
- Duplicate ids and handler conflicts throw clear errors.
- Missing dependencies and cycles throw clear errors.
- Reordering independent plugins produces equivalent registry tables.

## Phase 2: Plugin-Aware Editor Props

Thread registry configuration into the editor while keeping existing usage working through a preset.

Work items:

- Add `plugins?: BlockEditorPlugin[]` or `registry?: BlockEditorRegistry` to `BlockRichTextEditorProps`.
- Decide whether to accept both. Recommended: accept `plugins` publicly and build/memoize the registry internally; keep direct `registry` internal unless needed for tests.
- Export:
  - `paragraphPlugin` only if paragraph is represented as a formal core plugin, otherwise document that it is core.
  - `defaultBlockEditorPlugins`
  - `richTextBlockEditorPlugins` or similarly named full-feature preset.
- Keep existing `BlockRichTextEditor` behavior by using the full-feature preset when `plugins` is omitted only if backward compatibility is required.
- If strict base-editor behavior is preferred immediately, require examples/apps to pass the preset explicitly.
- Add a runtime document/plugin compatibility check before rendering:
  - scan block metadata types
  - scan marks
  - scan inline embed types
  - scan custom selection types if persisted
  - throw a structured error for missing plugin handlers
- Add a typed `BlockEditorPluginLoadError`.

Tests:

- Base editor accepts paragraph-only documents.
- Documents with unsupported block types fail before rendering.
- Documents with unsupported marks or embeds fail before rendering.
- Existing example/editor setup still works when passed the full preset.

## Phase 3: Metadata Model

Move from fixed `RichBlockMeta` assumptions toward plugin-built metadata while preserving TypeScript ergonomics.

Work items:

- Introduce a generic metadata type strategy, likely:
  - `CoreBlockMeta = {type: 'paragraph'; ts: HLC}`
  - plugin metadata unions exported by plugins
  - `DefaultBlockMeta` built from bundled plugins for the default preset
- Refactor core helpers to use generic `Meta extends TimestampedBlockMeta` where practical.
- Keep feature helpers typed against their plugin-specific metadata.
- Move `RichBlockMeta` toward being a compatibility alias for the full built-in preset metadata.
- Replace central `sameTypeWithTs`, `blockTypeMeta`, `blockTypeMenuValue`, and metadata default logic with registry lookups where possible.
- Add plugin metadata validators so document load can identify required plugin types.
- Add plugin metadata merge hooks for CRDT merge behavior.

Tests:

- Full preset metadata remains compatible with current documents.
- Plugin metadata validators reject malformed metadata.
- Poll metadata merge still behaves the same after being registered as a plugin hook.

## Phase 4: CRDT Hook Composition

Move CRDT feature hooks into the registry.

Work items:

- Replace direct imports in `editorCrdtConfig.ts` with registry-composed config.
- Support plugin-provided:
  - `markBehavior`
  - `virtualParents`
  - `markVirtualParents`
  - `mergeBlockMeta`
- Define merge semantics for hook composition.
- Error when two plugins claim incompatible behavior for the same mark or metadata type.
- Keep annotation virtual parents and poll merge behavior identical through plugin hooks.

Tests:

- Annotation body blocks still materialize under annotation marks.
- Poll votes still merge per-user by timestamp.
- Multiple compatible CRDT hooks compose deterministically.

## Phase 5: Menus, Toolbar, And Commands

Convert UI command surfaces from hard-coded lists to registry contributions.

Work items:

- Replace static `BlockTypeMenuValue` union usage with registry block type ids where possible.
- Refactor `Toolbar` to render registry toolbar groups/items.
- Refactor slash commands to use registry slash command specs.
- Refactor block type conversion to use plugin block type specs and command handlers.
- Refactor markdown shortcuts to use registered matchers.
- Add command ids and a central command dispatcher.
- Ensure command conflicts are caught during registry construction.

Tests:

- Full preset toolbar has the same visible actions as today, plus underline.
- Full preset slash menu has the same commands as today.
- Markdown shortcuts still convert headings, lists, todos, inline code, and math.
- Plugin ordering does not change toolbar/slash/command behavior.

## Phase 6: Inline Plugins

Extract inline features first because they are narrower than structural blocks.

Plugins:

- `basic-marks`
- `links`
- `math`
- `inline-date`

Work items:

- Move bold/italic/strikethrough into `basic-marks`.
- Add underline mark support:
  - mark type
  - toolbar item
  - active mark derivation
  - rendering class/style
  - command handling
  - serialization
- Move link mark behavior and link popovers into `links`.
- Move math mark behavior/rendering into `math`.
- Move date embed registration into `inline-date`.
- Route active mark derivation through registered mark specs.
- Route inline run rendering through registered mark/embed renderers.

Tests:

- Each basic mark toggles and renders correctly.
- Underline works in collapsed and range selections.
- Link creation/removal and hover/edit popovers still work.
- Math inline/display rendering still works.
- Date embeds still render and serialize.

## Phase 7: Simple Block Plugins

Extract low-structural-risk block plugins.

Plugins:

- `headings`
- `lists`
- `todos`
- `quote`
- `callouts`
- `ingredients`
- `images`
- `link-preview`

Work items:

- Move block metadata specs, menu specs, slash specs, markdown shortcuts, render classes, and option panels into each plugin.
- Move image attachment block behavior into `images`.
- Move preview URL metadata fetching/rendering into `link-preview`.
- Keep shared core block rendering helpers available through render context.
- Keep editor-owned `sidebar` sizing out of plugin APIs.

Tests:

- Existing block type conversions still work.
- Lists still number correctly.
- Todo checkbox toggles still produce CRDT metadata updates.
- Blockquote/callout subtree rendering remains unchanged.
- Ingredient highlighting remains unchanged.
- Image upload/caption behavior remains unchanged.
- Link preview card editing/fetching remains unchanged.

## Phase 8: Annotations Plugin

Combine comments, footnotes, and popovers into one annotations plugin.

Work items:

- Move `annotations.ts`, annotation popover control, and annotation virtual parent hook behind the plugin.
- Register `annotation` mark behavior.
- Register annotation commands:
  - create comment
  - create footnote
  - create popover
  - resolve annotation
  - body editing commands
- Register destination renderers:
  - `sidebar` for comments
  - `footer` for footnotes
  - `floating` for popovers
- Keep sidebar width/layout editor-owned.
- Expose annotation selectors to the plugin destination renderers.
- Move annotation-specific static serialization behavior into plugin serialization hooks.

Tests:

- Comments render in the sidebar and align to selected annotated text.
- Footnotes render in the footer with stable numbering.
- Popovers render on hover/focus.
- Annotation body blocks survive edits and CRDT materialization.
- Documents with annotation marks fail to load if the annotations plugin is absent.

## Phase 9: Code Plugin And Preview Renderers

Extract code as a parent plugin with preview renderer registrations.

Plugins:

- `code`
- `code/mermaid`
- `code/vega`

Work items:

- Move code block metadata, inline code mark, language normalization, syntax highlighting, and code option panel into `code`.
- Add a code preview renderer registry extension.
- Register Mermaid preview renderer from `code/mermaid`.
- Register Vega-Lite preview renderer from `code/vega`.
- Keep preview renderers as plugin contributions requiring `code`.
- Preserve dynamic imports for optional preview modules.

Tests:

- Plain code blocks still edit and highlight.
- Inline code mark still toggles and renders.
- Mermaid preview mode still renders or reports errors.
- Vega-Lite preview mode still renders or reports errors.
- `code/mermaid` or `code/vega` without `code` fails registry construction.

## Phase 10: Custom Selection Extension Point

Add the selection extension APIs needed by structural plugins, especially tables.

Work items:

- Generalize `EditorSelection` to include plugin-defined selection variants.
- Add `SelectionPluginSpec` with handlers for:
  - clamp/resolve/retain selection
  - selected block ids
  - first/focus point fallback
  - block-level decorations
  - clipboard participation if needed
  - keyboard movement hooks
- Move table-specific selection logic behind this API.
- Ensure missing plugins for persisted custom selections are load errors.

Tests:

- Existing caret/range/block selections still behave the same.
- Table cell selections still retain, resolve, decorate, copy/paste, and delete correctly after extraction.
- Unsupported custom selection types fail compatibility checks.

## Phase 11: Heavy Structural Plugins

Extract the highest-coupling features after the registry can express selection, rendering, commands, and CRDT hooks.

Plugins:

- `polls`
- `columns`
- `slides`
- `table`

Work items:

- Move poll metadata, rendering, vote commands, editor modes, option panel, and metadata merge hook into `polls`.
- Move columns metadata, rendering, move/drop behavior, and option panel into `columns`.
- Move slide deck/slide metadata, rendering, UI state, presentation controls, selection constraints, and option panels into `slides`.
- Move table metadata, rendering, custom selection, keyboard navigation, drag/drop, row/column/cell commands, and clipboard behavior into `table`.
- Keep core block movement primitives generic enough for these plugins.

Tests:

- Poll votes and results behave as before.
- Columns/card columns render and move blocks as before.
- Slide deck overview/presentation/fullscreen behavior remains unchanged.
- Table row/column/cell creation, deletion, movement, selection, keyboard navigation, and clipboard behavior remain unchanged.

## Phase 12: Styles

Support plugin-provided styles without making runtime layout order-dependent.

Work items:

- Define plugin style contribution shape:
  - `cssText`
  - `classNames` metadata
  - or explicit imported CSS module path/build integration
- Recommended first step: plugins export CSS files or CSS strings, and the bundled preset imports them through stable package entrypoints.
- Keep shared editor shell styles in core.
- Move feature-specific CSS from `style.css` next to plugin modules in stages.
- Ensure style loading order is deterministic and documented.

Tests:

- Full preset visual classes remain present.
- Plugin styles are included when the plugin is included.
- Base editor does not require feature plugin CSS.

## Phase 13: Public Exports And Documentation

Finalize the package surface.

Work items:

- Export core editor APIs.
- Export each built-in plugin individually.
- Export the full preset.
- Document base editor usage.
- Document full preset usage.
- Document writing a plugin.
- Document document compatibility/load errors.
- Document conflict rules.
- Document plugin style packaging.
- Document sub-plugin pattern using code preview renderers.

Example target API:

```ts
import {
    BlockRichTextEditor,
    basicMarksPlugin,
    linksPlugin,
    headingsPlugin,
    defaultBlockEditorPlugins,
} from '.../block-editor';

<BlockRichTextEditor
    plugins={defaultBlockEditorPlugins}
    value={value}
    clock={clock}
    onChange={onChange}
/>;
```

## Phase 14: Cleanup

Remove compatibility seams once all plugins are extracted.

Work items:

- Remove or narrow old central `RichBlockMeta` declarations if replaced by generated/preset metadata.
- Remove hard-coded block type branches that now live in plugins.
- Remove hard-coded toolbar/slash/markdown lists.
- Remove direct feature imports from `BlockRichTextEditor.tsx`.
- Keep any compatibility aliases intentionally exported and documented.
- Audit `index.ts` exports so feature APIs are exported through plugin modules.

## Suggested Implementation Slices

To keep reviews manageable:

1. Registry types, validation, and tests.
2. Editor prop threading and compatibility checks.
3. Toolbar/slash/markdown registry wiring with existing behavior.
4. Inline plugin extraction plus underline.
5. Simple block plugin extraction.
6. Annotations plugin extraction and destinations.
7. Code plugin plus Mermaid/Vega preview renderers.
8. Custom selection API.
9. Polls, columns, slides, and table extraction.
10. Styles, docs, and cleanup.

## Risks

- Generic plugin-built metadata will touch many helpers currently typed to `RichBlockMeta`.
- Custom selection extension is a large design point because table selection is deeply integrated.
- Public plugin API will be harder to change after release; keep the first surface narrow and explicit.
- Load-error behavior requires reliable document scanning for metadata, marks, embeds, and selections.
- Plugin styles may be constrained by the existing build setup.
- Extracting heavy structural plugins too early will create churn before the registry abstractions are proven.

## Completion Criteria

- The base editor can load and edit paragraph-only documents without built-in plugins.
- The full built-in preset reproduces current editor behavior.
- Every specialized current feature is represented by a plugin or an intentional core exception.
- Missing plugin requirements fail at document load with actionable errors.
- Registration conflicts fail deterministically.
- Plugin order does not affect rendering or command dispatch.
- Comments, footnotes, and popovers render through destination slots.
- Code preview renderers are registered through the code plugin extension point.
- Table cell selection is implemented as a plugin-provided custom selection.
- Plugin-owned styles are loaded with the plugins that need them.
