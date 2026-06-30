# Remaining Work: Block Editor Plugin Extraction

This is the extraction work left after Phase 14 of `.tasks/05i2x-plugins/plan.md`. The public preset is now
`defaultBlockEditorPlugins`; `legacyRichTextPlugins` has been removed. Some internal modules still
use `legacyRichText*` names, but those are implementation names, not the removed preset alias.

## Current State

Plugin declarations own most feature metadata:

- block types, marks, inline embeds, selection types, toolbar items, slash commands, markdown
  shortcuts, option panel declarations, code preview renderers, styles, and CRDT hooks are registry
  contributions;
- `BlockRichTextEditor` uses registry availability to show or run many feature surfaces;
- document compatibility checks verify registered support for block types, marks, inline embeds,
  persisted selection types, and persisted code preview metadata.

The main remaining gap is execution ownership. Many feature declarations are plugin-owned, but the
actual renderer, command, clipboard, and option-panel implementations still live in central editor
modules.

## 1. Renderer Extraction

`BlockRichTextEditor.tsx` still contains hard-coded feature render branches and feature components.
Examples:

- render tree branches for `table`, `columns`, `slide_deck`, `slide`, `blockquote`, `callout`, and
  child-backed `poll`;
- editable-block branches for `image`, `preview`, `poll`, and previewable `code`;
- central components/functions such as `TableBlock`, `ColumnsBlock`, `SlideDeckBlock`, `PollBlock`,
  `MatrixPollBlock`, `LongAnswerPollBlock`, `AnnotationSidebar`, `FootnoteList`,
  `FloatingAnnotationPopover`, and annotation body editors;
- inline DOM rendering still has central behavior for links, code, math, embeds, and annotations.

Required work:

- add renderer contexts that expose editor services currently captured from component scope:
  selection updates, block-control commands, attachment lookup, user id, drag/drop callbacks,
  popover positioning, table selection helpers, slide UI state, poll editor mode state, and
  annotation body activity;
- move feature components behind plugin-owned `blockRenderers`, `inlineRenderers`,
  `destinationRenderers`, and `optionPanels`;
- replace central `meta.type === ...` branches with registry dispatch plus explicit fallbacks for
  core paragraph/plain editable blocks.

Suggested order:

1. Extract simple block render wrappers: headings, lists, todos, quote, callouts, ingredients.
2. Extract media/preview blocks: image, link preview, code preview.
3. Extract polls.
4. Extract columns and slides.
5. Extract tables.
6. Extract annotation destinations and annotation body editing.

## 2. Command Handler Extraction

Toolbar and slash command declarations are plugin-owned, but many command implementations remain in
`BlockRichTextEditor.tsx` or `blockCommands.ts`.

Examples still centrally bridged:

- inline marks: bold, italic, strikethrough, underline, code, math;
- link editing and link popovers;
- date inline embeds;
- image upload;
- annotation create/resolve and annotation body commands;
- structural conversions for table, columns/card columns, slide deck, slide, and preview blocks;
- table keyboard, drag/drop, row/column/cell movement, and cell selection commands;
- poll voting and poll option editing;
- code language and preview metadata updates;
- block option panel updates for callouts, images, polls, columns, slides, and styles.

Required work:

- expand `BlockEditorCommandContext` beyond `{state, selection, dispatch}` with feature-safe editor
  services:
  - `nextTs`;
  - selection read/write helpers;
  - focused block lookup;
  - attachment creation/lookup/merge services;
  - preview metadata fetch/update services;
  - popover/open-dialog services where commands need UI;
  - user id and presence context where commands need actor-specific state;
  - access to registry and CRDT virtual parent config;
- move command implementations into plugin modules as real `commands` handlers;
- keep central dispatch as a thin command router only.

Suggested order:

1. Inline marks, links, math, and inline date.
2. Code block options.
3. Image upload and image options.
4. Link preview insertion/update.
5. Poll commands.
6. Columns/slides/table structural commands.
7. Annotation commands and annotation body commands.

## 3. Clipboard Ownership

`clipboard.ts` is still feature-aware. It directly knows about:

- annotations and annotation body blocks;
- image attachment ids;
- table-cell selection clipboard behavior;
- block meta filtering by registry block types;
- mark filtering for links, annotations, embeds, math, and boolean marks;
- HTML element choices for headings, blockquotes, code, and list items;
- preview block HTML rendering;
- ingredient highlighting.

Required work:

- replace registry-derived block/mark filtering with plugin-owned clipboard hooks;
- extend clipboard hook shape so plugins can participate by block scope, mark scope, inline embed
  scope, selection type, and HTML/plain-text serialization;
- add a way for plugins to serialize/deserialize related resources such as image attachments and
  annotation body blocks;
- keep the core clipboard layer responsible for document slicing, ordering, MIME wrapping, and
  composing plugin hook output.

Suggested order:

1. Mark and inline embed serialization hooks.
2. Block meta serialization hooks.
3. Attachment/resource hooks for images.
4. Annotation graph hooks.
5. Table selection hooks.

## 4. Option Panel Extraction

`optionPanels` are declared by plugins, but `BlockOptions` still renders central branches for:

- code language/preview;
- callout kind;
- image size;
- poll choice/display/result settings;
- columns display mode;
- slide deck size/footer;
- slide title/transition;
- block styles.

Required work:

- make `BlockEditorOptionPanelSpec.render(...)` powerful enough to update block metadata through a
  plugin-owned command or mutation service;
- move each option panel UI to its plugin module;
- leave only the option panel host/popover frame in `BlockRichTextEditor.tsx`.

## 5. Metadata Model Narrowing

`RichBlockMeta` still centrally names every bundled block type. That is useful for current internal
type safety, but it means custom plugin metadata is not first-class at the editor boundary.

Required work:

- decide whether the public editor remains specialized to bundled `RichBlockMeta` or becomes
  generic over registry metadata;
- if generic, move bundled metadata unions to plugin modules and compose a preset metadata type from
  the bundled plugin set;
- narrow central helpers to core paragraph/plain text metadata where possible.

Risk:

- this is high-churn because command helpers, render helpers, fixtures, and tests currently rely on
  the central union.

## 6. Internal Naming Cleanup

The removed preset alias is gone, but these names remain:

- `legacyRichTextUiPlugin`;
- `legacyRichTextBlocksPlugin`;
- `legacyRichTextCrdtPlugins`;
- `legacyRichTextCrdtRegistry`;
- `legacyRichTextUi.css`;
- `legacyRichTextBlocks.css`.

These names are now internal-ish, but they leak through exports because `plugins/index.ts` exports
the modules. Decide whether to:

- keep them as historically named low-level internals;
- rename them to neutral names such as `defaultEditorUiPlugin`, `defaultBlockCorePlugin`, and
  `defaultBlockEditorCrdtPlugins`;
- or remove empty/placeholder plugins if their declarations have fully moved elsewhere.

Do this after renderer/command extraction, otherwise the names still reflect real transitional
ownership.

## 7. Public Export Audit

`src/block-editor/index.ts` still exports many feature implementation modules directly. After
extraction, audit whether the root entrypoint should export:

- stable public APIs: editor component, registry, plugin types, default preset, built-in plugins,
  compatibility helpers, selection helpers, style helpers;
- plugin-owned feature APIs through plugin modules;
- fewer central implementation helpers.

Goal:

- users should import feature APIs from the plugin that owns the feature, not from central editor
  implementation modules.

## Suggested Milestones

1. Add richer plugin execution contexts without moving behavior.
2. Move inline mark/link/date/code commands.
3. Move image and link-preview commands plus attachment/preview services.
4. Move option panel rendering.
5. Move simple block renderers.
6. Move poll, columns, slides, and table renderers/commands.
7. Move annotation rendering/commands/clipboard.
8. Replace central clipboard feature knowledge with plugin hooks.
9. Revisit `RichBlockMeta` and internal `legacyRichText*` names.
10. Audit public exports and docs.

## Verification Targets

Keep these areas covered during extraction:

- registry conflict and ordering tests;
- document compatibility tests;
- default preset smoke tests;
- clipboard round-trip tests;
- annotation tests;
- table selection and keyboard tests;
- code preview tests;
- example document fixture tests;
- package smoke tests for exported JS and CSS entrypoints.
