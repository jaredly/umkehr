# Block Editor Plugins

The block editor is exported from `umkehr/block-editor`. The package surface includes the React
editor component, registry helpers, built-in plugins, the full bundled preset, document
compatibility helpers, selection plugin helpers, and style collection helpers.

## Base Editor Usage

Use the core editor styles and `coreBlockEditorPlugins` when you want the editor shell without any
bundled feature declarations:

```tsx
import {
    BlockRichTextEditor,
    coreBlockEditorPlugins,
} from 'umkehr/block-editor';
import 'umkehr/block-editor/style.css';

<BlockRichTextEditor
    plugins={coreBlockEditorPlugins}
    replica={replica}
    attachments={attachments}
    resetSignal={resetSignal}
    undoState={undoState}
    undoStatus={undoStatus}
    rainbowLamportIds={false}
    userId={userId}
    onUserIdChange={setUserId}
    onCommand={onCommand}
    onUndo={onUndo}
    onRedo={onRedo}
    onToggleOnline={onToggleOnline}
    onCreateImageAttachment={createImageAttachment}
    onMergeSerializedAttachments={mergeSerializedAttachments}
    onKeystroke={onKeystroke}
/>;
```

## Full Preset Usage

Use `defaultBlockEditorPlugins` for the bundled rich-text feature set. The older
`legacyRichTextPlugins` export is retained as an alias for existing callers.

```tsx
import {
    BlockRichTextEditor,
    basicMarksPlugin,
    defaultBlockEditorPlugins,
    headingsPlugin,
    linksPlugin,
} from 'umkehr/block-editor';
import 'umkehr/block-editor/legacyRichTextPlugins.css';

<BlockRichTextEditor
    plugins={defaultBlockEditorPlugins}
    replica={replica}
    attachments={attachments}
    resetSignal={resetSignal}
    undoState={undoState}
    undoStatus={undoStatus}
    rainbowLamportIds={false}
    userId={userId}
    onUserIdChange={setUserId}
    onCommand={onCommand}
    onUndo={onUndo}
    onRedo={onRedo}
    onToggleOnline={onToggleOnline}
    onCreateImageAttachment={createImageAttachment}
    onMergeSerializedAttachments={mergeSerializedAttachments}
    onKeystroke={onKeystroke}
/>;

const minimalMarksOnlyPreset = [
    basicMarksPlugin,
    linksPlugin,
    headingsPlugin,
];
```

## Built-In Plugins

Each built-in plugin is exported individually from `umkehr/block-editor`:

```ts
import {
    annotationsPlugin,
    basicMarksPlugin,
    calloutsPlugin,
    codeMermaidPlugin,
    codePlugin,
    codeVegaPlugin,
    columnsPlugin,
    headingsPlugin,
    imagesPlugin,
    inlineDatePlugin,
    ingredientsPlugin,
    linkPreviewPlugin,
    linksPlugin,
    listsPlugin,
    mathPlugin,
    pollsPlugin,
    quotePlugin,
    slidesPlugin,
    tablePlugin,
    todosPlugin,
} from 'umkehr/block-editor';
```

Code preview renderers are sub-plugins. A persisted code block with Mermaid preview metadata needs
`codePlugin` and `codeMermaidPlugin`; a persisted Vega-Lite preview needs `codePlugin` and
`codeVegaPlugin`. Loading those documents without the matching renderer sub-plugin is reported as a
compatibility error.

## Writing A Plugin

A plugin is a `BlockEditorPlugin` with a stable `id` and one or more declarations:

```tsx
import type {BlockEditorPlugin} from 'umkehr/block-editor';

export const asidePlugin: BlockEditorPlugin = {
    id: 'example.aside',
    blockTypes: [{id: 'aside', label: 'Aside'}],
    blockRenderers: [{
        id: 'example.aside:render',
        blockType: 'aside',
        render: (block) => <aside>{block.id.join(':')}</aside>,
    }],
    slashCommands: [{
        id: 'example.aside:slash',
        label: 'Aside',
        commandId: 'block-type:aside',
        order: 50,
    }],
};
```

Create a registry with `createBlockEditorRegistry(plugins)`. Registry construction applies plugin
dependencies, annotates contributions with `pluginId`, sorts ordered contributions, and fails fast
for conflicts.

## Conflict Rules

Plugin ids must be unique. Contribution ids are unique within their contribution kind, including
block types, marks, inline embeds, selection types, selection plugins, commands, clipboard hooks,
toolbar items, slash commands, markdown shortcuts, inline renderers, styles, and code preview
renderers.

Only one block renderer can own a block type. Only one inline renderer can own a mark type or embed
type. Only one code preview renderer can own a normalized language. `requires` dependencies must be
registered, and dependency cycles fail with `BlockEditorPluginRegistryError`.

## Document Compatibility

Use `blockEditorDocumentCompatibilityIssues(...)` to inspect missing plugin support before loading a
persisted document, or `assertBlockEditorDocumentPluginsAvailable(...)` to throw
`BlockEditorPluginLoadError`.

Compatibility checks cover:

- block metadata types not supported by the registry;
- mark types not supported by the registry;
- inline embed types stored in embed marks;
- persisted selection types supplied by the caller;
- code preview metadata whose `preview` kind and language require a missing preview renderer
  sub-plugin.

`BlockEditorPluginLoadError.issues` contains the structured issue list so applications can show a
specific recovery path.

## Custom Selection Plugins

Selection plugins let a feature define editor and retained selection types outside the built-in
`caret`, `range`, and `block` selections. A custom selection plugin must declare both
`selectionTypes` and `selectionPlugins` entries with the same id.

Use registry-aware helpers whenever selections can include plugin-owned types:

```ts
import {
    resolveSelectionFromRegistry,
    retainSelectionFromRegistry,
} from 'umkehr/block-editor';

const retained = retainSelectionFromRegistry(registry, state, selection);
const resolved = resolveSelectionFromRegistry(registry, state, retained);
```

The same pattern exists for selection sets through `retainSelectionSetFromRegistry(...)`,
`resolveSelectionSetFromRegistry(...)`, `replacePrimarySelectionFromRegistry(...)`, and related
helpers. Calling the non-registry helpers with a plugin selection throws
`BlockEditorSelectionPluginError`. Loading persisted selections with unknown selection types is
reported by the document compatibility helpers.

## Styles

Static CSS entrypoints are the primary packaging surface:

```ts
import 'umkehr/block-editor/style.css';
import 'umkehr/block-editor/legacyRichTextPlugins.css';
import 'umkehr/block-editor/plugins/table.css';
```

Plugins can also declare `styles` entries. `styleImportsFromRegistry(registry)` returns declared
package CSS hrefs in registry order, and `styleTextFromRegistry(registry)` returns concatenated
custom CSS text. The editor does not inject these styles at runtime.

## Legacy Central Execution

Feature declarations are plugin-owned, but several older renderer and command implementations are
still centrally executed inside the editor component and command modules. The registry is the public
ownership surface; some internal execution paths will remain centralized until the remaining legacy
cleanup is complete.
