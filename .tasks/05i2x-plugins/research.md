# Research: Block Editor Plugin System

## Goal

Add a plugin system to `src/block-editor` and move specialized blocks, marks, embeds, render destinations, and related commands into individual plugins.

Candidate plugins from the task:

- `basic-marks`: bold, italic, strikethrough, underline
- `links`
- `footnotes`
- `popovers`
- `comments`
- `code`
- `code/vega`
- `code/mermaid`
- `headings`
- `lists`: bullet and numbered
- `todos`
- `quote`
- `callouts`
- `ingredients`
- `table`
- `columns`
- `slides`
- `link-preview`
- `polls`

The editor should also support plugin render destinations such as `footer` and `sidebar`, and allow plugins to register sub-plugins such as `code/vega` and `code/mermaid`.

## Current Shape

The editor is currently feature-rich but mostly closed over a single hard-coded feature set.

Relevant files:

- `src/block-editor/BlockRichTextEditor.tsx`
- `src/block-editor/Toolbar.tsx`
- `src/block-editor/blockMeta.ts`
- `src/block-editor/blockTypeHelpers.ts`
- `src/block-editor/blockCommands.ts`
- `src/block-editor/multiSelectionCommands.ts`
- `src/block-editor/inlineMarks.ts`
- `src/block-editor/inlineEmbeds.ts`
- `src/block-editor/inlineRunRendering.tsx`
- `src/block-editor/annotations.ts`
- `src/block-editor/virtualParents.ts`
- `src/block-editor/editorCrdtConfig.ts`
- `src/block-editor/markdownShortcuts.ts`
- `src/block-editor/slashCommands.tsx`
- `src/block-editor/mediaBlocks.tsx`
- `src/block-editor/pollBlocks.ts`
- `src/block-editor/style.css`

The public editor props in `types.ts` do not currently accept plugin configuration. Consumers get one built-in editor with all features enabled.

```ts
export type BlockRichTextEditorProps<Meta extends TimestampedBlockMeta> = {
    value: BlockEditorValue<Meta>;
    clock: BlockEditorClock;
    readOnly?: boolean;
    userId?: string;
    attachments?: BlockEditorAttachmentStore;
    presence?: BlockEditorPresence;
    onChange(change: BlockEditorChange<Meta>): void;
    onSelectionChange?(selection: BlockEditorSelectionState): void;
    onUndo?(): void;
    onRedo?(): void;
};
```

`RichBlockMeta` is a single discriminated union containing all built-in block metadata: paragraphs, headings, lists, todos, quotes, code, callouts, ingredients, tables, columns, slides, images, previews, and polls.

`BlockTypeMenuValue`, `Toolbar`, `blockTypeMeta`, `blockTypeMenuValue`, and `SLASH_COMMANDS` all duplicate this fixed list.

`BlockRichTextEditor.tsx` contains the largest concentration of coupling:

- renders top-level destinations for annotations: sidebar comments, footnotes, and floating popovers
- dispatches toolbar and slash commands into hard-coded block conversion logic
- branches `renderBlockNode` by `meta.type` for table, columns, slides, blockquote/callout, and polls
- branches `EditableBlock` by `meta.type` for image, preview, poll, previewable code, and normal editable surfaces
- owns option panels for code, callout, image, poll, columns, slides, and preview
- owns table selection and drag behavior
- owns poll editing/voting behavior
- owns slide deck UI state
- owns link/code/embed popovers
- owns static serialization helpers that know about annotations, embeds, math, footnotes, and popovers

There is already one small plugin-like system: `inlineEmbeds.ts` defines `InlineEmbedPlugin` and a local `inlineEmbedPlugins` array for the date embed. This is useful precedent, but it is not wired through editor props or a general registry.

## Existing Feature Coupling

### Metadata

`blockMeta.ts` is the central schema for block types and block-specific validation/defaults.

Feature-owned metadata today:

- `headings`: `{type: 'heading'; level: 1 | 2 | 3}`
- `lists`: `{type: 'list_item'; kind: 'ordered' | 'unordered'}`
- `todos`: `{type: 'todo'; checked: boolean}`
- `quote`: `{type: 'blockquote'}`
- `code`: `{type: 'code'; language: string; preview?: CodePreviewKind}`
- `code/mermaid`, `code/vega`: `CodePreviewKind`
- `callouts`: `{type: 'callout'; kind: 'info' | 'warning' | 'error'}`
- `ingredients`: `{type: 'recipe_ingredient'}`
- `table`: `{type: 'table'}`
- `columns`: `{type: 'columns'; display: 'cards' | 'blocks'}`
- `slides`: `SlideDeckMeta`, `SlideMeta`
- `polls`: `PollMeta`, `PollVote`, poll merge behavior
- `link-preview`: `{type: 'preview'; url; preview}`
- `images`: `{type: 'image'; attachmentId; size}` even though it was not in the task list

The CRDT config in `editorCrdtConfig.ts` currently combines:

- annotation virtual parents from `annotations.ts`
- poll metadata merge behavior from `pollBlocks.ts`

A plugin system probably needs to aggregate these CRDT hooks rather than importing feature modules directly.

### Marks And Inline Features

`inlineMarks.ts` defines:

- boolean marks: `bold`, `italic`, `strikethrough`
- bare inline marks: boolean marks plus `code`
- `link`
- `math`

Task list includes underline, but underline does not currently exist in `BooleanInlineMark`, `Toolbar`, active mark derivation, rendering classes, or commands.

Annotation-based features are stored as a mark type:

- `ANNOTATION_MARK = 'annotation'`
- `AnnotationPresentation = 'sidebar' | 'footnote' | 'popover'`

This is a good conceptual fit for separate `comments`, `footnotes`, and `popovers` plugins, though the current implementation shares a single annotation data model and body-block machinery.

### Rendering

Block rendering is not modular today. `renderBlockNode` and `EditableBlock` contain explicit branches for:

- tables
- columns
- slide decks and slides
- blockquote and callout grouping
- image captions
- link preview cards
- polls
- previewable code blocks
- normal rich text blocks

Inline rendering is also specialized:

- `renderInlineEmbed`
- math rendering via `MathRichTextEditableSurface`
- annotation-derived classes and dataset attributes for sidebar, popover, and footnote references
- syntax and ingredient highlighting

The plugin API should provide both block-level and inline-level render extension points.

### Commands

Command logic is spread across:

- `blockCommands.ts` for single-selection commands and structural operations
- `multiSelectionCommands.ts` for multi-selection command wrappers
- `BlockRichTextEditor.tsx` for command dispatch, editor-local UI state, and option panel commands

Feature command groups:

- basic marks: `toggleMarkEverywhere`
- links: `setLinkMarkEverywhere`, `removeLinkMarkEverywhere`
- code marks: `toggleCodeMarkEverywhere`, `setCodeMark`, `removeCodeMark`, retained code sessions
- math: `toggleMathMarkEverywhere`, `toggleDisplayMathMarkEverywhere`
- annotations: create/resolve/body edit commands
- tables: table insert/delete/move/selection commands
- columns: convert/move commands
- slides: deck/slide conversion, add slide, presentation selection constraints
- polls: vote/update metadata commands
- link preview: insert and metadata update commands
- inline embeds: date embed insertion

A practical plugin design needs command registration plus enough editor context for commands to apply CRDT ops and return selections.

### Menus And Toolbar

Toolbar and slash commands are hard-coded:

- `Toolbar.tsx` lists all inline buttons, annotation buttons, image upload, and block type options.
- `slashCommands.tsx` owns a static `SLASH_COMMANDS` array.
- `blockEditorTypes.ts` defines the fixed `BlockTypeMenuValue` union.
- `blockTypeHelpers.ts` maps menu values to/from `RichBlockMeta`.

Plugins should be able to contribute:

- toolbar groups/items
- block type menu items
- slash commands
- option panel controls for selected block types

### Layout Destinations

The current editor has implicit destinations:

- main document flow
- floating popovers
- sidebar annotations
- footer footnotes

The task explicitly calls out `footer` and `sidebar`. These should be first-class plugin destinations. A plugin should be able to render into a named destination and optionally provide required indexing/derivation data.

Likely destination API:

- `main` for block flow renderers
- `inline` for inline run/mark rendering
- `floating` for positioned popovers
- `sidebar` for comments or other side panels
- `footer` for footnotes or document-end content
- possibly `block-options` for selected block controls

### Virtual Parents

Annotations use virtual parent behavior so annotation body blocks live under mark ids. The plugin architecture must preserve this:

- plugins can contribute `markBehavior`
- plugins can contribute `markVirtualParents`
- plugins can contribute `virtualParents`

Composition is non-trivial because only one `VirtualBlockParentConfig` is passed to CRDT helpers. The registry should merge plugin virtual-parent configs deterministically.

### Sub-Plugins

`code/mermaid` and `code/vega` are currently embedded as preview kinds inside the code block implementation. They dynamically import optional modules in `mediaBlocks.tsx`.

A clean model:

- `code` plugin owns code block metadata, language, syntax highlighting, and code block controls.
- `code` exposes a `codePreview` extension point.
- `code/mermaid` registers a preview renderer for language `mermaid`.
- `code/vega` registers a preview renderer for languages `vega-lite` and `vegalite`.

This avoids making sub-plugin support a generic tree mechanism at first. The registry can still represent parent dependencies with `requires: ['code']`.

## Proposed Plugin Model

Start with an internal plugin API before exposing it broadly. The first implementation can keep the exported `BlockRichTextEditor` behavior identical by building a `defaultBlockEditorPlugins` preset.

Sketch:

```ts
export type BlockEditorPlugin = {
    id: string;
    requires?: string[];
    marks?: InlineMarkSpec[];
    blockTypes?: BlockTypeSpec[];
    inlineEmbeds?: InlineEmbedPlugin[];
    slashCommands?: SlashCommandSpec[];
    toolbarItems?: ToolbarItemSpec[];
    markdownShortcuts?: MarkdownShortcutSpec[];
    renderBlock?: BlockRenderer;
    renderInlineRun?: InlineRunRenderer;
    renderDestination?: DestinationRenderer;
    optionPanels?: BlockOptionPanelSpec[];
    commands?: CommandSpec[];
    crdt?: PluginCrdtConfig;
    serialize?: SerializationHooks;
};
```

The registry should normalize plugins into one `BlockEditorRegistry`:

```ts
export type BlockEditorRegistry = {
    plugins: BlockEditorPlugin[];
    blockTypes: Map<string, BlockTypeSpec>;
    marks: Map<string, InlineMarkSpec>;
    inlineEmbeds: InlineEmbedPlugin[];
    slashCommands: SlashCommandSpec[];
    toolbarItems: ToolbarItemSpec[];
    destinations: Map<string, DestinationRenderer[]>;
    crdtConfig(state: CachedState<RichBlockMeta>): VirtualBlockParentConfig<RichBlockMeta>;
};
```

Important: `RichBlockMeta` can remain the built-in metadata union during the first migration. Making metadata fully generic is a larger API change and should be deferred unless there is a real external plugin requirement.

## Suggested Migration Order

1. Add a registry with a default preset, but keep behavior unchanged.
2. Route existing `inlineEmbedPlugins` through the registry. This is the smallest existing plugin-shaped feature.
3. Move toolbar and slash command static lists behind registry-derived arrays.
4. Move markdown shortcuts behind registry-derived matchers for headings, lists, todos, code/math shortcuts.
5. Extract simple metadata/render-only block types:
   - headings
   - quote
   - callouts
   - ingredients
6. Extract marks:
   - `basic-marks`
   - `links`
   - `code` inline mark
   - math, if kept as a plugin even though it is not in the task list
7. Extract annotation destinations:
   - shared annotation core
   - `comments` for sidebar
   - `footnotes` for footer
   - `popovers` for floating destination
8. Extract code block and preview sub-plugins:
   - `code`
   - `code/mermaid`
   - `code/vega`
9. Extract heavier structural plugins:
   - `link-preview`
   - `polls`
   - `columns`
   - `slides`
   - `table`

Tables, columns, and slides should be last because they touch selection, drag/drop, keyboard navigation, rendering, and structural commands.

## Plugin Inventory

### `basic-marks`

Owns:

- `bold`
- `italic`
- `strikethrough`
- probably `underline`, newly added
- toolbar buttons
- active mark derivation
- inline run CSS classes
- toggle commands

Open issue: underline does not exist yet, so this plugin includes new behavior rather than pure extraction.

### `links`

Owns:

- `LINK_MARK`
- link popover state
- set/remove link commands
- link auto-detection helpers
- link render behavior
- link-related toolbar item

### `footnotes`, `comments`, `popovers`

Likely share an `annotations` core:

- annotation mark data
- body block creation
- virtual parent config
- body block editing commands
- static rendering helpers

Individual plugins own presentation and destination:

- `comments`: `sidebar`
- `footnotes`: `footer`
- `popovers`: `floating`

Question: should these be separate plugins over one shared annotation model, or one `annotations` plugin with enabled presentations?

### `code`

Owns:

- code block metadata
- code inline mark metadata
- language normalization
- syntax highlighting
- code option panel
- retained inline code sessions
- markdown shortcut for backticks
- code block rendering
- sub-plugin extension point for preview renderers

### `code/mermaid` And `code/vega`

Own:

- preview renderer registration
- language aliases
- dynamic imports
- preview labels and error handling

They should require `code`.

### `headings`

Owns:

- heading metadata levels
- block type menu entries
- slash commands
- markdown `#`, `##`, `###` shortcuts
- heading CSS classes/rendering

### `lists`

Owns:

- ordered/unordered list item metadata
- list numbering derivation
- markdown `- `, `* `, and `1. ` shortcuts
- indent/unindent behavior where list-specific
- list markers/rendering

### `todos`

Owns:

- todo metadata
- checkbox rendering and toggle command
- markdown `[ ] ` and `[x] ` shortcuts

### `quote`

Owns:

- blockquote metadata
- subtree styling/group rendering

### `callouts`

Owns:

- callout metadata and kinds
- callout group rendering
- callout option panel

### `ingredients`

Owns:

- ingredient metadata
- ingredient line highlighting
- block type menu/slash command

### `table`

Owns:

- table metadata
- table rendering
- table cell selection type and helpers
- table keyboard navigation
- row/column/cell commands
- table drag/drop behavior
- table-related clipboard behavior

This may require a broader selection-plugin API, because table cells add a custom selection shape.

### `columns`

Owns:

- columns metadata
- board/card display modes
- column and card rendering
- move/drop behavior
- option panel

### `slides`

Owns:

- slide deck and slide metadata
- slide deck UI state
- presentation mode/fullscreen behavior
- slide selection constraints
- slide footer rendering
- add/convert commands
- option panels

### `link-preview`

Owns:

- preview block metadata
- URL normalization/fetching
- preview card rendering
- preview option panel
- slash command/block menu entry

### `polls`

Owns:

- poll metadata and vote merge behavior
- poll rendering
- poll option derivation from child blocks
- voting commands
- poll editor modes
- option panel

Polls require plugin-provided `mergeBlockMeta` composition.

### `images`

Not listed in the task, but currently implemented as a specialized block and toolbar item. It should either become an `images` plugin or remain a core attachment feature by explicit decision.

### `math`

Not listed in the task, but currently implemented as inline and display math marks. It should either become a `math` plugin or remain core by explicit decision.

### `inline-date`

Not listed in the task, but currently implemented through `InlineEmbedPlugin`. This is the easiest first plugin extraction.

## API Design Notes

### Core Versus Plugin Boundary

Keep these in core:

- CRDT state application
- selection retention
- DOM selection read/restore
- base rich-text editable surface
- block tree materialization
- command result application
- registry construction and dependency sorting
- paragraph block
- plain text insertion/deletion/splitting/joining

Move these behind plugins:

- specialized metadata
- toolbar/slash/menu contributions
- mark semantics
- specialized renderers
- block option panels
- destination renderers
- feature-specific CRDT hooks
- feature-specific serialization hooks

### Metadata Typing

There are two paths:

1. Keep `RichBlockMeta` as the built-in union and make plugins internal modules that contribute specs for known metadata.
2. Make `BlockRichTextEditor` generic over plugin metadata and let plugins extend the metadata union.

Path 1 is much safer for the current codebase. Path 2 is a much larger public API design and will force more changes through `block-crdt`, command helpers, and render contexts.

Recommendation: start with path 1 and leave external plugin metadata as a future design.

### Dependency Resolution

Support plugin dependencies by id:

- duplicate ids should be an error
- missing `requires` should be an error in development
- registration should be topologically sorted
- sub-plugins can just be plugins with `requires`

This is enough for `code/mermaid` and `code/vega`.

### Destination Rendering

Plugins should render destinations with editor state and derived registry context:

```ts
type DestinationRenderer = {
    destination: 'sidebar' | 'footer' | 'floating' | string;
    render(context: DestinationRenderContext): ReactElement | null;
};
```

For footnotes/comments/popovers, the shared annotation core can expose selectors such as rendered annotations and body block ids. Destination plugins can then render just their presentation.

### Registry Context

Renderers and commands need a stable context object, probably including:

- `state`
- `selection`
- `clock`
- `readOnly`
- `userId`
- `attachments`
- `dispatchCommand`
- `onChange`
- DOM refs where needed
- registry selectors

Avoid giving every plugin direct access to every `BlockRichTextEditor` local state setter. For heavy plugins that need UI state, support plugin-local React components/renderers rather than ad hoc shared state.

## Testing Strategy

Add focused unit tests for registry behavior:

- dependency sorting
- duplicate plugin id detection
- missing dependency detection
- merged CRDT config
- merged toolbar/slash/markdown contributions

Add regression tests while extracting:

- toolbar and slash menus still show the same default commands
- markdown shortcuts still convert headings/lists/todos/code/math
- link, code, math, and annotation marks still render and serialize
- comments render in sidebar
- footnotes render in footer and keep numbering
- popovers still show on hover/focus
- code preview sub-plugins still lazy-load renderers
- poll votes merge correctly
- table cell selection still survives extraction

There does not appear to be a dedicated `src/block-editor` test suite yet. The first implementation may need to add one rather than rely only on examples.

## Open Questions

- Should plugins be public API for app consumers, or only an internal decomposition mechanism for built-in features?
    - public API
- Should consumers be able to disable built-in plugins, or is the first goal only source organization?
    - we'll expose the base editor without any built-in plugins
- Should `RichBlockMeta` remain a fixed built-in union for now?
    - no, it should be built up from the plugins
- How should unknown plugin metadata render when a document contains a block whose plugin is disabled or unavailable?
    - document load should fail if used plugins are unavailable
- Should paragraph be a plugin or remain core?
    - paragraph is the only core type
- Should images and math be added to the plugin list even though they are not in the task?
    - yes please
- Is underline required as part of `basic-marks` now? It is listed in the task but not currently implemented.
    - let's add it in for completeness
- Should comments, footnotes, and popovers share one `annotations` core plugin, or should each own independent mark types?
    - we can have them be combined for now
- Can `footer` and `sidebar` destinations be generic named slots, or do they need editor-level layout constraints and sizing APIs?
    - use your judgement. whatever's needed to support the annotations plugin. I don't think the plugin should dictate the size of the sidebar though.
- Should `code/mermaid` and `code/vega` be generic sub-plugins, or just preview renderer registrations on the `code` plugin?
    - preview renderer registrations please
- How should plugin CSS be packaged? Keep all styles in `style.css` initially, or allow plugin-owned style imports?
    - plugins should be able to provide styles
- Should plugins be able to add custom selection types? Tables currently need `table-cells`, so either table remains special or the selection model becomes extensible.
    - yes they should
- How should plugin command conflicts be resolved when multiple plugins handle the same key, slash command, block type, or mark?
    - plugins should declare what they handle, and conflicts should error at registration time
- Should plugin order affect rendering/commands, and if so how is that made deterministic?
    - order should not affect rendering/commands
- How should clipboard serialization handle disabled/missing plugins?
    - disabled/missing plugins should be a document load error
- What is the intended document compatibility story if a feature plugin is removed after documents already contain its metadata or marks?
    - document load error

## Recommendation

Implement the plugin system in two phases.

Phase 1 should be an internal registry plus default preset that changes wiring but not behavior. Keep `RichBlockMeta` fixed. Route inline embeds, toolbar items, slash commands, markdown shortcuts, CRDT hooks, and simple block specs through the registry.

Phase 2 should extract complex feature modules one by one, starting with simple marks and metadata-only blocks, then annotations and code previews, then the structural features: polls, columns, slides, and tables.

This keeps the risk manageable while creating the extension points the task needs: plugin-owned features, named render destinations, and dependency-based sub-plugins.
