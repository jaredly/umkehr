# Research: Previewable Code Blocks

## Task

Generalize the current Mermaid block into the dual of the existing code block: source code that can also render a preview. Preview mode should be on by default. Candidate previewable languages include Mermaid, Vega-Lite, DOT/Graphviz, and Turtle.

## Current State

`examples/block-rich-text` currently has separate block metadata for code and Mermaid:

- `code`: `{type: 'code', language: string, ts}`
- `mermaid`: `{type: 'mermaid', ts}`

Mermaid already behaves like a code block in several editor paths:

- `App.tsx` treats `code` and `mermaid` as `isPlainTextCodeLikeBlock`.
- Both get `.codeBlock` styling and trailing-newline rendering.
- Enter inside Mermaid inserts newline text rather than splitting a normal block.
- Tab inside Mermaid inserts spaces.
- Pasted multiline plain text is kept inside code/Mermaid instead of creating multiple blocks.
- Clipboard HTML serializes both as `<pre>`.

The main difference is rendering. Mermaid has a dedicated `MermaidBlock` React component with an Edit/View toggle. It initializes in view mode when the block has source text, edit mode when empty, renders through `mermaid.render`, keeps the previous SVG visible during re-render, and overlays errors while retaining the last good render.

Code blocks have syntax highlighting and a language selector, but no preview surface.

## Relevant Files

- `examples/block-rich-text/src/blockMeta.ts`
  Defines `RichBlockMeta`. This is the core place where `mermaid` is currently a distinct block type.

- `examples/block-rich-text/src/App.tsx`
  Contains block type menu values, slash commands, block rendering, inline controls, code highlighting, code/Mermaid editing behavior, and the Mermaid renderer component.

- `examples/block-rich-text/src/blockCommands.ts`
  Contains code-like split/paste behavior. Mermaid has custom Enter behavior via `shouldExitMermaidBlock`, while code has `shouldExitCodeBlock`.

- `examples/block-rich-text/src/documentFormat.ts`
  Imports/exports the external document format. `mermaid` is currently a known document block type with no metadata.

- `examples/block-rich-text/src/clipboard.ts`
  Validates block metadata and serializes code/Mermaid as `<pre>`.

- `examples/block-rich-text/src/history.ts`
  Validates persisted block metadata for history/import.

- `examples/block-rich-text/src/style.css`
  Contains `.codeBlock` and Mermaid-specific preview/toggle styles.

- Tests already cover Mermaid fixture opening, empty Mermaid edit mode, retaining old renders during async render/error, paste behavior, Enter behavior, document import/export, and fixtures.

## Design Direction

The cleanest model is to make Mermaid a preview-capable code flavor rather than its own block type.

Possible metadata shape:

```ts
type CodePreviewKind = 'mermaid' | 'vega-lite' | 'graphviz' | 'turtle';

type RichBlockMeta =
  | {type: 'code'; language: string; preview?: CodePreviewKind; ts: HLC}
  | ...
```

Under that model:

- Plain code remains `{type: 'code', language, ts}`.
- Mermaid becomes `{type: 'code', language: 'mermaid', preview: 'mermaid', ts}`.
- Future renderers can be added without adding top-level block types.
- The block type menu can expose user-facing entries like "Code", "Mermaid diagram", "Vega-Lite chart", etc. while all map to `type: 'code'`.
- Rendering can be delegated by `meta.preview` rather than by `meta.type`.

An alternative is a new top-level `previewable_code` block type:

```ts
{type: 'previewable_code'; language: string; renderer: CodePreviewKind; ts: HLC}
```

That avoids overloading code metadata, but it creates another code-like type and duplicates much of the existing code behavior. Given the task phrasing says this should be the dual to the code block type, extending `code` metadata seems more sympathetic to the existing codebase.

## Rendering Abstraction

`MermaidBlock` can become a generic `PreviewableCodeBlock` with a renderer registry:

```ts
type CodePreviewRenderer = {
    kind: CodePreviewKind;
    emptyLabel: string;
    loadingLabel: string;
    render(source: string, renderId: string): Promise<{html: string}>;
};
```

The existing Mermaid behavior should be preserved:

- Default to view mode when source is non-empty.
- Default to edit mode when source is empty.
- Keep the last successful preview visible while a new render is pending.
- Show an error overlay when a later render fails but a prior render exists.
- Show a full error panel when no prior render exists.

The CSS can be renamed from `.mermaidBlock`, `.mermaidToolbar`, `.mermaidPreview`, etc. to generic preview-code classes. Tests can continue asserting behavior through accessible buttons and generic class names, with Mermaid-specific mock coverage around the renderer.

## Import/Export Compatibility

There is existing document-format support for `type: 'mermaid'`. Removing it outright would break fixtures and older documents. A compatibility path is needed:

- Import `type: 'mermaid'` as `type: 'code', language: 'mermaid', preview: 'mermaid'`.
- Export new documents as `type: 'code', meta: {language: 'mermaid', preview: 'mermaid'}` unless backward compatibility requires continuing to emit `type: 'mermaid'`.
- Clipboard/history validators should accept the new code metadata shape.
- Existing Mermaid fixture/tests should be updated to expect the new representation while still testing legacy import.

Open compatibility decision: whether the public document format should keep `mermaid` as a stable block type alias or migrate to code-with-preview.

## Command Behavior

Mermaid currently has stricter exit behavior than code:

- Code exits after Enter at a trailing blank line.
- Mermaid exits after two trailing blank lines.

If Mermaid becomes code-with-preview, the command layer needs a generic helper such as `isPreviewableCodeBlock(meta)` and either:

- keep the Mermaid-specific two-blank-line behavior only for `preview === 'mermaid'`, or
- use one shared code block exit rule for all code-like blocks.

The existing tests imply the two-blank-line Mermaid behavior is intentional, so the safer migration is to preserve it for Mermaid and make any future renderer behavior explicit.

## Future Renderer Notes

- Mermaid is already available as a dependency and can be migrated first.
- Vega-Lite likely needs new dependencies, probably `vega`, `vega-lite`, and `vega-embed` or a lighter compile/render path.
- DOT/Graphviz in-browser rendering likely needs a WASM/package dependency such as `@viz-js/viz`; this has bundle-size and async initialization implications.
- Turtle needs a product decision. It could preview as parsed RDF triples, a graph visualization, or validation/errors only. Those are different UXs.

Because network access/dependency installation is not needed for research, I did not verify current package versions or bundle impact.

## Suggested Implementation Steps

1. Add preview metadata to `code` blocks and helper predicates like `isCodeLikeBlock`, `isPreviewableCodeBlock`, and `previewKindForMeta`.
2. Migrate block rendering from `MermaidBlock` to generic `PreviewableCodeBlock`.
3. Register the existing Mermaid renderer first, preserving current async render/error behavior.
4. Update block type menu/slash command conversion so "Mermaid diagram" creates a code block with Mermaid preview metadata.
5. Update command behavior to use code-like helpers instead of direct `meta.type === 'mermaid'` checks.
6. Update document import/export, history validation, clipboard validation, fixtures, and tests.
7. Add compatibility tests for legacy `type: 'mermaid'` import.

## Open Questions

- Should preview/edit mode be local UI state only, as it is today, or persisted per block?
    - yeah local UI only. let's add a third state, which is split view (code on the left, preview on the right)
- Should export preserve legacy `type: 'mermaid'` for Mermaid blocks, or should the document format migrate to `type: 'code'` with preview metadata?
    - no backward compatability needed
- Should Mermaid keep its current "exit after two trailing blank lines" behavior, or should all code-like blocks use the normal code exit rule?
    - let's have all code blocks use two blank lines
- Which renderer should ship after Mermaid: Vega-Lite, Graphviz, or Turtle?
    - vega-lite
- For Turtle, what is the intended preview: triples table, graph visualization, validation, or something else?
    - eh let's drop this one
- Should previewable code blocks still expose the normal code language selector, or should renderer-specific blocks lock/set their language automatically?
    - let's have a "preview" checkbox that only shows up for languages that have a preview configured.
- Should generic preview renderers emit trusted sanitized HTML/SVG only, or should the component own a sanitizer boundary before using `dangerouslySetInnerHTML`?
    - preview renderers can be trusted
